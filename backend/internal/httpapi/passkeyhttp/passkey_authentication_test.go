package passkeyhttp_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/config"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/httpapi"
)

func passkeyAuthenticationHTTPConfig() config.Config {
	cfg := passkeyHTTPConfig()
	cfg.Passkeys.AuthenticationEnabled = true
	cfg.RateLimitHMACKey = []byte("fedcba9876543210fedcba9876543210")
	return cfg
}

func TestPasskeyAuthenticationHTTPFlagMatrix(t *testing.T) {
	for _, tc := range []struct {
		name                       string
		management, authentication bool
	}{
		{"neither", false, false},
		{"management only", true, false},
		{"authentication only", false, true},
		{"both", true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := passkeyAuthenticationHTTPConfig()
			cfg.Passkeys.Enabled, cfg.Passkeys.AuthenticationEnabled = tc.management, tc.authentication
			handler, err := httpapi.NewAuthHandler(nil, nil, cfg)
			if err != nil {
				t.Fatal(err)
			}
			for _, route := range []struct {
				path, method string
				enabled      bool
			}{
				{passkeyListPath, http.MethodGet, tc.management},
				{passkeyOptionsPath, http.MethodPost, tc.management},
				{passkeyVerifyPath, http.MethodPost, tc.management},
				{passkeyRevokePath, http.MethodPost, tc.management},
				{passkeyAuthenticationOptionsPath, http.MethodPost, tc.authentication},
				{passkeyAuthenticationVerifyPath, http.MethodPost, tc.authentication},
			} {
				w := httptest.NewRecorder()
				handler.ServeHTTP(w, httptest.NewRequest(http.MethodDelete, route.path, strings.NewReader("not JSON")))
				status, allow := http.StatusNotFound, ""
				if route.enabled {
					status, allow = http.StatusMethodNotAllowed, route.method
				}
				assertPasskeyResponse(t, w.Result(), w.Body.String(), status, "invalid_request")
				if got := w.Header().Get("Allow"); got != allow {
					t.Errorf("%s: Allow = %q, want %q", route.path, got, allow)
				}
			}
		})
	}
}

func TestPasskeyAuthenticationHTTPRequestGuards(t *testing.T) {
	handler, err := httpapi.NewAuthHandler(nil, nil, passkeyAuthenticationHTTPConfig())
	if err != nil {
		t.Fatal(err)
	}
	origin, media := []string{passkeyOrigin}, []string{"application/json"}
	for _, path := range []string{passkeyAuthenticationOptionsPath, passkeyAuthenticationVerifyPath} {
		for _, tc := range []struct {
			name, method, body string
			origins, media     []string
			status             int
		}{
			{"preflight", http.MethodOptions, "", origin, media, 405},
			{"missing origin", http.MethodPost, "{}", nil, media, 403},
			{"cross origin", http.MethodPost, "{}", []string{"https://other.example.invalid"}, media, 403},
			{"multiple origins", http.MethodPost, "{}", []string{passkeyOrigin, passkeyOrigin}, media, 403},
			{"missing content type", http.MethodPost, "{}", origin, nil, 415},
			{"wrong content type", http.MethodPost, "{}", origin, []string{"text/plain"}, 415},
			{"multiple content types", http.MethodPost, "{}", origin, []string{media[0], media[0]}, 415},
			{"second JSON value", http.MethodPost, "{} {}", origin, media, 400},
			{"unknown property", http.MethodPost, `{"email":"owner@example.invalid"}`, origin, media, 400},
			{"wrong top-level type", http.MethodPost, "null", origin, media, 400},
		} {
			t.Run(path+"/"+tc.name, func(t *testing.T) {
				r := httptest.NewRequest(tc.method, path, strings.NewReader(tc.body))
				r.Header["Origin"], r.Header["Content-Type"] = tc.origins, tc.media
				w := httptest.NewRecorder()
				handler.ServeHTTP(w, r)
				assertPasskeyResponse(t, w.Result(), w.Body.String(), tc.status, "invalid_request")
				if w.Header().Get("X-Content-Type-Options") != "nosniff" {
					t.Errorf("missing nosniff: %v", w.Header())
				}
			})
		}
	}
}

const passkeyAssertionJSON = `{"flow_id":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","credential":{"id":"YQ","rawId":"YQ","type":"public-key","authenticatorAttachment":"platform","clientExtensionResults":{},"response":{"authenticatorData":"YQ","clientDataJSON":"YQ","signature":"YQ","userHandle":"YQ"}}}`

func TestPasskeyAuthenticationHTTPStrictAssertionJSON(t *testing.T) {
	handler, err := httpapi.NewAuthHandler(nil, nil, passkeyAuthenticationHTTPConfig())
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, before, after string
	}{
		{"missing flow", `"flow_id":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",`, ""},
		{"duplicate escaped id", `"id":"YQ"`, `"id":"YQ","\u0069d":"YQ"`},
		{"wrong key case", `"rawId"`, `"rawID"`},
		{"missing type", `"type":"public-key",`, ""},
		{"nonstandard attachment", `"platform"`, `"unrecognized"`},
		{"non-string attachment", `"platform"`, `true`},
		{"padded id", `"id":"YQ"`, `"id":"YQ=="`},
		{"invalid raw id", `"rawId":"YQ"`, `"rawId":"Y+"`},
		{"null authenticator data", `"authenticatorData":"YQ"`, `"authenticatorData":null`},
		{"noncanonical authenticator data", `"authenticatorData":"YQ"`, `"authenticatorData":"YR"`},
		{"newline in client data", `"clientDataJSON":"YQ"`, `"clientDataJSON":"Y\nQ"`},
		{"missing signature", `"signature":"YQ",`, ""},
		{"invalid signature", `"signature":"YQ"`, `"signature":"Y"`},
		{"invalid user handle", `"userHandle":"YQ"`, `"userHandle":"YQ/"`},
		{"empty user handle", `"userHandle":"YQ"`, `"userHandle":""`},
		{"invalid extension shape", `"clientExtensionResults":{}`, `"clientExtensionResults":[]`},
		{"unsolicited extension", `"clientExtensionResults":{}`, `"clientExtensionResults":{"appid":true}`},
		{"registration field", `"signature":"YQ"`, `"attestationObject":"YQ"`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := strings.Replace(passkeyAssertionJSON, tc.before, tc.after, 1)
			checkBadPasskeyAssertion(t, handler, body, passkeyOperation)
		})
	}
	for _, tc := range []struct {
		name       string
		operations []string
	}{
		{"missing operation ID", nil},
		{"malformed operation ID", []string{"not-a-uuid"}},
		{"multiple operation IDs", []string{passkeyOperation, passkeyOperation}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			checkBadPasskeyAssertion(t, handler, passkeyAssertionJSON, tc.operations...)
		})
	}
}

func checkBadPasskeyAssertion(t *testing.T, handler http.Handler, body string, operations ...string) {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, passkeyAuthenticationVerifyPath, strings.NewReader(body))
	r.Header.Set("Origin", passkeyOrigin)
	r.Header.Set("Content-Type", "application/json")
	r.Header["X-Xca-Auth-Operation"] = operations
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assertPasskeyResponse(t, w.Result(), w.Body.String(), 400, "invalid_request")
}

func TestPasskeyAuthenticationHTTPBodyLimit(t *testing.T) {
	cfg := passkeyAuthenticationHTTPConfig()
	cfg.MaxBodyBytes = 16
	handler, err := httpapi.NewAuthHandler(nil, nil, cfg)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	defer server.Close()
	for _, tc := range []struct {
		name    string
		spaces  int
		chunked bool
		status  int
		code    string
	}{
		{"known exact limit", 14, false, 503, "service_unavailable"},
		{"known over limit", 15, false, 413, "invalid_request"},
		{"chunked exact limit", 14, true, 503, "service_unavailable"},
		{"chunked trailing whitespace over limit", 15, true, 413, "invalid_request"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var reader io.Reader = strings.NewReader("{}" + strings.Repeat(" ", tc.spaces))
			if tc.chunked {
				reader = struct{ io.Reader }{reader}
			}
			r, err := http.NewRequestWithContext(t.Context(), http.MethodPost, server.URL+passkeyAuthenticationOptionsPath, reader)
			if err != nil {
				t.Fatal(err)
			}
			r.Header.Set("Origin", passkeyOrigin)
			r.Header.Set("Content-Type", "application/json; charset=utf-8")
			res, err := server.Client().Do(r)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatal(err)
			}
			assertPasskeyResponse(t, res, string(body), tc.status, tc.code)
		})
	}
}
