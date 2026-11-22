package config

import "testing"

func TestPasskeyAuthenticationSwitch(t *testing.T) {
	for _, tc := range []struct {
		name, env, authentication, management, rp string
		wantAuth, wantManage, wantError           bool
	}{
		{name: "defaults"},
		{name: "authentication only", env: "test", authentication: "true", rp: "localhost", wantAuth: true},
		{name: "management only", env: "test", management: "true", rp: "localhost", wantManage: true},
		{name: "both", env: "test", authentication: "true", management: "true", rp: "localhost", wantAuth: true, wantManage: true},
		{name: "not allowed in development", env: "development", authentication: "true", rp: "localhost", wantError: true},
		{name: "not allowed in production", env: "production", authentication: "true", rp: "example.org", wantError: true},
		{name: "invalid RP", env: "test", authentication: "true", rp: "example.org", wantError: true},
		{name: "invalid explicit switch", env: "test", authentication: "TRUE", rp: "localhost", wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env := testEnv()
			if tc.env != "" {
				env["APP_ENV"] = tc.env
			}
			if tc.env == "production" {
				env["DATABASE_URL"] = "postgres://test:password@db.example.org/xca?sslmode=verify-full"
				env["MAIL_TRANSPORT"], env["SMTP_HOST"], env["SMTP_PORT"] = "smtp", "smtp.example.org", "465"
				env["SMTP_TLS_MODE"], env["SMTP_USERNAME"], env["SMTP_PASSWORD"] = "implicit", "service", "example-test-password"
				env["PUBLIC_ORIGIN"] = "https://portal.example.org"
			} else if tc.rp != "" {
				env["PUBLIC_ORIGIN"] = "http://localhost:4102"
			}
			if tc.authentication != "" {
				env["PASSKEY_AUTHENTICATION_ENABLED"] = tc.authentication
			}
			if tc.management != "" {
				env["PASSKEY_MANAGEMENT_ENABLED"] = tc.management
			}
			if tc.rp != "" {
				env["WEBAUTHN_RP_ID"], env["WEBAUTHN_RP_NAME"] = tc.rp, "XCA Test"
			}
			cfg, err := loadMap(env)
			if (err != nil) != tc.wantError {
				t.Fatalf("configuration error = %v, want error=%t", err, tc.wantError)
			}
			if !tc.wantError && (cfg.Passkeys.AuthenticationEnabled != tc.wantAuth || cfg.Passkeys.Enabled != tc.wantManage) {
				t.Fatalf("authentication=%t management=%t", cfg.Passkeys.AuthenticationEnabled, cfg.Passkeys.Enabled)
			}
		})
	}
}
