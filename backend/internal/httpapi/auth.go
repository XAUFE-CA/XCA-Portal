package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

type authHandler struct {
	service  *auth.Service
	sessions *auth.Sessions
	cfg      config.Config
	probes   http.Handler
	code     http.Handler
}

func NewAuthHandler(pool *pgxpool.Pool, service *auth.Service, cfg config.Config) http.Handler {
	code := &emailCodeHandler{service: service, origin: cfg.PublicOrigin, maxBody: cfg.MaxBodyBytes, trusted: cfg.TrustedProxies}
	return &authHandler{service: service, sessions: auth.NewSessions(pool, cfg.SessionTTL), cfg: cfg,
		probes: NewHandler(pool.Ping, cfg.DependencyTimeout, cfg.MaxBodyBytes), code: code}
}

func (h *authHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.URL.Path == "/api/v1/auth/email/code" {
		h.code.ServeHTTP(w, r)
		return
	}
	if r.URL.Path != "/api/v1/auth/email/verify" && r.URL.Path != "/api/v1/auth/session" &&
		r.URL.Path != "/api/v1/auth/logout" && r.URL.Path != "/api/v1/auth/operations/abandon" {
		h.probes.ServeHTTP(w, r)
		return
	}
	method := http.MethodPost
	if r.URL.Path == "/api/v1/auth/session" {
		method = http.MethodGet
	}
	if r.Method != method {
		w.Header().Set("Allow", method)
		writeError(w, http.StatusMethodNotAllowed, "invalid_request")
		return
	}
	if r.ContentLength > h.cfg.MaxBodyBytes || h.cfg.MaxBodyBytes < 1 {
		writeError(w, http.StatusRequestEntityTooLarge, "invalid_request")
		return
	}
	if method == http.MethodPost {
		origins := r.Header.Values("Origin")
		if len(origins) != 1 || origins[0] != h.cfg.PublicOrigin || h.cfg.PublicOrigin == "" {
			writeError(w, http.StatusForbidden, "invalid_request")
			return
		}
		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || mediaType != "application/json" {
			writeError(w, http.StatusUnsupportedMediaType, "invalid_request")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, h.cfg.MaxBodyBytes)
	}
	switch r.URL.Path {
	case "/api/v1/auth/email/verify":
		h.verify(w, r)
	case "/api/v1/auth/session":
		h.session(w, r)
	case "/api/v1/auth/logout":
		h.logout(w, r)
	case "/api/v1/auth/operations/abandon":
		h.abandon(w, r)
	}
}

func decodeObject(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var raw json.RawMessage
	if err := decoder.Decode(&raw); err != nil {
		writeDecodeError(w, err)
		return false
	}
	var extra json.RawMessage
	if err := decoder.Decode(&extra); err != io.EOF {
		writeDecodeError(w, err)
		return false
	}
	if len(raw) == 0 || raw[0] != '{' {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return false
	}
	strict := json.NewDecoder(bytes.NewReader(raw))
	strict.DisallowUnknownFields()
	if err := strict.Decode(target); err != nil {
		writeDecodeError(w, err)
		return false
	}
	return true
}

func (h *authHandler) cookieName() string {
	if h.cfg.Environment == "production" {
		return "__Host-xca_session"
	}
	return "xca_session_dev"
}

func (h *authHandler) cookie(token string, clear bool) *http.Cookie {
	c := &http.Cookie{Name: h.cookieName(), Value: token, Path: "/", HttpOnly: true, Secure: h.cfg.Environment == "production", SameSite: http.SameSiteLaxMode}
	if clear {
		c.MaxAge = -1
		c.Expires = time.Unix(1, 0).UTC()
	} else {
		c.MaxAge = int(h.cfg.SessionTTL.Seconds())
	}
	return c
}

func (h *authHandler) token(r *http.Request) string {
	cookies := r.CookiesNamed(h.cookieName())
	if len(cookies) != 1 {
		return ""
	}
	return cookies[0].Value
}

type publicIdentity struct {
	User  string `json:"user"`
	Label string `json:"label"`
}

func writeIdentity(w http.ResponseWriter, id *auth.Identity) {
	var identity *publicIdentity
	if id != nil {
		identity = &publicIdentity{User: id.LoginName, Label: id.DisplayName}
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(struct {
		Identity *publicIdentity `json:"identity"`
	}{identity})
}

func (h *authHandler) verify(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FlowID string `json:"flow_id"`
		Code   string `json:"code"`
	}
	if !decodeObject(w, r, &body) {
		return
	}
	operationID := r.Header.Get("X-XCA-Auth-Operation")
	if len(r.Header.Values("X-XCA-Auth-Operation")) != 1 || !auth.ValidOperationID(operationID) {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	token, identity, err := h.sessions.VerifyWithOperation(r.Context(), h.service, body.FlowID, body.Code, operationID)
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrInvalidRequest), errors.Is(err, auth.ErrOperationAbandoned):
			writeError(w, http.StatusBadRequest, "invalid_request")
		case errors.Is(err, auth.ErrInvalidCode):
			writeError(w, http.StatusBadRequest, "invalid_or_expired_code")
		default:
			writeError(w, http.StatusServiceUnavailable, "service_unavailable")
		}
		return
	}
	http.SetCookie(w, h.cookie(token, false))
	writeIdentity(w, &identity)
}

func (h *authHandler) session(w http.ResponseWriter, r *http.Request) {
	identity, err := h.sessions.Get(r.Context(), h.token(r))
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "service_unavailable")
		return
	}
	writeIdentity(w, identity)
}

func (h *authHandler) logout(w http.ResponseWriter, r *http.Request) {
	var body struct{}
	if !decodeObject(w, r, &body) {
		return
	}
	operationID := r.Header.Get("X-XCA-Auth-Operation")
	if len(r.Header.Values("X-XCA-Auth-Operation")) != 1 || !auth.ValidOperationID(operationID) {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	if err := h.sessions.RevokeWithOperation(r.Context(), h.token(r), operationID); err != nil {
		if errors.Is(err, auth.ErrOperationAbandoned) {
			writeError(w, http.StatusBadRequest, "invalid_request")
		} else {
			writeError(w, http.StatusServiceUnavailable, "service_unavailable")
		}
		return
	}
	http.SetCookie(w, h.cookie("", true))
	w.WriteHeader(http.StatusNoContent)
}

func (h *authHandler) abandon(w http.ResponseWriter, r *http.Request) {
	var body struct {
		OperationID string `json:"operation_id"`
	}
	if !decodeObject(w, r, &body) {
		return
	}
	if err := h.sessions.Abandon(r.Context(), body.OperationID); err != nil {
		if errors.Is(err, auth.ErrInvalidRequest) {
			writeError(w, http.StatusBadRequest, "invalid_request")
		} else {
			writeError(w, http.StatusServiceUnavailable, "service_unavailable")
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
