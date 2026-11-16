package httpapi

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers/legacy"
)

func TestProbeResponsesMatchOpenAPI(t *testing.T) {
	doc, err := openapi3.NewLoader().LoadFromFile("../../api/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if err := doc.Validate(context.Background()); err != nil {
		t.Fatal(err)
	}
	router, err := legacy.NewRouter(doc)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		path  string
		check DependencyCheck
		body  string
	}{
		{"/healthz", nil, ""},
		{"/healthz", nil, string(bytes.Repeat([]byte("x"), 1025))},
		{"/readyz", func(context.Context) error { return nil }, ""},
		{"/readyz", func(context.Context) error { return errors.New("private dependency detail") }, ""},
	} {
		req := httptest.NewRequest(http.MethodGet, tc.path, bytes.NewBufferString(tc.body))
		recorder := httptest.NewRecorder()
		NewHandler(tc.check, time.Second, 1024).ServeHTTP(recorder, req)
		route, params, err := router.FindRoute(req)
		if err != nil {
			t.Fatal(err)
		}
		input := &openapi3filter.ResponseValidationInput{
			RequestValidationInput: &openapi3filter.RequestValidationInput{Request: req, PathParams: params, Route: route},
			Status:                 recorder.Code,
			Header:                 recorder.Header(),
			Body:                   io.NopCloser(bytes.NewReader(recorder.Body.Bytes())),
		}
		if err := openapi3filter.ValidateResponse(context.Background(), input); err != nil {
			t.Errorf("%s status %d: %v", tc.path, recorder.Code, err)
		}
		if tc.path == "/healthz" && recorder.Code == http.StatusOK {
			input.Body = io.NopCloser(bytes.NewBufferString(`{"status":"unexpected"}`))
			if err := openapi3filter.ValidateResponse(context.Background(), input); err == nil {
				t.Error("invalid probe status passed contract validation")
			}
		}
	}
}

func TestAuthenticationContractExamples(t *testing.T) {
	doc, err := openapi3.NewLoader().LoadFromFile("../../api/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	router, err := legacy.NewRouter(doc)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, method, path, body string
		status                   int
		cookie                   bool
		valid                    bool
	}{
		{"accepted flow", http.MethodPost, "/api/v1/auth/email/code", `{"flow_id":"abcdefghijklmnopqrstuvwxyz012345","expires_at":"2026-11-15T12:00:00Z"}`, 202, false, true},
		{"guest", http.MethodGet, "/api/v1/auth/session", `{"identity":null}`, 200, false, true},
		{"verified identity", http.MethodPost, "/api/v1/auth/email/verify", `{"identity":{"user":"member","label":"Member"}}`, 200, true, true},
		{"verification cannot return guest", http.MethodPost, "/api/v1/auth/email/verify", `{"identity":null}`, 200, true, false},
		{"logout without body", http.MethodPost, "/api/v1/auth/logout", ``, 204, true, true},
		{"logout with body", http.MethodPost, "/api/v1/auth/logout", `{}`, 204, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			route, params, err := router.FindRoute(req)
			if err != nil {
				t.Fatal(err)
			}
			headers := http.Header{"Cache-Control": {"no-store"}, "Content-Type": {"application/json"}}
			if tc.cookie {
				headers.Set("Set-Cookie", "example=opaque; HttpOnly; Path=/")
			}
			input := &openapi3filter.ResponseValidationInput{
				RequestValidationInput: &openapi3filter.RequestValidationInput{Request: req, PathParams: params, Route: route},
				Status:                 tc.status,
				Header:                 headers,
				Body:                   io.NopCloser(bytes.NewBufferString(tc.body)),
			}
			err = openapi3filter.ValidateResponse(context.Background(), input)
			response := route.Operation.Responses.Status(tc.status)
			if err == nil && tc.body != "" && response != nil && len(response.Value.Content) == 0 {
				err = errors.New("response body is not permitted by the contract")
			}
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%t, validation error: %v", tc.valid, err)
			}
		})
	}
}
