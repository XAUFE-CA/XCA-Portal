package authhttp

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/emailcode"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/session"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/config"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/httpapi/internal/transport"
)

const (
	EmailCodePath   = "/api/v1/auth/email/code"
	EmailVerifyPath = "/api/v1/auth/email/verify"
	SessionPath     = "/api/v1/auth/session"
	LogoutPath      = "/api/v1/auth/logout"
	AbandonPath     = "/api/v1/auth/operations/abandon"
)

type handler struct {
	service                  *emailcode.Service
	sessions                 *session.Sessions
	allowPasskeyCompensation bool
	origin                   string
	maxBody                  int64
	cookie                   transport.SessionCookie
	code                     emailCodeHandler
}

func New(service *emailcode.Service, sessions *session.Sessions, allowPasskeyCompensation bool, cfg *config.Config, cookie transport.SessionCookie) http.Handler {
	return &handler{
		service:                  service,
		sessions:                 sessions,
		allowPasskeyCompensation: allowPasskeyCompensation,
		origin:                   cfg.PublicOrigin,
		maxBody:                  cfg.MaxBodyBytes,
		cookie:                   cookie,
		code:                     emailCodeHandler{service: service, origin: cfg.PublicOrigin, maxBody: cfg.MaxBodyBytes, trusted: cfg.TrustedProxies},
	}
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == EmailCodePath {
		h.code.ServeHTTP(w, r)
		return
	}
	transport.SetSecurityHeaders(w)
	method := http.MethodPost
	if r.URL.Path == SessionPath {
		method = http.MethodGet
	}
	if r.Method != method {
		w.Header().Set("Allow", method)
		transport.WriteError(w, http.StatusMethodNotAllowed, "invalid_request")
		return
	}
	if r.ContentLength > h.maxBody || h.maxBody < 1 {
		transport.WriteError(w, http.StatusRequestEntityTooLarge, "invalid_request")
		return
	}
	if method == http.MethodPost {
		origins := r.Header.Values("Origin")
		if len(origins) != 1 || origins[0] != h.origin || h.origin == "" {
			transport.WriteError(w, http.StatusForbidden, "invalid_request")
			return
		}
		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || mediaType != "application/json" {
			transport.WriteError(w, http.StatusUnsupportedMediaType, "invalid_request")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, h.maxBody)
	}
	switch r.URL.Path {
	case EmailVerifyPath:
		h.verify(w, r)
	case SessionPath:
		h.session(w, r)
	case LogoutPath:
		h.logout(w, r)
	case AbandonPath:
		h.abandon(w, r)
	}
}

func decodeObject(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var raw json.RawMessage
	if err := decoder.Decode(&raw); err != nil {
		transport.WriteDecodeError(w, err)
		return false
	}
	var extra json.RawMessage
	if err := decoder.Decode(&extra); err != io.EOF {
		transport.WriteDecodeError(w, err)
		return false
	}
	if len(raw) == 0 || raw[0] != '{' {
		transport.WriteError(w, http.StatusBadRequest, "invalid_request")
		return false
	}
	strict := json.NewDecoder(bytes.NewReader(raw))
	strict.DisallowUnknownFields()
	if err := strict.Decode(target); err != nil {
		transport.WriteDecodeError(w, err)
		return false
	}
	return true
}

func (h *handler) verify(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FlowID string `json:"flow_id"`
		Code   string `json:"code"`
	}
	if !decodeObject(w, r, &body) {
		return
	}
	operationID := r.Header.Get("X-XCA-Auth-Operation")
	if len(r.Header.Values("X-XCA-Auth-Operation")) != 1 || !session.ValidOperationID(operationID) {
		transport.WriteError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	token, identity, err := h.sessions.VerifyWithOperation(r.Context(), h.service, body.FlowID, body.Code, operationID)
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrInvalidRequest), errors.Is(err, auth.ErrOperationAbandoned):
			transport.WriteError(w, http.StatusBadRequest, "invalid_request")
		case errors.Is(err, emailcode.ErrInvalidCode):
			transport.WriteError(w, http.StatusBadRequest, "invalid_or_expired_code")
		default:
			transport.WriteError(w, http.StatusServiceUnavailable, "service_unavailable")
		}
		return
	}
	http.SetCookie(w, h.cookie.Cookie(token, false))
	transport.WriteIdentity(w, &identity)
}

func (h *handler) session(w http.ResponseWriter, r *http.Request) {
	identity, err := h.sessions.Get(r.Context(), h.cookie.Token(r))
	if err != nil {
		transport.WriteError(w, http.StatusServiceUnavailable, "service_unavailable")
		return
	}
	transport.WriteIdentity(w, identity)
}

func (h *handler) logout(w http.ResponseWriter, r *http.Request) {
	var body struct{}
	if !decodeObject(w, r, &body) {
		return
	}
	operationID := r.Header.Get("X-XCA-Auth-Operation")
	if len(r.Header.Values("X-XCA-Auth-Operation")) != 1 || !session.ValidOperationID(operationID) {
		transport.WriteError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	if err := h.sessions.RevokeWithOperation(r.Context(), h.cookie.Token(r), operationID); err != nil {
		if errors.Is(err, auth.ErrOperationAbandoned) {
			transport.WriteError(w, http.StatusBadRequest, "invalid_request")
		} else {
			transport.WriteError(w, http.StatusServiceUnavailable, "service_unavailable")
		}
		return
	}
	http.SetCookie(w, h.cookie.Cookie("", true))
	w.WriteHeader(http.StatusNoContent)
}

func (h *handler) abandon(w http.ResponseWriter, r *http.Request) {
	var body struct {
		OperationID string `json:"operation_id"`
	}
	if !decodeObject(w, r, &body) {
		return
	}
	outcome, err := h.sessions.Abandon(r.Context(), body.OperationID, h.cookie.Token(r), h.allowPasskeyCompensation)
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrInvalidRequest):
			transport.WriteError(w, http.StatusBadRequest, "invalid_request")
		case errors.Is(err, auth.ErrPasskeyNotFound):
			transport.WriteError(w, http.StatusNotFound, "credential_not_found")
		default:
			transport.WriteError(w, http.StatusServiceUnavailable, "service_unavailable")
		}
		return
	}
	if outcome != "" {
		w.Header().Set("X-XCA-Passkey-Operation-Outcome", outcome)
	}
	w.WriteHeader(http.StatusNoContent)
}
