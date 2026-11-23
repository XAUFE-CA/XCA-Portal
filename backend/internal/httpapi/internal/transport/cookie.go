package transport

import (
	"net/http"
	"time"
)

type SessionCookie struct {
	name   string
	maxAge int
	secure bool
}

func NewSessionCookie(secure bool, ttl time.Duration) SessionCookie {
	name := "xca_session_dev"
	if secure {
		name = "__Host-xca_session"
	}
	return SessionCookie{name: name, maxAge: int(ttl.Seconds()), secure: secure}
}

func (s SessionCookie) Cookie(token string, clear bool) *http.Cookie {
	c := &http.Cookie{Name: s.name, Value: token, Path: "/", HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode}
	if clear {
		c.MaxAge = -1
		c.Expires = time.Unix(1, 0).UTC()
	} else {
		c.MaxAge = s.maxAge
	}
	return c
}

func (s SessionCookie) Token(r *http.Request) string {
	cookies := r.CookiesNamed(s.name)
	if len(cookies) != 1 {
		return ""
	}
	return cookies[0].Value
}
