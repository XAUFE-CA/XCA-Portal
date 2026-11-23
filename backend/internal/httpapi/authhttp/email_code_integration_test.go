//go:build integration

package authhttp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/emailcode"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/config"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/invitation"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/mail"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/testdb"
	"github.com/XAUFE-CA/XCA-Portal/backend/migrations"
	"github.com/jackc/pgx/v5/pgxpool"
)

type failingSender struct{ release <-chan struct{} }

func (s failingSender) Send(ctx context.Context, _ mail.Message) error {
	select {
	case <-s.release:
		return errors.New("sensitive delivery provider detail")
	case <-ctx.Done():
		return ctx.Err()
	}
}

func TestUnregisteredEmailAdapterNonEnumeration(t *testing.T) {
	dsn := testdb.New(t)
	if err := migrations.Up(dsn); err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal("cannot open isolated database")
	}
	defer pool.Close()
	_, err = pool.Exec(context.Background(), `INSERT INTO users (email, login_name, display_name, status) VALUES
		('active@example.invalid', 'active-user', 'Active', 'active'),
		('disabled@example.invalid', 'disabled-user', 'Disabled', 'disabled')`)
	if err != nil {
		t.Fatal(err)
	}
	_, token, err := invitation.NewStore(pool).Create(context.Background(), invitation.CreateInput{Email: "invited@example.invalid", LoginName: "invited-user", DisplayName: "Invited"})
	if err != nil {
		t.Fatal(err)
	}
	release := make(chan struct{})
	cfg := config.Config{OTPKeyVersion: 1, OTPHMACKey: []byte("0123456789abcdef0123456789abcdef"), RateLimitHMACKey: []byte("fedcba9876543210fedcba9876543210")}
	service, err := emailcode.New(context.Background(), pool, cfg, failingSender{release}, nil, 64)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { close(release); service.Close() }()
	handler := &emailCodeHandler{service: service, origin: "https://portal.example.invalid", maxBody: 512}
	invoke := func(email, secret, forwarded string) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]string{"email": email, "invitation": secret})
		if secret == "" {
			body, _ = json.Marshal(map[string]string{"email": email})
		}
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/email/code", bytes.NewReader(body))
		req.RemoteAddr = "192.0.2.1:1234"
		req.Header.Set("Origin", "https://portal.example.invalid")
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Forwarded-For", forwarded)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		return response
	}
	cases := []struct{ email, secret string }{
		{"active@example.invalid", ""}, {"disabled@example.invalid", ""}, {"unknown@example.invalid", ""},
		{"invited@example.invalid", token}, {"bad-invitation@example.invalid", "invalid"},
	}
	var expectedHeader http.Header
	var expectedRetry string
	for _, tc := range cases {
		started := time.Now()
		result := invoke(tc.email, tc.secret, "203.0.113.1")
		if time.Since(started) > 5*time.Second {
			t.Fatal("request waited for blocked email delivery")
		}
		if result.Code != http.StatusAccepted {
			t.Fatalf("expected uniform acceptance, got %d", result.Code)
		}
		if result.Header().Get("Cache-Control") != "no-store" || result.Header().Get("X-Content-Type-Options") != "nosniff" || result.Header().Get("Set-Cookie") != "" {
			t.Fatal("invalid security headers")
		}
		if expectedHeader == nil {
			expectedHeader = result.Header().Clone()
		} else if fmt.Sprint(expectedHeader) != fmt.Sprint(result.Header()) {
			t.Fatal("eligibility changed response headers")
		}
		var body map[string]json.RawMessage
		if json.Unmarshal(result.Body.Bytes(), &body) != nil || len(body) != 2 || body["flow_id"] == nil || body["expires_at"] == nil {
			t.Fatal("acceptance response does not match the documented shape")
		}
		limited := invoke(tc.email, tc.secret, "203.0.113.2")
		if limited.Code != http.StatusTooManyRequests || !strings.Contains(limited.Body.String(), `"rate_limited"`) || limited.Header().Get("Retry-After") == "" || limited.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("limit response changed by eligibility")
		}
		if expectedRetry == "" {
			expectedRetry = limited.Header().Get("Retry-After")
		} else if limited.Header().Get("Retry-After") != expectedRetry {
			t.Fatal("eligibility changed retry information")
		}
	}
	for i := range 21 {
		result := invoke(fmt.Sprintf("forwarded-%d@example.invalid", i), "", fmt.Sprintf("198.51.100.%d", i+1))
		if i < 20 && result.Code != http.StatusAccepted || i == 20 && result.Code != http.StatusTooManyRequests {
			t.Fatal("untrusted forwarded addresses changed source rate limiting")
		}
	}
	bad := httptest.NewRequest(http.MethodPost, "/api/v1/auth/email/code", strings.NewReader(`{"email":"invalid@example.invalid"}`))
	bad.Header.Set("Origin", "https://wrong.example.invalid")
	bad.Header.Set("Content-Type", "application/json")
	bad.RemoteAddr = "192.0.2.1:1234"
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, bad)
	if recorder.Code != http.StatusForbidden {
		t.Fatal("foreign origin accepted")
	}
	before := 0
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM email_challenges`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	chunked := httptest.NewRequest(http.MethodPost, "/api/v1/auth/email/code", strings.NewReader(`{"email":"invalid@example.invalid"}`+strings.Repeat(" ", 600)))
	chunked.Header.Set("Origin", "https://portal.example.invalid")
	chunked.Header.Set("Content-Type", "application/json")
	chunked.RemoteAddr = "192.0.2.1:1234"
	chunked.ContentLength = -1
	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, chunked)
	after := 0
	if recorder.Code != http.StatusRequestEntityTooLarge || pool.QueryRow(context.Background(), `SELECT count(*) FROM email_challenges`).Scan(&after) != nil || before != after {
		t.Fatal("oversized unknown-length body caused a side effect")
	}
	server := httptest.NewServer(handler)
	defer server.Close()
	postChunked := func(body string) int {
		req, err := http.NewRequest(http.MethodPost, server.URL, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.ContentLength = -1
		req.TransferEncoding = []string{"chunked"}
		req.Header.Set("Origin", "https://portal.example.invalid")
		req.Header.Set("Content-Type", "application/json")
		response, err := server.Client().Do(req)
		if err != nil {
			t.Fatal("chunked request failed")
		}
		defer response.Body.Close()
		return response.StatusCode
	}
	payload := `{"email":"edge@example.invalid"}`
	exact := payload + strings.Repeat(" ", 512-len(payload))
	if status := postChunked(exact); status != http.StatusAccepted {
		t.Fatalf("exactly limited chunked body returned %d", status)
	}
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM email_challenges`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if status := postChunked(exact + " "); status != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized chunked body returned %d", status)
	}
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM email_challenges`).Scan(&after); err != nil || before != after {
		t.Fatal("oversized chunked body caused a side effect")
	}
}
