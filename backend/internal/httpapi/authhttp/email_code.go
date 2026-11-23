package authhttp

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/netip"
	"strconv"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/emailcode"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/ratelimit"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/httpapi/internal/transport"
)

type emailCodeHandler struct {
	service *emailcode.Service
	origin  string
	maxBody int64
	trusted []netip.Prefix
}

func (h *emailCodeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	transport.SetSecurityHeaders(w)
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		transport.WriteError(w, http.StatusMethodNotAllowed, "invalid_request")
		return
	}
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
	if h.maxBody < 1 || r.ContentLength > h.maxBody {
		transport.WriteError(w, http.StatusRequestEntityTooLarge, "invalid_request")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, h.maxBody)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var body struct {
		Email      string          `json:"email"`
		Invitation json.RawMessage `json:"invitation"`
	}
	if err := decoder.Decode(&body); err != nil {
		transport.WriteDecodeError(w, err)
		return
	}
	var extra json.RawMessage
	if err := decoder.Decode(&extra); err != io.EOF {
		transport.WriteDecodeError(w, err)
		return
	}
	var token string
	if body.Invitation != nil {
		if string(body.Invitation) == "null" || json.Unmarshal(body.Invitation, &token) != nil || len(token) < 1 || len(token) > 512 {
			transport.WriteError(w, http.StatusBadRequest, "invalid_request")
			return
		}
	}
	ip, err := transport.SourceIP(r, h.trusted)
	if err != nil || h.service == nil {
		transport.WriteError(w, http.StatusServiceUnavailable, "service_unavailable")
		return
	}
	challenge, err := h.service.Request(r.Context(), body.Email, token, ip)
	if err != nil {
		var rate *ratelimit.Error
		switch {
		case errors.Is(err, auth.ErrInvalidRequest):
			transport.WriteError(w, http.StatusBadRequest, "invalid_request")
		case errors.As(err, &rate):
			w.Header().Set("Retry-After", strconv.Itoa(rate.RetryAfterSeconds))
			transport.WriteError(w, http.StatusTooManyRequests, "rate_limited")
		default:
			transport.WriteError(w, http.StatusServiceUnavailable, "service_unavailable")
		}
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(struct {
		FlowID    string    `json:"flow_id"`
		ExpiresAt time.Time `json:"expires_at"`
	}{challenge.FlowID, challenge.ExpiresAt})
}
