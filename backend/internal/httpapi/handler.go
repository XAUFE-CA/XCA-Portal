package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/httpapi/internal/transport"
)

type DependencyCheck func(context.Context) error

type handler struct {
	check   DependencyCheck
	timeout time.Duration
	maxBody int64
}

func NewHandler(check DependencyCheck, timeout time.Duration, maxBody int64) http.Handler {
	return &handler{check: check, timeout: timeout, maxBody: maxBody}
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	transport.SetSecurityHeaders(w)
	if r.ContentLength > h.maxBody {
		transport.WriteError(w, http.StatusRequestEntityTooLarge, "invalid_request")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, h.maxBody)
	if r.URL.Path != "/healthz" && r.URL.Path != "/readyz" {
		transport.WriteError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		transport.WriteError(w, http.StatusMethodNotAllowed, "invalid_request")
		return
	}
	if r.URL.Path == "/healthz" {
		transport.WriteJSON(w, http.StatusOK, `{"status":"ok"}`)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()
	if h.check == nil || h.check(ctx) != nil {
		transport.WriteError(w, http.StatusServiceUnavailable, "service_unavailable")
		return
	}
	transport.WriteJSON(w, http.StatusOK, `{"status":"ready"}`)
}
