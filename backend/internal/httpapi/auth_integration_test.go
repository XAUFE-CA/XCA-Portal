//go:build integration

package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/config"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/invitation"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/mail"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/testdb"
	"github.com/XAUFE-CA/XCA-Portal/backend/migrations"
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers/legacy"
	"github.com/jackc/pgx/v5/pgxpool"
)

type capturedSender struct{ messages chan mail.Message }

func (s capturedSender) Send(ctx context.Context, msg mail.Message) error {
	select {
	case s.messages <- msg:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func TestAuthenticationHTTPLifecycle(t *testing.T) {
	ctx := context.Background()
	dsn := testdb.New(t)
	if err := migrations.Up(dsn); err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	cfg := config.Config{Environment: "production", PublicOrigin: "https://portal.example.invalid", MaxBodyBytes: 1024, SessionTTL: time.Hour, DependencyTimeout: time.Second,
		OTPKeyVersion: 1, OTPHMACKey: []byte("0123456789abcdef0123456789abcdef"), RateLimitHMACKey: []byte("fedcba9876543210fedcba9876543210")}
	sender := capturedSender{messages: make(chan mail.Message, 1)}
	service, err := auth.New(ctx, pool, cfg, sender, nil, 8)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	_, invitationToken, err := invitation.NewStore(pool).Create(ctx, invitation.CreateInput{Email: "http@example.invalid", LoginName: "http-member", DisplayName: "HTTP Member"})
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
	handler, err := NewAuthHandler(pool, service, cfg)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	defer server.Close()
	client := server.Client()
	do := func(method, path, body string, cookie *http.Cookie) *http.Response {
		t.Helper()
		r, err := http.NewRequest(method, server.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if method == http.MethodPost {
			r.Header.Set("Origin", cfg.PublicOrigin)
			r.Header.Set("Content-Type", "application/json")
			if path == "/api/v1/auth/email/verify" {
				r.Header.Set("X-XCA-Auth-Operation", "aabbccdd-1234-4abc-8abc-000000000001")
			} else if path == "/api/v1/auth/logout" {
				r.Header.Set("X-XCA-Auth-Operation", "aabbccdd-1234-4abc-8abc-000000000002")
			}
		}
		if cookie != nil {
			r.AddCookie(cookie)
		}
		response, err := client.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		response.Body = io.NopCloser(bytes.NewReader(data))
		contractRequest := r.Clone(ctx)
		contractURL := *r.URL
		contractURL.Scheme = ""
		contractURL.Host = ""
		contractRequest.URL = &contractURL
		route, params, err := router.FindRoute(contractRequest)
		if err != nil {
			t.Fatal(err)
		}
		input := &openapi3filter.ResponseValidationInput{RequestValidationInput: &openapi3filter.RequestValidationInput{Request: contractRequest, Route: route, PathParams: params}, Status: response.StatusCode, Header: response.Header, Body: io.NopCloser(bytes.NewReader(data))}
		if err := openapi3filter.ValidateResponse(ctx, input); err != nil {
			t.Fatalf("response %s %d violates OpenAPI: %v", path, response.StatusCode, err)
		}
		return response
	}
	payload, _ := json.Marshal(map[string]string{"email": "http@example.invalid", "invitation": invitationToken})
	response := do("POST", "/api/v1/auth/email/code", string(payload), nil)
	var accepted struct {
		FlowID string `json:"flow_id"`
	}
	if response.StatusCode != 202 || json.NewDecoder(response.Body).Decode(&accepted) != nil {
		t.Fatal("code request failed")
	}
	response.Body.Close()
	var message mail.Message
	select {
	case message = <-sender.messages:
	case <-time.After(5 * time.Second):
		t.Fatal("no message delivered")
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		var delivered bool
		if err := pool.QueryRow(ctx, `SELECT delivered_at IS NOT NULL FROM email_challenges WHERE flow_id=$1`, accepted.FlowID).Scan(&delivered); err != nil {
			t.Fatal(err)
		}
		if delivered {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("delivery confirmation timed out")
		}
		time.Sleep(10 * time.Millisecond)
	}
	payload, _ = json.Marshal(map[string]string{"flow_id": accepted.FlowID, "code": message.Code})
	response = do("POST", "/api/v1/auth/email/verify", string(payload), nil)
	var result struct {
		Identity struct {
			User string `json:"user"`
		} `json:"identity"`
	}
	if response.StatusCode != 200 || json.NewDecoder(response.Body).Decode(&result) != nil || result.Identity.User != "http-member" {
		t.Fatal("verification failed")
	}
	response.Body.Close()
	cookies := response.Cookies()
	if len(cookies) != 1 || cookies[0].Name != "__Host-xca_session" || !cookies[0].Secure || !cookies[0].HttpOnly || cookies[0].Path != "/" || cookies[0].Domain != "" || cookies[0].SameSite != http.SameSiteLaxMode {
		t.Fatal("invalid session cookie")
	}
	cookie := cookies[0]
	response = do("GET", "/api/v1/auth/session", "", cookie)
	var body bytes.Buffer
	_, _ = body.ReadFrom(response.Body)
	response.Body.Close()
	if response.StatusCode != 200 || !strings.Contains(body.String(), `"user":"http-member"`) {
		t.Fatal("session not authenticated")
	}
	response = do("POST", "/api/v1/auth/logout", "{}", cookie)
	response.Body.Close()
	if response.StatusCode != 204 {
		t.Fatal("logout failed")
	}
	response = do("GET", "/api/v1/auth/session", "", cookie)
	body.Reset()
	_, _ = body.ReadFrom(response.Body)
	response.Body.Close()
	if response.StatusCode != 200 || !strings.Contains(body.String(), `"identity":null`) {
		t.Fatal("logout did not revoke session")
	}
	pool.Close()
	response = do("GET", "/api/v1/auth/session", "", cookie)
	response.Body.Close()
	if response.StatusCode != 503 {
		t.Fatal("database failure was mistaken for guest")
	}
}
