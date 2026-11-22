//go:build integration

package httpapi

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/testdb"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/testpasskey"
	"github.com/XAUFE-CA/XCA-Portal/backend/migrations"
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/legacy"
	"github.com/jackc/pgx/v5/pgxpool"
)

const passkeyAbandonPath = "/api/v1/auth/operations/abandon"

func TestPasskeyHTTPLifecycle(t *testing.T) {
	dsn := testdb.New(t)
	if err := migrations.Up(dsn); err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	cfg := passkeyHTTPConfig()
	handler, err := NewAuthHandler(pool, nil, cfg)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := openapi3.NewLoader().LoadFromFile("../../api/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	router, err := legacy.NewRouter(doc)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	defer server.Close()
	f := passkeyHTTPFixture{t, server, router}
	owner := seedPasskeyHTTPSession(t, pool, "owner", true)
	other := seedPasskeyHTTPSession(t, pool, "other", true)
	stale := seedPasskeyHTTPSession(t, pool, "owner", false)

	f.call("GET", passkeyListPath, "", "", "", 401, "authentication_required")
	f.call("POST", passkeyOptionsPath, "{}", "", "", 401, "authentication_required")
	f.call("POST", passkeyOptionsPath, "{}", stale, "", 403, "recent_otp_required")
	f.expectList(stale)

	options := f.options(owner)
	browserID := []byte("http-webauthn-credential")
	verify := f.registration(options, browserID)
	f.call("POST", passkeyVerifyPath, verify, other, passkeyTestOperation(1), 400, "invalid_or_expired_registration")
	f.call("POST", passkeyVerifyPath, verify, stale, passkeyTestOperation(2), 403, "recent_otp_required")
	data, _ := f.call("POST", passkeyVerifyPath, verify, owner, passkeyTestOperation(3), 201, "")
	var saved auth.PasskeySummary
	if err := json.Unmarshal([]byte(data), &saved); err != nil || !auth.ValidOperationID(saved.ID) || saved.CreatedAt.IsZero() || saved.LastUsedAt != nil || saved.Label != nil {
		t.Fatalf("unexpected saved Passkey: %s, %v", data, err)
	}
	f.call("POST", passkeyVerifyPath, verify, owner, passkeyTestOperation(4), 400, "invalid_or_expired_registration")
	duplicate := f.registration(f.options(other), browserID)
	f.call("POST", passkeyVerifyPath, duplicate, other, passkeyTestOperation(5), 409, "credential_exists")
	f.expectList(owner, saved)
	f.expectList(stale, saved)
	f.expectList(other)

	revoke := passkeyHTTPBody(t, map[string]string{"credential_id": saved.ID})
	unknown := passkeyHTTPBody(t, map[string]string{"credential_id": "deaddead-1234-4abc-8abc-000000000001"})
	f.call("POST", passkeyRevokePath, revoke, stale, passkeyTestOperation(6), 403, "recent_otp_required")
	f.call("POST", passkeyRevokePath, revoke, other, passkeyTestOperation(7), 404, "credential_not_found")
	f.call("POST", passkeyRevokePath, unknown, owner, passkeyTestOperation(8), 404, "credential_not_found")
	f.abandon(owner, 9, 204, "", "")
	f.call("POST", passkeyRevokePath, revoke, owner, passkeyTestOperation(9), 409, "operation_abandoned")
	f.expectList(owner, saved)
	f.call("POST", passkeyRevokePath, revoke, owner, passkeyTestOperation(10), 204, "")
	f.abandon(stale, 10, 404, "credential_not_found", "")
	f.abandon(owner, 10, 204, "", "revocation_committed")
	f.call("POST", passkeyRevokePath, revoke, owner, passkeyTestOperation(11), 404, "credential_not_found")
	f.expectList(owner)

	verify = f.registration(f.options(owner), []byte("abandoned-http-credential"))
	f.call("POST", passkeyVerifyPath, verify, owner, passkeyTestOperation(12), 201, "")
	f.abandon(other, 12, 404, "credential_not_found", "")
	cfg.Passkeys.Enabled = false
	disabled, err := NewAuthHandler(pool, nil, cfg)
	if err != nil {
		t.Fatal(err)
	}
	disabledServer := httptest.NewServer(disabled)
	defer disabledServer.Close()
	passkeyHTTPFixture{t, disabledServer, router}.abandon(owner, 12, 404, "credential_not_found", "")
	f.abandon(owner, 12, 204, "", "registration_revoked")
	f.abandon(owner, 12, 204, "", "registration_revoked")
	f.expectList(owner)
}

type passkeyHTTPFixture struct {
	t      *testing.T
	server *httptest.Server
	router routers.Router
}

func (f passkeyHTTPFixture) call(method, path, body, token, operation string, status int, code string) (string, http.Header) {
	f.t.Helper()
	ctx := f.t.Context()
	r, err := http.NewRequestWithContext(ctx, method, f.server.URL+path, strings.NewReader(body))
	if err != nil {
		f.t.Fatal(err)
	}
	if method == "POST" {
		r.Header.Set("Origin", passkeyOrigin)
		r.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		r.AddCookie(&http.Cookie{Name: "xca_session_dev", Value: token})
	}
	if operation != "" {
		r.Header.Set("X-XCA-Auth-Operation", operation)
	}
	response, err := f.server.Client().Do(r)
	if err != nil {
		f.t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		f.t.Fatal(err)
	}
	assertPasskeyResponse(f.t, response, string(data), status, code)
	if status == 204 && len(data) != 0 {
		f.t.Fatalf("204 %s returned a response body", path)
	}
	contractRequest := r.Clone(ctx)
	contractRequest.URL.Scheme, contractRequest.URL.Host = "", ""
	route, params, err := f.router.FindRoute(contractRequest)
	if err != nil {
		f.t.Fatal(err)
	}
	input := &openapi3filter.ResponseValidationInput{
		RequestValidationInput: &openapi3filter.RequestValidationInput{Request: contractRequest, Route: route, PathParams: params},
		Status:                 response.StatusCode, Header: response.Header, Body: io.NopCloser(bytes.NewReader(data)),
	}
	if err := openapi3filter.ValidateResponse(ctx, input); err != nil {
		f.t.Fatalf("%s response %d violates OpenAPI: %v", path, status, err)
	}
	return string(data), response.Header
}

func (f passkeyHTTPFixture) options(token string) auth.PasskeyOptions {
	f.t.Helper()
	data, _ := f.call("POST", passkeyOptionsPath, "{}", token, "", 200, "")
	var opts auth.PasskeyOptions
	if err := json.Unmarshal([]byte(data), &opts); err != nil || opts.FlowID == "" || len(opts.PublicKey.Challenge) == 0 || opts.PublicKey.RelyingParty.ID != passkeyRPID {
		f.t.Fatalf("unexpected creation options: %s, %v", data, err)
	}
	return opts
}

func (f passkeyHTTPFixture) registration(opts auth.PasskeyOptions, browserID []byte) string {
	f.t.Helper()
	return passkeyHTTPBody(f.t, map[string]any{
		"flow_id": opts.FlowID, "credential": testpasskey.Response(f.t, opts.PublicKey.Challenge.String(), passkeyRPID, passkeyOrigin, browserID),
	})
}

func (f passkeyHTTPFixture) expectList(token string, want ...auth.PasskeySummary) {
	f.t.Helper()
	data, _ := f.call("GET", passkeyListPath, "", token, "", 200, "")
	var result struct {
		Credentials []auth.PasskeySummary `json:"credentials"`
	}
	if err := json.Unmarshal([]byte(data), &result); err != nil || result.Credentials == nil || len(result.Credentials) != len(want) {
		f.t.Fatalf("list = %s, want %v: %v", data, want, err)
	}
	for i, credential := range result.Credentials {
		if credential.ID != want[i].ID || !credential.CreatedAt.Equal(want[i].CreatedAt) || credential.BackupEligible != want[i].BackupEligible || credential.BackupState != want[i].BackupState {
			f.t.Fatalf("list = %s, want %v", data, want)
		}
	}
}

func (f passkeyHTTPFixture) abandon(token string, operation int, status int, code, outcome string) {
	f.t.Helper()
	body := passkeyHTTPBody(f.t, map[string]string{"operation_id": passkeyTestOperation(operation)})
	_, header := f.call("POST", passkeyAbandonPath, body, token, "", status, code)
	if got := header.Get("X-XCA-Passkey-Operation-Outcome"); got != outcome {
		f.t.Fatalf("operation outcome = %q, want %q", got, outcome)
	}
}

func seedPasskeyHTTPSession(t *testing.T, pool *pgxpool.Pool, name string, recent bool) string {
	t.Helper()
	var tokenBytes [32]byte
	if _, err := rand.Read(tokenBytes[:]); err != nil {
		t.Fatal(err)
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes[:])
	digest := sha256.Sum256([]byte(token))
	var userID string
	if err := pool.QueryRow(t.Context(), `INSERT INTO users (email, login_name, display_name)
		VALUES ($1, $2, $2) ON CONFLICT (login_name) DO UPDATE SET login_name = EXCLUDED.login_name RETURNING id::text`,
		name+"@example.invalid", name).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO sessions (user_id, session_digest, expires_at, otp_verified_at)
		VALUES ($1, $2, now() + interval '1 hour', CASE WHEN $3 THEN now() ELSE now() - interval '10 minutes' END)`, userID, digest[:], recent); err != nil {
		t.Fatal(err)
	}
	return token
}

func passkeyHTTPBody(t *testing.T, value any) string {
	t.Helper()
	body, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}

func passkeyTestOperation(number int) string {
	return fmt.Sprintf("aabbccdd-1234-4abc-8abc-%012d", number)
}
