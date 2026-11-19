package httpapi

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
)

type emailCodeHandler struct {
	service *auth.Service
	origin  string
	maxBody int64
	trusted []netip.Prefix
}

// NewEmailCodeHandler builds an adapter without registering it on the public server.
// NewEmailCodeHandler 创建协议适配器，但不将其注册到公开服务。
func NewEmailCodeHandler(service *auth.Service, origin string, maxBody int64) http.Handler {
	return &emailCodeHandler{service: service, origin: origin, maxBody: maxBody}
}

func (h *emailCodeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeError(w, http.StatusMethodNotAllowed, "invalid_request")
		return
	}
	origins := r.Header.Values("Origin")
	if len(origins) != 1 || origins[0] != h.origin || h.origin == "" {
		writeError(w, http.StatusForbidden, "invalid_request")
		return
	}
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "invalid_request")
		return
	}
	if h.maxBody < 1 || r.ContentLength > h.maxBody {
		writeError(w, http.StatusRequestEntityTooLarge, "invalid_request")
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
		writeDecodeError(w, err)
		return
	}
	var extra json.RawMessage
	if err := decoder.Decode(&extra); err != io.EOF {
		writeDecodeError(w, err)
		return
	}
	var token string
	if body.Invitation != nil {
		if string(body.Invitation) == "null" || json.Unmarshal(body.Invitation, &token) != nil || len(token) < 1 || len(token) > 512 {
			writeError(w, http.StatusBadRequest, "invalid_request")
			return
		}
	}
	ip, err := sourceIP(r, h.trusted)
	if err != nil || h.service == nil {
		writeError(w, http.StatusServiceUnavailable, "service_unavailable")
		return
	}
	challenge, err := h.service.Request(r.Context(), body.Email, token, ip)
	if err != nil {
		var rate *auth.RateLimitError
		switch {
		case errors.Is(err, auth.ErrInvalidRequest):
			writeError(w, http.StatusBadRequest, "invalid_request")
		case errors.As(err, &rate):
			w.Header().Set("Retry-After", strconv.Itoa(rate.RetryAfterSeconds))
			writeError(w, http.StatusTooManyRequests, "rate_limited")
		default:
			writeError(w, http.StatusServiceUnavailable, "service_unavailable")
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

func writeDecodeError(w http.ResponseWriter, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeError(w, http.StatusRequestEntityTooLarge, "invalid_request")
		return
	}
	writeError(w, http.StatusBadRequest, "invalid_request")
}
