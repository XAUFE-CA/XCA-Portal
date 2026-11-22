package config

import (
	"encoding/base64"
	"errors"
	"net"
	"net/mail"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Environment       string
	ListenAddr        string
	DatabaseURL       string
	MailTransport     string
	SMTPHost          string
	SMTPPort          int
	SMTPTLSMode       string
	SMTPUsername      string
	SMTPPassword      string
	MailFrom          string
	OTPHMACKey        []byte
	OTPKeyVersion     int
	OTPPreviousKeys   map[int][]byte
	RateLimitHMACKey  []byte
	PublicOrigin      string
	Passkeys          PasskeyConfig
	TrustedProxies    []netip.Prefix
	SessionTTL        time.Duration
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	ShutdownTimeout   time.Duration
	DependencyTimeout time.Duration
	MaxBodyBytes      int64
}

// Load reads process environment values without including their contents in errors.
// Load 读取进程环境变量，错误信息不包含变量值。
func Load(lookup func(string) (string, bool)) (Config, error) {
	var c Config
	c.Environment = value(lookup, "APP_ENV", "development")
	if c.Environment != "development" && c.Environment != "test" && c.Environment != "production" {
		return c, invalid("APP_ENV")
	}
	c.ListenAddr = value(lookup, "API_LISTEN_ADDR", "127.0.0.1:8080")
	host, port, err := net.SplitHostPort(c.ListenAddr)
	if err != nil || !validHost(host) || !validPort(port) {
		return c, invalid("API_LISTEN_ADDR")
	}
	c.DatabaseURL = value(lookup, "DATABASE_URL", "")
	if err := validateDatabase(c.DatabaseURL, c.Environment == "production"); err != nil {
		return c, err
	}
	if err := loadMail(&c, lookup); err != nil {
		return c, err
	}
	if c.OTPHMACKey, err = secret(lookup, "OTP_HMAC_KEY"); err != nil {
		return c, err
	}
	if c.RateLimitHMACKey, err = secret(lookup, "RATE_LIMIT_HMAC_KEY"); err != nil {
		return c, err
	}
	if string(c.OTPHMACKey) == string(c.RateLimitHMACKey) {
		return c, errors.New("OTP_HMAC_KEY and RATE_LIMIT_HMAC_KEY must differ")
	}
	if err := loadOTPKeys(&c, lookup); err != nil {
		return c, err
	}
	c.PublicOrigin = value(lookup, "PUBLIC_ORIGIN", "http://127.0.0.1:4100")
	if err := validateOrigin(c.PublicOrigin, c.Environment == "production"); err != nil {
		return c, err
	}
	if err := loadPasskeys(&c, lookup); err != nil {
		return c, err
	}
	if c.TrustedProxies, err = proxies(value(lookup, "TRUSTED_PROXY_CIDRS", "")); err != nil {
		return c, err
	}
	for _, prefix := range c.TrustedProxies {
		if c.Environment == "production" && prefix.Bits() == 0 {
			return c, invalid("TRUSTED_PROXY_CIDRS")
		}
	}
	if err := loadLimits(&c, lookup); err != nil {
		return c, err
	}
	return c, nil
}

func value(lookup func(string) (string, bool), name, fallback string) string {
	if v, ok := lookup(name); ok {
		return v
	}
	return fallback
}

func invalid(name string) error { return errors.New(name + " is missing or invalid") }

func validPort(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	n, err := strconv.Atoi(s)
	return err == nil && n > 0 && n <= 65535
}

func validHost(host string) bool {
	if net.ParseIP(host) != nil {
		return true
	}
	host = strings.TrimSuffix(host, ".")
	if len(host) == 0 || len(host) > 253 {
		return false
	}
	for _, label := range strings.Split(host, ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, c := range label {
			if (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') && (c < '0' || c > '9') && c != '-' {
				return false
			}
		}
	}
	return true
}

func validateDatabase(raw string, production bool) error {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || !validHost(u.Hostname()) || u.User == nil || u.User.Username() == "" || u.Path == "" || u.Path == "/" || u.Fragment != "" {
		return invalid("DATABASE_URL")
	}
	password, ok := u.User.Password()
	if !ok || password == "" || (u.Port() != "" && !validPort(u.Port())) {
		return invalid("DATABASE_URL")
	}
	query, err := url.ParseQuery(u.RawQuery)
	if err != nil || len(query["sslmode"]) > 1 || query.Has("host") || query.Has("hostaddr") {
		return invalid("DATABASE_URL")
	}
	if production && query.Get("sslmode") != "verify-full" {
		return invalid("DATABASE_URL")
	}
	return nil
}

func secret(lookup func(string) (string, bool), name string) ([]byte, error) {
	return decodeSecret(value(lookup, name, ""), name)
}

func decodeSecret(raw, name string) ([]byte, error) {
	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil || len(decoded) < 32 {
		return nil, invalid(name)
	}
	allSame := true
	for _, b := range decoded[1:] {
		if b != decoded[0] {
			allSame = false
			break
		}
	}
	if allSame {
		return nil, invalid(name)
	}
	return decoded, nil
}

func loadOTPKeys(c *Config, lookup func(string) (string, bool)) error {
	version, err := strconv.ParseUint(value(lookup, "OTP_HMAC_KEY_VERSION", "1"), 10, 31)
	if err != nil || version == 0 {
		return invalid("OTP_HMAC_KEY_VERSION")
	}
	c.OTPKeyVersion = int(version)
	c.OTPPreviousKeys = make(map[int][]byte)
	raw := value(lookup, "OTP_PREVIOUS_HMAC_KEYS", "")
	if raw == "" {
		return nil
	}
	used := map[string]bool{string(c.OTPHMACKey): true, string(c.RateLimitHMACKey): true}
	for _, pair := range strings.Split(raw, ",") {
		parts := strings.Split(pair, ":")
		if len(parts) != 2 {
			return invalid("OTP_PREVIOUS_HMAC_KEYS")
		}
		v, err := strconv.ParseUint(parts[0], 10, 31)
		if err != nil || v == 0 || int(v) == c.OTPKeyVersion {
			return invalid("OTP_PREVIOUS_HMAC_KEYS")
		}
		key, err := decodeSecret(parts[1], "OTP_PREVIOUS_HMAC_KEYS")
		if err != nil || used[string(key)] || c.OTPPreviousKeys[int(v)] != nil {
			return invalid("OTP_PREVIOUS_HMAC_KEYS")
		}
		used[string(key)] = true
		c.OTPPreviousKeys[int(v)] = key
	}
	return nil
}

func validateOrigin(raw string, production bool) error {
	u, err := url.Parse(raw)
	if err != nil || !validHost(u.Hostname()) || u.User != nil || u.Path != "" || u.RawQuery != "" || u.ForceQuery || strings.Contains(raw, "#") || (u.Port() != "" && !validPort(u.Port())) {
		return invalid("PUBLIC_ORIGIN")
	}
	if (u.Scheme != "http" && u.Scheme != "https") || (production && u.Scheme != "https") {
		return invalid("PUBLIC_ORIGIN")
	}
	return nil
}

func proxies(raw string) ([]netip.Prefix, error) {
	if raw == "" {
		return nil, nil
	}
	var result []netip.Prefix
	for _, part := range strings.Split(raw, ",") {
		prefix, err := netip.ParsePrefix(strings.TrimSpace(part))
		if err != nil || prefix != prefix.Masked() {
			return nil, invalid("TRUSTED_PROXY_CIDRS")
		}
		result = append(result, prefix)
	}
	return result, nil
}

func loadMail(c *Config, lookup func(string) (string, bool)) error {
	c.MailTransport = value(lookup, "MAIL_TRANSPORT", "mailpit")
	if c.MailTransport != "smtp" && c.MailTransport != "mailpit" {
		return invalid("MAIL_TRANSPORT")
	}
	c.SMTPHost = value(lookup, "SMTP_HOST", "127.0.0.1")
	if !validHost(c.SMTPHost) {
		return invalid("SMTP_HOST")
	}
	port := value(lookup, "SMTP_PORT", "2525")
	if !validPort(port) {
		return invalid("SMTP_PORT")
	}
	c.SMTPPort, _ = strconv.Atoi(port)
	c.SMTPTLSMode = value(lookup, "SMTP_TLS_MODE", "none")
	if c.SMTPTLSMode != "none" && c.SMTPTLSMode != "starttls" && c.SMTPTLSMode != "implicit" {
		return invalid("SMTP_TLS_MODE")
	}
	c.SMTPUsername = value(lookup, "SMTP_USERNAME", "")
	c.SMTPPassword = value(lookup, "SMTP_PASSWORD", "")
	if (c.SMTPUsername == "") != (c.SMTPPassword == "") {
		return invalid("SMTP_USERNAME or SMTP_PASSWORD")
	}
	c.MailFrom = value(lookup, "MAIL_FROM", "")
	address, err := mail.ParseAddress(c.MailFrom)
	if err != nil || address.Address != c.MailFrom {
		return invalid("MAIL_FROM")
	}
	if c.Environment == "production" {
		host := strings.ToLower(strings.TrimSuffix(c.SMTPHost, "."))
		ip := net.ParseIP(host)
		if c.MailTransport != "smtp" || c.SMTPTLSMode == "none" || c.SMTPUsername == "" || host == "localhost" || strings.Contains(host, "mailpit") || strings.HasSuffix(host, ".localhost") || (ip != nil && (ip.IsLoopback() || ip.IsUnspecified())) {
			return invalid("production mail configuration")
		}
	}
	return nil
}

func loadLimits(c *Config, lookup func(string) (string, bool)) error {
	limits := []struct {
		name     string
		fallback string
		max      time.Duration
		target   *time.Duration
	}{
		{"SESSION_TTL", "24h", 30 * 24 * time.Hour, &c.SessionTTL},
		{"API_READ_TIMEOUT", "15s", 5 * time.Minute, &c.ReadTimeout},
		{"API_WRITE_TIMEOUT", "15s", 5 * time.Minute, &c.WriteTimeout},
		{"API_IDLE_TIMEOUT", "60s", 5 * time.Minute, &c.IdleTimeout},
		{"API_SHUTDOWN_TIMEOUT", "10s", time.Minute, &c.ShutdownTimeout},
		{"DEPENDENCY_TIMEOUT", "2s", time.Minute, &c.DependencyTimeout},
	}
	for _, limit := range limits {
		d, err := time.ParseDuration(value(lookup, limit.name, limit.fallback))
		if err != nil || d <= 0 || d > limit.max || limit.name == "SESSION_TTL" && d < time.Second {
			return invalid(limit.name)
		}
		*limit.target = d
	}
	if c.DependencyTimeout >= c.WriteTimeout {
		return invalid("DEPENDENCY_TIMEOUT")
	}
	n, err := strconv.ParseInt(value(lookup, "API_MAX_BODY_BYTES", "1048576"), 10, 64)
	if err != nil || n < 1 || n > 10485760 {
		return invalid("API_MAX_BODY_BYTES")
	}
	c.MaxBodyBytes = n
	return nil
}
