package httpapi

import (
	"errors"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

func sourceIP(r *http.Request, trusted []netip.Prefix) (netip.Addr, error) {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return netip.Addr{}, errors.New("invalid peer")
	}
	peer, err := netip.ParseAddr(host)
	if err != nil || peer.Zone() != "" {
		return netip.Addr{}, errors.New("invalid peer")
	}
	peer = peer.Unmap()
	isTrusted := func(ip netip.Addr) bool {
		for _, prefix := range trusted {
			if prefix.Contains(ip) {
				return true
			}
		}
		return false
	}
	if !isTrusted(peer) {
		return peer, nil
	}
	values := r.Header.Values("X-Forwarded-For")
	if len(values) == 0 {
		return peer, nil
	}
	parts := strings.Split(strings.Join(values, ","), ",")
	chain := make([]netip.Addr, len(parts))
	for i, part := range parts {
		ip, err := netip.ParseAddr(strings.TrimSpace(part))
		if err != nil || ip.Zone() != "" {
			return netip.Addr{}, errors.New("invalid forwarded address")
		}
		chain[i] = ip.Unmap()
	}
	for i := len(chain) - 1; i >= 0 && isTrusted(peer); i-- {
		peer = chain[i]
	}
	return peer, nil
}
