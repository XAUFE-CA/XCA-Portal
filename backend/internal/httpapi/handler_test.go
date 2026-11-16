package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestProbes(t *testing.T) {
	tests := []struct {
		name   string
		path   string
		check  DependencyCheck
		status int
		body   string
	}{
		{"alive without database", "/healthz", func(context.Context) error { t.Error("health checked dependency"); return nil }, 200, `{"status":"ok"}`},
		{"ready", "/readyz", func(ctx context.Context) error {
			if _, ok := ctx.Deadline(); !ok {
				t.Error("missing deadline")
			}
			return nil
		}, 200, `{"status":"ready"}`},
		{"not ready", "/readyz", func(context.Context) error { return errors.New("secret database detail") }, 503, `{"error":{"code":"service_unavailable"}}`},
		{"missing dependency", "/readyz", nil, 503, `{"error":{"code":"service_unavailable"}}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			res := httptest.NewRecorder()
			NewHandler(test.check, time.Second, 1024).ServeHTTP(res, httptest.NewRequest(http.MethodGet, test.path, nil))
			if res.Code != test.status || strings.TrimSpace(res.Body.String()) != test.body {
				t.Fatalf("status=%d body=%q", res.Code, res.Body.String())
			}
			if res.Header().Get("Cache-Control") != "no-store" || !strings.HasPrefix(res.Header().Get("Content-Type"), "application/json") {
				t.Fatalf("unexpected response headers: %v", res.Header())
			}
		})
	}
}

func TestRoutesAndBodyLimit(t *testing.T) {
	h := NewHandler(func(context.Context) error { return nil }, time.Second, 4)
	tests := []struct {
		method, path, body string
		status             int
	}{
		{http.MethodPost, "/healthz", "", 405},
		{http.MethodPost, "/api/v1/auth/email/code", "", 404},
		{http.MethodGet, "/healthz", "12345", 413},
	}
	for _, test := range tests {
		res := httptest.NewRecorder()
		h.ServeHTTP(res, httptest.NewRequest(test.method, test.path, strings.NewReader(test.body)))
		if res.Code != test.status {
			t.Errorf("%s %s: got %d, want %d", test.method, test.path, res.Code, test.status)
		}
	}
}

func TestReadinessTimeout(t *testing.T) {
	h := NewHandler(func(ctx context.Context) error {
		<-ctx.Done()
		return ctx.Err()
	}, time.Millisecond, 1024)
	res := httptest.NewRecorder()
	h.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if res.Code != http.StatusServiceUnavailable || strings.TrimSpace(res.Body.String()) != `{"error":{"code":"service_unavailable"}}` {
		t.Fatalf("status=%d body=%q", res.Code, res.Body.String())
	}
}
