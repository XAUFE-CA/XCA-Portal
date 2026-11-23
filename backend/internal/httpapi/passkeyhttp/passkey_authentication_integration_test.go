//go:build integration

package passkeyhttp_test

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strconv"
	"strings"
	"testing"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/passkey"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/session"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/config"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/httpapi"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/testdb"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/testpasskey"
	"github.com/XAUFE-CA/XCA-Portal/backend/migrations"
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers/legacy"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	passkeySessionPath           = "/api/v1/auth/session"
	invalidPasskeyAuthentication = "invalid_or_expired_authentication"
)

func TestPasskeyAuthenticationHTTPLifecycle(t *testing.T) {
	pool := newPasskeyAuthenticationHTTPPool(t)
	cfg := passkeyAuthenticationHTTPConfig()
	management := newPasskeyAuthenticationHTTPFixture(t, pool, cfg)
	owner := seedPasskeyHTTPSession(t, pool, "sign-in-owner", true)
	register := management.options(owner)
	encodedHandle, ok := register.PublicKey.User.ID.(string)
	if !ok {
		t.Fatalf("registration user handle = %T", register.PublicKey.User.ID)
	}
	handle, err := base64.RawURLEncoding.DecodeString(encodedHandle)
	if err != nil || len(handle) != 32 {
		t.Fatalf("invalid registration user handle: %v", err)
	}
	authenticator := testpasskey.NewAuthenticator(t)
	id := []byte("http-discoverable-credential")
	registrationBody := passkeyHTTPBody(t, map[string]any{
		"flow_id": register.FlowID, "credential": authenticator.Registration(t, register.PublicKey.Challenge.String(), passkeyRPID, passkeyOrigin, id, testpasskey.Options{}),
	})
	savedBody, _ := management.call(http.MethodPost, passkeyVerifyPath, registrationBody, owner, passkeyTestOperation(101), 201, "")
	var saved passkey.PasskeySummary
	if err := json.Unmarshal([]byte(savedBody), &saved); err != nil || !session.ValidOperationID(saved.ID) {
		t.Fatalf("invalid registration summary: %s (%v)", savedBody, err)
	}

	cfg.Passkeys.Enabled = false
	login := newPasskeyAuthenticationHTTPFixture(t, pool, cfg)
	login.abandon(owner, 101, 404, "credential_not_found", "")
	options := login.loginOptions("")
	makeAssertion := func(handle []byte) string {
		return passkeyHTTPBody(t, map[string]any{
			"flow_id": options.FlowID, "credential": authenticator.Assertion(t, options.PublicKey.Challenge.String(), passkeyRPID, passkeyOrigin, id, handle, testpasskey.AssertionOptions{SignCount: 1}),
		})
	}
	assertion := makeAssertion(handle)
	missingHandle := makeAssertion(nil)
	nullHandle := strings.Replace(missingHandle, `"signature":`, `"userHandle":null,"signature":`, 1)
	login.verifyRejected(missingHandle, 102, "", 400, invalidPasskeyAuthentication)
	login.verifyRejected(nullHandle, 103, "", 400, invalidPasskeyAuthentication)
	login.abandon("", 104, 204, "", "")
	login.verifyRejected(assertion, 104, "", 409, "operation_abandoned")

	response, body := login.loginRequest(passkeyAuthenticationVerifyPath, assertion, passkeyTestOperation(105), "")
	const identity = `{"identity":{"user":"sign-in-owner","label":"sign-in-owner"}}`
	if response.StatusCode != 200 || strings.TrimSpace(body) != identity {
		t.Fatalf("verify = %d %s, want 200 %s", response.StatusCode, body, identity)
	}
	cookies := response.Cookies()
	if len(cookies) != 1 || cookies[0].Name != "xca_session_dev" || !cookies[0].HttpOnly || cookies[0].Path != "/" ||
		cookies[0].SameSite != http.SameSiteLaxMode || cookies[0].Secure || cookies[0].Domain != "" ||
		cookies[0].MaxAge != int(cfg.SessionTTL.Seconds()) || cookies[0].Value == "" || cookies[0].Value == owner {
		t.Fatal("Passkey verification did not issue a new test session cookie with the expected attributes")
	}
	login.verifyRejected(assertion, 106, "", 400, invalidPasskeyAuthentication)
	login.expectSession(cookies[0].Value, identity)
	management.expectList(cookies[0].Value, saved)
	management.call(http.MethodPost, passkeyOptionsPath, "{}", cookies[0].Value, "", 403, "recent_otp_required")
	revoke := passkeyHTTPBody(t, map[string]string{"credential_id": saved.ID})
	management.call(http.MethodPost, passkeyRevokePath, revoke, cookies[0].Value, passkeyTestOperation(107), 403, "recent_otp_required")

	login.abandon("", 105, 204, "", "")
	login.abandon("", 105, 204, "", "")
	login.expectSession(cookies[0].Value, `{"identity":null}`)
	login.expectSession(owner, identity)
}

func TestPasskeyAuthenticationHTTPTrustedProxyThrottling(t *testing.T) {
	pool := newPasskeyAuthenticationHTTPPool(t)
	cfg := passkeyAuthenticationHTTPConfig()
	cfg.Passkeys.Enabled = false
	cfg.TrustedProxies = []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32"), netip.MustParsePrefix("::1/128")}
	login := newPasskeyAuthenticationHTTPFixture(t, pool, cfg)
	res, body := login.loginRequest(passkeyAuthenticationOptionsPath, "{}", "", "not-an-address")
	assertPasskeyResponse(t, res, body, 503, "service_unavailable")

	limited := false
	for i := range 21 {
		client := "192.0.2.42"
		if i%2 == 1 {
			client = "::ffff:192.0.2.42"
		}
		forwarded := fmt.Sprintf("198.51.100.%d, %s, 127.0.0.1", i+1, client)
		res, body := login.loginRequest(passkeyAuthenticationOptionsPath, "{}", "", forwarded)
		if i >= 10 && res.StatusCode == 429 {
			checkPasskeyLoginRetryAfter(t, res, body, 60)
			limited = true
			break
		}
		assertPasskeyResponse(t, res, body, 200, "")
	}
	if !limited {
		t.Fatal("rotating spoofed forwarding entries bypassed the resolved source quota")
	}

	options := login.loginOptions("192.0.2.43, 127.0.0.1")
	authenticator := testpasskey.NewAuthenticator(t)
	assertion := passkeyHTTPBody(t, map[string]any{
		"flow_id": options.FlowID, "credential": authenticator.Assertion(t, options.PublicKey.Challenge.String(), passkeyRPID, passkeyOrigin, []byte("unknown"), make([]byte, 32), testpasskey.AssertionOptions{}),
	})
	for i := range 5 {
		login.verifyRejected(assertion, 201+i, fmt.Sprintf("192.0.2.%d, 127.0.0.1", 50+i), 400, invalidPasskeyAuthentication)
	}
	res, body = login.loginRequest(passkeyAuthenticationVerifyPath, assertion, passkeyTestOperation(206), "192.0.2.55, 127.0.0.1")
	checkPasskeyLoginRetryAfter(t, res, body, 120)
}

type passkeyAuthenticationHTTPFixture struct {
	passkeyHTTPFixture
}

func newPasskeyAuthenticationHTTPPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := testdb.New(t)
	if err := migrations.Up(dsn); err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func newPasskeyAuthenticationHTTPFixture(t *testing.T, pool *pgxpool.Pool, cfg config.Config) passkeyAuthenticationHTTPFixture {
	t.Helper()
	handler, err := httpapi.NewAuthHandler(pool, nil, cfg)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := openapi3.NewLoader().LoadFromFile("../../../api/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	router, err := legacy.NewRouter(doc)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return passkeyAuthenticationHTTPFixture{passkeyHTTPFixture{t, server, router}}
}

func (f passkeyAuthenticationHTTPFixture) loginRequest(path, payload, operation, forwarded string) (*http.Response, string) {
	f.t.Helper()
	ctx := f.t.Context()
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, f.server.URL+path, strings.NewReader(payload))
	if err != nil {
		f.t.Fatal(err)
	}
	r.Header.Set("Origin", passkeyOrigin)
	r.Header.Set("Content-Type", "application/json")
	if operation != "" {
		r.Header.Set("X-XCA-Auth-Operation", operation)
	}
	if forwarded != "" {
		r.Header.Set("X-Forwarded-For", forwarded)
	}
	res, err := f.server.Client().Do(r)
	if err != nil {
		f.t.Fatal(err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		f.t.Fatal(err)
	}
	if res.Header.Get("Cache-Control") != "no-store" || res.Header.Get("Access-Control-Allow-Origin") != "" || res.Header.Get("X-Content-Type-Options") != "nosniff" {
		f.t.Fatal("unsafe Passkey authentication response headers")
	}
	contractRequest := r.Clone(ctx)
	contractRequest.URL.Scheme, contractRequest.URL.Host = "", ""
	route, params, err := f.router.FindRoute(contractRequest)
	if err != nil {
		f.t.Fatal(err)
	}
	body := string(data)
	input := &openapi3filter.ResponseValidationInput{
		RequestValidationInput: &openapi3filter.RequestValidationInput{Request: contractRequest, Route: route, PathParams: params},
		Status:                 res.StatusCode, Header: res.Header, Body: io.NopCloser(strings.NewReader(body)),
	}
	if err := openapi3filter.ValidateResponse(ctx, input); err != nil {
		f.t.Fatalf("%s response %d violates OpenAPI: %v", path, res.StatusCode, err)
	}
	return res, body
}

func (f passkeyAuthenticationHTTPFixture) loginOptions(forwarded string) passkey.PasskeyAuthenticationOptions {
	f.t.Helper()
	res, data := f.loginRequest(passkeyAuthenticationOptionsPath, "{}", "", forwarded)
	assertPasskeyResponse(f.t, res, data, 200, "")
	var options passkey.PasskeyAuthenticationOptions
	if err := json.Unmarshal([]byte(data), &options); err != nil || len(options.FlowID) != 43 || len(options.PublicKey.Challenge) != 32 ||
		options.PublicKey.RelyingPartyID != passkeyRPID || options.PublicKey.UserVerification != "required" ||
		options.PublicKey.Timeout != 120000 || strings.Contains(data, `"allowCredentials"`) {
		f.t.Fatalf("unexpected discoverable options: %s (%v)", data, err)
	}
	return options
}

func (f passkeyAuthenticationHTTPFixture) verifyRejected(body string, operation int, forwarded string, status int, code string) {
	f.t.Helper()
	res, data := f.loginRequest(passkeyAuthenticationVerifyPath, body, passkeyTestOperation(operation), forwarded)
	assertPasskeyResponse(f.t, res, data, status, code)
}

func (f passkeyAuthenticationHTTPFixture) expectSession(token, expected string) {
	f.t.Helper()
	data, _ := f.call(http.MethodGet, passkeySessionPath, "", token, "", 200, "")
	if strings.TrimSpace(data) != expected {
		f.t.Fatalf("recovered session = %s, want %s", data, expected)
	}
}

func checkPasskeyLoginRetryAfter(t *testing.T, res *http.Response, body string, maxSeconds int) {
	t.Helper()
	assertPasskeyResponse(t, res, body, 429, "rate_limited")
	seconds, err := strconv.Atoi(res.Header.Get("Retry-After"))
	if err != nil || seconds < 1 || seconds > maxSeconds {
		t.Fatalf("Retry-After = %q, want 1–%d seconds", res.Header.Get("Retry-After"), maxSeconds)
	}
}
