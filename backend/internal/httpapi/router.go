package httpapi

import (
	"net/http"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/emailcode"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/passkey"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/session"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/config"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/httpapi/authhttp"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/httpapi/internal/transport"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/httpapi/passkeyhttp"
	"github.com/jackc/pgx/v5/pgxpool"
)

type router struct {
	auth     http.Handler
	passkeys http.Handler
	probes   http.Handler
}

func NewAuthHandler(pool *pgxpool.Pool, service *emailcode.Service, cfg config.Config) (http.Handler, error) {
	passkeys, err := passkey.NewPasskeys(pool, cfg)
	if err != nil {
		return nil, err
	}
	cookies := transport.NewSessionCookie(cfg.Environment == "production", cfg.SessionTTL)
	return &router{
		auth:     authhttp.New(service, session.NewSessions(pool, cfg.SessionTTL), passkeys.ManagementEnabled(), &cfg, cookies),
		passkeys: passkeyhttp.New(passkeys, &cfg, cookies),
		probes:   NewHandler(pool.Ping, cfg.DependencyTimeout, cfg.MaxBodyBytes),
	}, nil
}

func (h *router) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case passkeyhttp.ListPath, passkeyhttp.RegistrationOptionsPath, passkeyhttp.RegistrationVerifyPath, passkeyhttp.RevokePath,
		passkeyhttp.AuthenticationOptionsPath, passkeyhttp.AuthenticationVerifyPath:
		h.passkeys.ServeHTTP(w, r)
	case authhttp.EmailCodePath, authhttp.EmailVerifyPath, authhttp.SessionPath, authhttp.LogoutPath, authhttp.AbandonPath:
		h.auth.ServeHTTP(w, r)
	default:
		h.probes.ServeHTTP(w, r)
	}
}
