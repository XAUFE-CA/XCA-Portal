package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

func TestCommandOptions(t *testing.T) {
	for _, tc := range []struct {
		args  []string
		valid bool
	}{
		{[]string{"create", "--email", "a@example.org", "--login", "a", "--display-name", "A"}, true},
		{[]string{"show", "--id", "a"}, true},
		{[]string{"revoke", "--allow-production", "--id", "a"}, true},
		{[]string{"create", "--email", "a@example.org"}, false},
		{[]string{"show", "--id", "a", "extra"}, false},
		{[]string{"remove", "--id", "a"}, false},
		{[]string{"show", "--email", "secret-value"}, false},
	} {
		_, err := parseArgs(tc.args)
		if (err == nil) != tc.valid {
			t.Errorf("parseArgs(%q) = %v", tc.args, err)
		}
		if err != nil && strings.Contains(err.Error(), "secret-value") {
			t.Error("diagnostic exposed an argument")
		}
	}
}

func TestInvitationTTLArgument(t *testing.T) {
	base := []string{"create", "--email", "a@example.org", "--login", "member", "--display-name", "Member"}
	for _, tc := range []struct {
		ttl   string
		want  time.Duration
		valid bool
	}{
		{"", 7 * 24 * time.Hour, true},
		{"12h30m", 12*time.Hour + 30*time.Minute, true},
		{"1us", time.Microsecond, true},
		{"8760h", 365 * 24 * time.Hour, true},
		{"0s", 0, false},
		{"-1h", 0, false},
		{"8761h", 0, false},
		{"1ns", 0, false},
		{"invalid", 0, false},
	} {
		args := append([]string(nil), base...)
		if tc.ttl != "" {
			args = append(args, "--ttl", tc.ttl)
		}
		opts, err := parseArgs(args)
		if (err == nil) != tc.valid || (tc.valid && opts.ttl != tc.want) {
			t.Errorf("TTL %q: got %v, %v", tc.ttl, opts.ttl, err)
		}
	}
}

func TestProductionRequiresExplicitFlagBeforeDatabaseAccess(t *testing.T) {
	values := map[string]string{
		"APP_ENV":             "production",
		"DATABASE_URL":        "postgres://test:password@db.example.org/xca?sslmode=verify-full",
		"MAIL_FROM":           "xca@example.invalid",
		"MAIL_TRANSPORT":      "smtp",
		"SMTP_HOST":           "smtp.example.org",
		"SMTP_PORT":           "465",
		"SMTP_TLS_MODE":       "implicit",
		"SMTP_USERNAME":       "service",
		"SMTP_PASSWORD":       "secret-password",
		"PUBLIC_ORIGIN":       "https://example.org",
		"OTP_HMAC_KEY":        base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef")),
		"RATE_LIMIT_HMAC_KEY": base64.StdEncoding.EncodeToString([]byte("fedcba9876543210fedcba9876543210")),
	}
	lookup := func(key string) (string, bool) { value, ok := values[key]; return value, ok }
	var out, diagnostics bytes.Buffer
	err := run(context.Background(), []string{"show", "--id", "a"}, lookup, &out, &diagnostics)
	if err == nil || err.Error() != "production requires --allow-production" {
		t.Fatalf("unexpected result: %v", err)
	}
	if diagnostics.String() != "APP_ENV=production\n" || out.Len() != 0 {
		t.Fatalf("unexpected output: %q / %q", diagnostics.String(), out.String())
	}
}
