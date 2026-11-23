package transport

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
)

func TestTrustedProxyChain(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8"), netip.MustParsePrefix("2001:db8:1::/48")}
	for _, tc := range []struct {
		peer, forwarded, want string
		invalid               bool
	}{
		{"192.0.2.9:123", "203.0.113.2", "192.0.2.9", false},
		{"10.1.2.3:123", "203.0.113.5, 10.2.3.4", "203.0.113.5", false},
		{"10.1.2.3:123", "198.51.100.9, 203.0.113.5, 10.2.3.4", "203.0.113.5", false},
		{"[2001:db8:1::1]:123", "2001:db8:2::2, 2001:db8:1::2", "2001:db8:2::2", false},
		{"10.1.2.3:123", "203.0.113.2, invalid", "", true},
		{"10.1.2.3:123", "203.0.113.2,", "", true},
		{"invalid", "", "", true},
	} {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.RemoteAddr = tc.peer
		if tc.forwarded != "" {
			r.Header.Set("X-Forwarded-For", tc.forwarded)
		}
		ip, err := SourceIP(r, trusted)
		if (err != nil) != tc.invalid || !tc.invalid && ip.String() != tc.want {
			t.Errorf("peer=%s forwarded=%s: ip=%s err=%v", tc.peer, tc.forwarded, ip, err)
		}
	}
}
