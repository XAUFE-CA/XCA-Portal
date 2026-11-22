package config

import (
	"testing"
	"time"
)

func TestPasskeyConfiguration(t *testing.T) {
	cfg, err := loadMap(testEnv())
	if err != nil || cfg.Passkeys.Enabled || cfg.Passkeys.RecentOTP != 5*time.Minute {
		t.Fatalf("default management config: %+v, %v", cfg.Passkeys, err)
	}
	for _, tc := range []struct {
		name, env, flag, origin, rp, label, window string
		want                                       bool
	}{
		{"loopback name", "test", "true", "http://localhost:4102", "localhost", "XCA Test", "90s", true},
		{"registrable parent", "test", "true", "https://portal.example.com:4443", "example.com", "XCA Test", "5m", true},
		{"exact host", "test", "true", "https://portal.example.com", "portal.example.com", "XCA Test", "5m", true},
		{"not enabled in development", "development", "true", "http://localhost:4102", "localhost", "XCA Test", "5m", false},
		{"unknown flag", "test", "yes", "http://localhost:4102", "localhost", "XCA Test", "5m", false},
		{"missing RP", "test", "true", "http://localhost:4102", "", "XCA Test", "5m", false},
		{"missing RP label", "test", "true", "http://localhost:4102", "localhost", "", "5m", false},
		{"public suffix", "test", "true", "https://portal.example.co.uk", "co.uk", "XCA Test", "5m", false},
		{"private suffix", "test", "true", "https://example.github.io", "github.io", "XCA Test", "5m", false},
		{"unrelated suffix", "test", "true", "https://notexample.com", "example.com", "XCA Test", "5m", false},
		{"wrong scheme", "test", "true", "http://portal.example.com", "example.com", "XCA Test", "5m", false},
		{"numeric host", "test", "true", "http://127.0.0.1:4102", "127.0.0.1", "XCA Test", "5m", false},
		{"noncanonical default port", "test", "true", "https://portal.example.com:443", "example.com", "XCA Test", "5m", false},
		{"noncanonical host", "test", "true", "https://Portal.example.com", "example.com", "XCA Test", "5m", false},
		{"bad RP while disabled", "test", "false", "https://portal.example.com", "other.example.com", "XCA Test", "5m", false},
		{"bad window", "test", "true", "http://localhost:4102", "localhost", "XCA Test", "0s", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env := testEnv()
			env["APP_ENV"], env["PASSKEY_MANAGEMENT_ENABLED"], env["PUBLIC_ORIGIN"] = tc.env, tc.flag, tc.origin
			env["WEBAUTHN_RP_ID"], env["WEBAUTHN_RP_NAME"], env["PASSKEY_RECENT_OTP_WINDOW"] = tc.rp, tc.label, tc.window
			c, err := loadMap(env)
			if (err == nil) != tc.want {
				t.Fatalf("valid=%t, got %v", tc.want, err)
			}
			if tc.want && (!c.Passkeys.Enabled || c.Passkeys.RPID != tc.rp || c.Passkeys.RPName != tc.label) {
				t.Fatalf("incorrect RP configuration: %+v", c.Passkeys)
			}
		})
	}
}
