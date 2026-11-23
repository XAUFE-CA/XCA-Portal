package passkeyhttp_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/config"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/httpapi"
)

const (
	passkeyOrigin    = "https://portal.example.invalid"
	passkeyRPID      = "portal.example.invalid"
	passkeyOperation = "aabbccdd-1234-4abc-8abc-000000000001"
)

const (
	passkeyListPath                  = "/api/v1/auth/passkeys"
	passkeyOptionsPath               = passkeyListPath + "/registration/options"
	passkeyVerifyPath                = passkeyListPath + "/registration/verify"
	passkeyRevokePath                = passkeyListPath + "/revoke"
	passkeyAuthenticationOptionsPath = passkeyListPath + "/authentication/options"
	passkeyAuthenticationVerifyPath  = passkeyListPath + "/authentication/verify"
)

func passkeyHTTPConfig() config.Config {
	return config.Config{Environment: "test", PublicOrigin: passkeyOrigin, MaxBodyBytes: 4096, SessionTTL: time.Hour,
		Passkeys: config.PasskeyConfig{Enabled: true, RPID: passkeyRPID, RPName: "Test Portal", RecentOTP: 5 * time.Minute}}
}

func TestPasskeyRoutesDisabledBeforeValidation(t *testing.T) {
	cfg := passkeyHTTPConfig()
	cfg.Passkeys.Enabled = false
	cfg.MaxBodyBytes = 1
	handler, err := httpapi.NewAuthHandler(nil, nil, cfg)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{passkeyListPath, passkeyOptionsPath, passkeyVerifyPath, passkeyRevokePath} {
		r := httptest.NewRequest(http.MethodDelete, path, strings.NewReader("not JSON"))
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		assertPasskeyResponse(t, w.Result(), w.Body.String(), 404, "invalid_request")
		if w.Header().Get("Allow") != "" {
			t.Errorf("disabled route %s advertises %q", path, w.Header().Get("Allow"))
		}
	}
}

func TestPasskeyRequestGuards(t *testing.T) {
	handler, err := httpapi.NewAuthHandler(nil, nil, passkeyHTTPConfig())
	if err != nil {
		t.Fatal(err)
	}
	origin := []string{passkeyOrigin}
	media := []string{"application/json"}
	tests := []struct {
		name, method, path, body string
		origins, media           []string
		status                   int
		code, allow              string
	}{
		{"no CORS preflight", "OPTIONS", passkeyOptionsPath, "", origin, media, 405, "invalid_request", "POST"},
		{"wrong list method", "POST", passkeyListPath, "{}", origin, media, 405, "invalid_request", "GET"},
		{"GET without Origin", "GET", passkeyListPath, "", nil, nil, 401, "authentication_required", ""},
		{"GET matching Origin", "GET", passkeyListPath, "", origin, nil, 401, "authentication_required", ""},
		{"GET foreign Origin", "GET", passkeyListPath, "", []string{"https://other.invalid"}, nil, 403, "invalid_request", ""},
		{"GET repeated Origin", "GET", passkeyListPath, "", []string{passkeyOrigin, passkeyOrigin}, nil, 403, "invalid_request", ""},
		{"POST absent Origin", "POST", passkeyOptionsPath, "{}", nil, media, 403, "invalid_request", ""},
		{"POST repeated Origin", "POST", passkeyOptionsPath, "{}", []string{passkeyOrigin, passkeyOrigin}, media, 403, "invalid_request", ""},
		{"wrong Content-Type", "POST", passkeyOptionsPath, "{}", origin, []string{"text/plain"}, 415, "invalid_request", ""},
		{"repeated Content-Type", "POST", passkeyOptionsPath, "{}", origin, []string{"application/json", "application/json"}, 415, "invalid_request", ""},
		{"combined Content-Type", "POST", passkeyOptionsPath, "{}", origin, []string{"application/json, application/json"}, 415, "invalid_request", ""},
		{"ambiguous parameter", "POST", passkeyOptionsPath, "{}", origin, []string{"application/json; charset=utf-8; charset=ascii"}, 415, "invalid_request", ""},
		{"JSON charset and no operation", "POST", passkeyOptionsPath, "{}", origin, []string{"application/json; charset=utf-8"}, 401, "authentication_required", ""},
		{"null options", "POST", passkeyOptionsPath, "null", origin, media, 400, "invalid_request", ""},
		{"unknown options field", "POST", passkeyOptionsPath, `{"unexpected":true}`, origin, media, 400, "invalid_request", ""},
		{"trailing JSON", "POST", passkeyOptionsPath, "{} {}", origin, media, 400, "invalid_request", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			r.Header["Origin"] = tc.origins
			r.Header["Content-Type"] = tc.media
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			assertPasskeyResponse(t, w.Result(), w.Body.String(), tc.status, tc.code)
			if got := w.Header().Get("Allow"); got != tc.allow {
				t.Errorf("Allow = %q, want %q", got, tc.allow)
			}
		})
	}
}

func TestPasskeyVerifyAndRevokeStrictJSON(t *testing.T) {
	handler, err := httpapi.NewAuthHandler(nil, nil, passkeyHTTPConfig())
	if err != nil {
		t.Fatal(err)
	}
	flow := `"flow_id":"` + strings.Repeat("A", 43) + `"`
	credential := `"credential":{"id":"YQ","rawId":"YQ","type":"public-key","response":{"clientDataJSON":"YQ","attestationObject":"YQ"}}`
	verify := "{" + flow + "," + credential + "}"
	revoke := `{"credential_id":"aabbccdd-1234-4abc-8abc-000000000002"}`
	withExtension := func(value string) string {
		return strings.Replace(verify, `"response":`, `"clientExtensionResults":`+value+`,"response":`, 1)
	}
	for _, tc := range []struct {
		name, path, body string
		operations       []string
		status           int
	}{
		{"duplicate flow", passkeyVerifyPath, "{" + flow + "," + flow + "," + credential + "}", []string{passkeyOperation}, 400},
		{"duplicate escaped credential key", passkeyVerifyPath, strings.Replace(verify, `"id":"YQ"`, `"id":"YQ","\u0069d":"YQ"`, 1), []string{passkeyOperation}, 400},
		{"unknown attestation field", passkeyVerifyPath, strings.Replace(verify, `"attestationObject":`, `"unexpected":true,"attestationObject":`, 1), []string{passkeyOperation}, 400},
		{"wrong-case field", passkeyVerifyPath, strings.Replace(verify, `"rawId"`, `"RawId"`, 1), []string{passkeyOperation}, 400},
		{"malformed extension", passkeyVerifyPath, withExtension(`[]`), []string{passkeyOperation}, 400},
		{"null extension", passkeyVerifyPath, withExtension(`null`), []string{passkeyOperation}, 400},
		{"unsolicited extension", passkeyVerifyPath, withExtension(`{"credProps":{"rk":true}}`), []string{passkeyOperation}, 400},
		{"padded raw ID", passkeyVerifyPath, strings.Replace(verify, `"rawId":"YQ"`, `"rawId":"YQ=="`, 1), []string{passkeyOperation}, 400},
		{"newline in client data", passkeyVerifyPath, strings.Replace(verify, `"clientDataJSON":"YQ"`, `"clientDataJSON":"Y\nQ"`, 1), []string{passkeyOperation}, 400},
		{"nonzero base64 padding bits", passkeyVerifyPath, strings.Replace(verify, `"attestationObject":"YQ"`, `"attestationObject":"YR"`, 1), []string{passkeyOperation}, 400},
		{"empty extensions", passkeyVerifyPath, withExtension(`{}`), []string{passkeyOperation}, 401},
		{"missing operation", passkeyVerifyPath, verify, nil, 400},
		{"repeated operation", passkeyVerifyPath, verify, []string{passkeyOperation, passkeyOperation}, 400},
		{"UUID operation required", passkeyRevokePath, revoke, []string{"not-a-uuid"}, 400},
		{"duplicate credential UUID", passkeyRevokePath, revoke[:len(revoke)-1] + "," + revoke[1:], []string{passkeyOperation}, 400},
		{"admitted revoke", passkeyRevokePath, revoke, []string{passkeyOperation}, 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.body))
			r.Header.Set("Origin", passkeyOrigin)
			r.Header.Set("Content-Type", "application/json")
			r.Header["X-Xca-Auth-Operation"] = tc.operations
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			code := "invalid_request"
			if tc.status == 401 {
				code = "authentication_required"
			}
			assertPasskeyResponse(t, w.Result(), w.Body.String(), tc.status, code)
		})
	}
}

func TestPasskeyRequestBodyLimit(t *testing.T) {
	cfg := passkeyHTTPConfig()
	cfg.MaxBodyBytes = 16
	handler, err := httpapi.NewAuthHandler(nil, nil, cfg)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	defer server.Close()
	for _, tc := range []struct {
		name, body string
		chunked    bool
		status     int
		code       string
	}{
		{"known equal", "{}" + strings.Repeat(" ", 14), false, 401, "authentication_required"},
		{"known over", "{}" + strings.Repeat(" ", 15), false, 413, "invalid_request"},
		{"chunked equal", "{}" + strings.Repeat(" ", 14), true, 401, "authentication_required"},
		{"chunked trailing spaces over", "{}" + strings.Repeat(" ", 15), true, 413, "invalid_request"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var body io.Reader = strings.NewReader(tc.body)
			if tc.chunked {
				body = struct{ io.Reader }{body}
			}
			r, err := http.NewRequest(http.MethodPost, server.URL+passkeyOptionsPath, body)
			if err != nil {
				t.Fatal(err)
			}
			r.Header.Set("Origin", passkeyOrigin)
			r.Header.Set("Content-Type", "application/json")
			res, err := server.Client().Do(r)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			data, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatal(err)
			}
			assertPasskeyResponse(t, res, string(data), tc.status, tc.code)
		})
	}
}

func assertPasskeyResponse(t *testing.T, res *http.Response, body string, status int, code string) {
	t.Helper()
	if res.StatusCode != status || (code != "" && strings.TrimSpace(body) != `{"error":{"code":"`+code+`"}}`) {
		t.Fatalf("response = %d %q, want %d %q", res.StatusCode, body, status, code)
	}
	if res.Header.Get("Cache-Control") != "no-store" || res.Header.Get("Access-Control-Allow-Origin") != "" || res.Header.Get("Set-Cookie") != "" {
		t.Fatalf("unsafe response headers: %v", res.Header)
	}
}
