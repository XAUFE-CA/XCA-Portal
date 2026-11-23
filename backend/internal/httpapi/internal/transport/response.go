package transport

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth"
)

func SetSecurityHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
}

func WriteError(w http.ResponseWriter, status int, code string) {
	WriteJSON(w, status, `{"error":{"code":"`+code+`"}}`)
}

func WriteJSON(w http.ResponseWriter, status int, value string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, value+"\n")
}

func WriteDecodeError(w http.ResponseWriter, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		WriteError(w, http.StatusRequestEntityTooLarge, "invalid_request")
		return
	}
	WriteError(w, http.StatusBadRequest, "invalid_request")
}

type publicIdentity struct {
	User  string `json:"user"`
	Label string `json:"label"`
}

func WriteIdentity(w http.ResponseWriter, id *auth.Identity) {
	var identity *publicIdentity
	if id != nil {
		identity = &publicIdentity{User: id.LoginName, Label: id.DisplayName}
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(struct {
		Identity *publicIdentity `json:"identity"`
	}{identity})
}
