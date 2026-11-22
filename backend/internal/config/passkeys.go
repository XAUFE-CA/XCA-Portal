package config

import (
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/go-webauthn/webauthn/protocol"
	"golang.org/x/net/publicsuffix"
)

type PasskeyConfig struct {
	Enabled               bool
	AuthenticationEnabled bool
	RPID                  string
	RPName                string
	RecentOTP             time.Duration
}

func loadPasskeys(c *Config, lookup func(string) (string, bool)) error {
	p := &c.Passkeys
	for _, flag := range []struct {
		name   string
		target *bool
	}{
		{"PASSKEY_MANAGEMENT_ENABLED", &p.Enabled},
		{"PASSKEY_AUTHENTICATION_ENABLED", &p.AuthenticationEnabled},
	} {
		switch value(lookup, flag.name, "false") {
		case "false":
		case "true":
			if c.Environment != "test" {
				return invalid(flag.name)
			}
			*flag.target = true
		default:
			return invalid(flag.name)
		}
	}
	const window = "PASSKEY_RECENT_OTP_WINDOW"
	var err error
	p.RecentOTP, err = time.ParseDuration(value(lookup, window, "5m"))
	if err != nil || p.RecentOTP < time.Second || p.RecentOTP > 15*time.Minute {
		return invalid(window)
	}
	p.RPID = value(lookup, "WEBAUTHN_RP_ID", "")
	p.RPName = value(lookup, "WEBAUTHN_RP_NAME", "")
	if !p.Enabled && !p.AuthenticationEnabled && p.RPID == "" && p.RPName == "" {
		return nil
	}
	if p.RPName == "" || len(p.RPName) > 128 || !utf8.ValidString(p.RPName) ||
		strings.TrimSpace(p.RPName) != p.RPName || strings.ContainsFunc(p.RPName, unicode.IsControl) {
		return invalid("WEBAUTHN_RP_NAME")
	}
	u, _ := url.Parse(c.PublicOrigin)
	host, port := u.Hostname(), u.Port()
	canonicalHost := host
	if port != "" {
		n, _ := strconv.Atoi(port)
		if !(u.Scheme == "http" && n == 80 || u.Scheme == "https" && n == 443) {
			canonicalHost += ":" + strconv.Itoa(n)
		}
	}
	if protocol.ValidateRPID(host) != nil || host != strings.ToLower(host) ||
		c.PublicOrigin != u.Scheme+"://"+canonicalHost ||
		(u.Scheme != "https" && host != "localhost") {
		return invalid("PUBLIC_ORIGIN")
	}
	if protocol.ValidateRPID(p.RPID) != nil || p.RPID != strings.ToLower(p.RPID) ||
		(host != p.RPID && !strings.HasSuffix(host, "."+p.RPID)) {
		return invalid("WEBAUTHN_RP_ID")
	}
	if p.RPID != "localhost" || host != "localhost" {
		if _, err := publicsuffix.EffectiveTLDPlusOne(p.RPID); err != nil {
			return invalid("WEBAUTHN_RP_ID")
		}
		label := host[strings.LastIndexByte(host, '.')+1:]
		if strings.Trim(label, "0123456789") == "" || strings.HasPrefix(label, "0x") && strings.Trim(label[2:], "0123456789abcdef") == "" {
			return invalid("PUBLIC_ORIGIN")
		}
	}
	return nil
}
