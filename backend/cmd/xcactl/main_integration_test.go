//go:build integration

package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/testdb"
	"github.com/XAUFE-CA/XCA-Portal/backend/migrations"
)

func TestCLIInvitationLifecycle(t *testing.T) {
	dsn := testdb.New(t)
	if err := migrations.Up(dsn); err != nil {
		t.Fatal(err)
	}
	env := map[string]string{
		"APP_ENV": "test", "DATABASE_URL": dsn, "MAIL_FROM": "xca@example.invalid",
		"OTP_HMAC_KEY":        base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef")),
		"RATE_LIMIT_HMAC_KEY": base64.StdEncoding.EncodeToString([]byte("fedcba9876543210fedcba9876543210")),
	}
	lookup := func(name string) (string, bool) { value, ok := env[name]; return value, ok }
	var out, diagnostics bytes.Buffer
	ctx := context.Background()
	if err := run(ctx, []string{"create", "--email", "cli@example.invalid", "--login", "cli-user", "--display-name", "CLI User", "--ttl", "24h"}, lookup, &out, &diagnostics); err != nil {
		t.Fatal(err)
	}
	var id, token string
	for _, line := range strings.Split(out.String(), "\n") {
		if strings.HasPrefix(line, "id: ") {
			id = strings.TrimPrefix(line, "id: ")
		}
		if strings.HasPrefix(line, "token (shown once): ") {
			token = strings.TrimPrefix(line, "token (shown once): ")
		}
	}
	if id == "" || len(token) != 43 || strings.Contains(diagnostics.String(), token) {
		t.Fatal("create did not return a one-time token safely")
	}
	out.Reset()
	diagnostics.Reset()
	if err := run(ctx, []string{"show", "--id", id}, lookup, &out, &diagnostics); err != nil || !strings.Contains(out.String(), "status: active") || strings.Contains(out.String(), token) || strings.Contains(diagnostics.String(), token) {
		t.Fatal("show did not return safe active status")
	}
	out.Reset()
	if err := run(ctx, []string{"revoke", "--id", id}, lookup, &out, &diagnostics); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	if err := run(ctx, []string{"show", "--id", id}, lookup, &out, &diagnostics); err != nil || !strings.Contains(out.String(), "status: revoked") {
		t.Fatal("revocation did not persist")
	}
}
