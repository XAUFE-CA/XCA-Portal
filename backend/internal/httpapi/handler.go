package httpapi

import (
	"context"
	"io"
	"net/http"
	"time"
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
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.ContentLength > h.maxBody {
		writeError(w, http.StatusRequestEntityTooLarge, "invalid_request")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, h.maxBody)
	if r.URL.Path != "/healthz" && r.URL.Path != "/readyz" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeError(w, http.StatusMethodNotAllowed, "invalid_request")
		return
	}
	if r.URL.Path == "/healthz" {
		writeJSON(w, http.StatusOK, `{"status":"ok"}`)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()
	if h.check == nil || h.check(ctx) != nil {
		writeError(w, http.StatusServiceUnavailable, "service_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, `{"status":"ready"}`)
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, `{"error":{"code":"`+code+`"}}`)
}

func writeJSON(w http.ResponseWriter, status int, value string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, value+"\n")
}
