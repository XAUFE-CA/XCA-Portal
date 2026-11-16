package config

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

func testEnv() map[string]string {
	return map[string]string{
		"DATABASE_URL":        "postgres://test:sample-password@127.0.0.1:5432/xca?sslmode=disable",
		"MAIL_FROM":           "xca@example.invalid",
		"OTP_HMAC_KEY":        base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef")),
		"RATE_LIMIT_HMAC_KEY": base64.StdEncoding.EncodeToString([]byte("fedcba9876543210fedcba9876543210")),
	}
}

func loadMap(values map[string]string) (Config, error) {
	return Load(func(name string) (string, bool) { value, ok := values[name]; return value, ok })
}

func TestDevelopmentDefaults(t *testing.T) {
	c, err := loadMap(testEnv())
	if err != nil {
		t.Fatal(err)
	}
	if c.ListenAddr != "127.0.0.1:8080" || c.SMTPHost != "127.0.0.1" || c.SMTPPort != 2525 || c.SessionTTL != 24*time.Hour || c.PublicOrigin != "http://127.0.0.1:4100" {
		t.Fatalf("unexpected defaults: listen=%s SMTP=%s:%d session=%s origin=%s", c.ListenAddr, c.SMTPHost, c.SMTPPort, c.SessionTTL, c.PublicOrigin)
	}
}

func TestSMTPPortOverride(t *testing.T) {
	env := testEnv()
	env["SMTP_PORT"] = "2626"
	c, err := loadMap(env)
	if err != nil {
		t.Fatal(err)
	}
	if c.SMTPPort != 2626 {
		t.Fatalf("SMTP port = %d, want 2626", c.SMTPPort)
	}
}

func TestOTPKeyVersions(t *testing.T) {
	env := testEnv()
	env["OTP_HMAC_KEY_VERSION"] = "2"
	env["OTP_PREVIOUS_HMAC_KEYS"] = "1:" + base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	env["OTP_HMAC_KEY"] = base64.StdEncoding.EncodeToString([]byte("abcdef0123456789abcdef0123456789"))
	c, err := loadMap(env)
	if err != nil || c.OTPKeyVersion != 2 || len(c.OTPPreviousKeys[1]) != 32 {
		t.Fatalf("key rotation configuration rejected: %v", err)
	}
	for _, previous := range []string{
		"2:" + env["OTP_HMAC_KEY"],
		"0:" + env["OTP_HMAC_KEY"],
		"1:not-base64",
		"1:" + env["RATE_LIMIT_HMAC_KEY"],
		"1:" + env["OTP_HMAC_KEY"],
		"1:" + env["OTP_PREVIOUS_HMAC_KEYS"] + ",1:" + env["OTP_HMAC_KEY"],
	} {
		env["OTP_PREVIOUS_HMAC_KEYS"] = previous
		if _, err := loadMap(env); err == nil {
			t.Error("accepted invalid previous OTP key configuration")
		}
	}
	env["OTP_PREVIOUS_HMAC_KEYS"] = ""
	env["OTP_HMAC_KEY_VERSION"] = "0"
	if _, err := loadMap(env); err == nil {
		t.Error("accepted invalid current OTP key version")
	}
}

func TestRejectsInvalidConfigurationWithoutLeakingValues(t *testing.T) {
	cases := []struct{ name, key, value string }{
		{"missing database", "DATABASE_URL", ""},
		{"invalid database port", "DATABASE_URL", "postgres://test:secret@localhost:99999/db"},
		{"ambiguous TLS", "DATABASE_URL", "postgres://test:secret@localhost/db?sslmode=disable&sslmode=verify-full"},
		{"invalid environment", "APP_ENV", "staging"},
		{"empty listen host", "API_LISTEN_ADDR", ":8080"},
		{"invalid listen port", "API_LISTEN_ADDR", "127.0.0.1:0"},
		{"invalid SMTP port", "SMTP_PORT", "65536"},
		{"signed SMTP port", "SMTP_PORT", "+25"},
		{"invalid SMTP hostname", "SMTP_HOST", "not..a.host"},
		{"invalid listen hostname", "API_LISTEN_ADDR", "bad_host:8080"},
		{"invalid SMTP TLS", "SMTP_TLS_MODE", "skip-verify"},
		{"unpaired SMTP credentials", "SMTP_PASSWORD", "secret-password"},
		{"invalid sender", "MAIL_FROM", "not-an-address"},
		{"invalid key", "OTP_HMAC_KEY", "secret-value"},
		{"repeated key", "OTP_HMAC_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32))},
		{"invalid origin", "PUBLIC_ORIGIN", "http://example.org/path"},
		{"origin with empty query", "PUBLIC_ORIGIN", "http://example.org?"},
		{"origin with empty fragment", "PUBLIC_ORIGIN", "http://example.org#"},
		{"invalid proxy", "TRUSTED_PROXY_CIDRS", "192.0.2.1/24"},
		{"invalid duration", "API_READ_TIMEOUT", "0s"},
		{"excessive timeout", "API_SHUTDOWN_TIMEOUT", "1h"},
		{"invalid body limit", "API_MAX_BODY_BYTES", "-1"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env := testEnv()
			env[tc.key] = tc.value
			_, err := loadMap(env)
			if err == nil {
				t.Fatal("expected validation error")
			}
			if tc.value != "" && strings.Contains(err.Error(), tc.value) {
				t.Fatalf("error includes configured value: %v", err)
			}
		})
	}
	env := testEnv()
	env["RATE_LIMIT_HMAC_KEY"] = env["OTP_HMAC_KEY"]
	if _, err := loadMap(env); err == nil {
		t.Fatal("identical HMAC keys accepted")
	}
}

func TestProductionMailAndTransport(t *testing.T) {
	production := testEnv()
	production["APP_ENV"] = "production"
	production["DATABASE_URL"] = "postgres://test:password@db.example.org/xca?sslmode=verify-full"
	production["MAIL_TRANSPORT"] = "smtp"
	production["SMTP_HOST"] = "smtp.example.org"
	production["SMTP_PORT"] = "465"
	production["SMTP_TLS_MODE"] = "implicit"
	production["SMTP_USERNAME"] = "service"
	production["SMTP_PASSWORD"] = "secret-password"
	production["PUBLIC_ORIGIN"] = "https://example.org"
	production["TRUSTED_PROXY_CIDRS"] = "192.0.2.0/24,2001:db8::/32"
	if _, err := loadMap(production); err != nil {
		t.Fatalf("valid production: %v", err)
	}
	for _, change := range []struct{ key, value string }{
		{"MAIL_TRANSPORT", "mailpit"}, {"SMTP_TLS_MODE", "none"}, {"SMTP_HOST", "127.0.0.1"},
		{"SMTP_HOST", "mailpit"}, {"SMTP_PASSWORD", ""}, {"PUBLIC_ORIGIN", "http://example.org"},
		{"DATABASE_URL", "postgres://test:password@db.example.org/xca?sslmode=require"},
		{"TRUSTED_PROXY_CIDRS", "0.0.0.0/0"},
		{"TRUSTED_PROXY_CIDRS", "::/0"},
	} {
		env := make(map[string]string, len(production))
		for k, v := range production {
			env[k] = v
		}
		env[change.key] = change.value
		if _, err := loadMap(env); err == nil {
			t.Errorf("accepted unsafe %s", change.key)
		}
	}
}
