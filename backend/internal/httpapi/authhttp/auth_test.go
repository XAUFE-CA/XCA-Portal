package authhttp_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/config"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/httpapi"
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers/legacy"
)

func TestAuthenticationSecurityAndContract(t *testing.T) {
	cfg := config.Config{Environment: "production", PublicOrigin: "https://portal.example.invalid", MaxBodyBytes: 64, SessionTTL: time.Hour}
	h, err := httpapi.NewAuthHandler(nil, nil, cfg)
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
	for _, tc := range []struct {
		method, path, body, origin, content string
		status                              int
	}{
		{"GET", "/api/v1/auth/session", "", "", "", 200},
		{"POST", "/api/v1/auth/logout", "{}", cfg.PublicOrigin, "application/json", 503},
		{"POST", "/api/v1/auth/logout", "{}", "https://evil.invalid", "application/json", 403},
		{"POST", "/api/v1/auth/logout", "{}", "", "application/json", 403},
		{"POST", "/api/v1/auth/logout", "{}", cfg.PublicOrigin, "text/plain", 415},
		{"POST", "/api/v1/auth/logout", "null", cfg.PublicOrigin, "application/json", 400},
		{"POST", "/api/v1/auth/logout", `{"extra":1}`, cfg.PublicOrigin, "application/json", 400},
		{"POST", "/api/v1/auth/logout", "{} {}", cfg.PublicOrigin, "application/json", 400},
		{"POST", "/api/v1/auth/logout", "{}" + strings.Repeat(" ", 63), cfg.PublicOrigin, "application/json", 413},
		{"POST", "/api/v1/auth/email/verify", `{}`, cfg.PublicOrigin, "application/json", 503},
		{"POST", "/api/v1/auth/operations/abandon", `{"operation_id":"invalid"}`, cfg.PublicOrigin, "application/json", 400},
		{"POST", "/api/v1/auth/operations/abandon", `{"operation_id":"aabbccdd-1234-4abc-8abc-000000000001"}`, cfg.PublicOrigin, "application/json", 503},
		{"POST", "/api/v1/auth/operations/abandon", `{"operation_id":"aabbccdd-1234-4abc-8abc-000000000001"}`, "https://evil.invalid", "application/json", 403},
	} {
		r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		if tc.path == "/api/v1/auth/logout" || tc.path == "/api/v1/auth/email/verify" {
			r.Header.Set("X-XCA-Auth-Operation", "aabbccdd-1234-4abc-8abc-000000000001")
		}
		r.Header.Set("Origin", tc.origin)
		r.Header.Set("Content-Type", tc.content)
		r.ContentLength = -1
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Errorf("%s %s: got %d want %d", tc.method, tc.body, w.Code, tc.status)
			continue
		}
		route, params, err := router.FindRoute(r)
		if err != nil {
			t.Fatal(err)
		}
		input := &openapi3filter.ResponseValidationInput{RequestValidationInput: &openapi3filter.RequestValidationInput{Request: r, Route: route, PathParams: params}, Status: w.Code, Header: w.Header(), Body: io.NopCloser(strings.NewReader(w.Body.String()))}
		if err := openapi3filter.ValidateResponse(context.Background(), input); err != nil {
			t.Errorf("%s %d: %v", tc.path, w.Code, err)
		}
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Error("missing no-store")
		}
		if w.Code == 204 {
			cookies := w.Result().Cookies()
			if len(cookies) != 1 || cookies[0].Name != "__Host-xca_session" || !cookies[0].Secure || !cookies[0].HttpOnly || cookies[0].Path != "/" || cookies[0].Domain != "" || cookies[0].SameSite != http.SameSiteLaxMode || cookies[0].MaxAge >= 0 {
				t.Error("invalid clearing cookie")
			}
		}
	}
}
