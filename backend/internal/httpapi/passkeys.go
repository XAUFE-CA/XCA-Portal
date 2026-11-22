package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth"
	"github.com/go-webauthn/webauthn/protocol"
)

const (
	passkeyListPath    = "/api/v1/auth/passkeys"
	passkeyOptionsPath = passkeyListPath + "/registration/options"
	passkeyVerifyPath  = passkeyListPath + "/registration/verify"
	passkeyRevokePath  = passkeyListPath + "/revoke"
)

func (h *authHandler) servePasskeys(w http.ResponseWriter, r *http.Request) {
	authentication := r.URL.Path == passkeyAuthenticationOptionsPath || r.URL.Path == passkeyAuthenticationVerifyPath
	if (authentication && !h.passkeys.AuthenticationEnabled()) || (!authentication && !h.passkeys.ManagementEnabled()) {
		writeError(w, http.StatusNotFound, "invalid_request")
		return
	}
	method := http.MethodPost
	if r.URL.Path == passkeyListPath {
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
	origins := r.Header.Values("Origin")
	if (method == http.MethodPost || len(origins) != 0) &&
		(len(origins) != 1 || origins[0] != h.cfg.PublicOrigin || h.cfg.PublicOrigin == "") {
		writeError(w, http.StatusForbidden, "invalid_request")
		return
	}
	if method == http.MethodPost {
		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if len(r.Header.Values("Content-Type")) != 1 || err != nil || mediaType != "application/json" {
			writeError(w, http.StatusUnsupportedMediaType, "invalid_request")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, h.cfg.MaxBodyBytes)
	}
	switch r.URL.Path {
	case passkeyOptionsPath:
		if !decodePasskeyObject(w, r, nil, &struct{}{}) {
			return
		}
		options, err := h.passkeys.Options(r.Context(), h.token(r))
		writePasskeyJSON(w, http.StatusOK, options, err)
	case passkeyVerifyPath:
		h.verifyPasskey(w, r)
	case passkeyListPath:
		credentials, err := h.passkeys.List(r.Context(), h.token(r))
		if credentials == nil {
			credentials = []auth.PasskeySummary{}
		}
		writePasskeyJSON(w, http.StatusOK, struct {
			Credentials []auth.PasskeySummary `json:"credentials"`
		}{credentials}, err)
	case passkeyRevokePath:
		h.revokePasskey(w, r)
	case passkeyAuthenticationOptionsPath:
		h.passkeyAuthenticationOptions(w, r)
	case passkeyAuthenticationVerifyPath:
		h.verifyPasskeyAuthentication(w, r)
	}
}

func decodePasskeyObject(w http.ResponseWriter, r *http.Request, fields passkeyJSONFields, target any) bool {
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeDecodeError(w, err)
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if !utf8.Valid(raw) || !validPasskeyObject(decoder, fields) || json.Unmarshal(raw, target) != nil {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return false
	}
	return true
}

// The field tree enforces exact names and checks extensions before WebAuthn's custom decoder sees them.
// 字段树强制精确匹配字段名称，并在 WebAuthn 自定义解码前检查扩展。
type passkeyJSONFields map[string]passkeyJSONFields

var passkeyVerifyFields = passkeyJSONFields{
	"flow_id": nil,
	"credential": {
		"id": nil, "rawId": nil, "type": nil, "authenticatorAttachment": nil,
		"clientExtensionResults": {},
		"response": {
			"clientDataJSON": nil, "attestationObject": nil, "authenticatorData": nil,
			"publicKey": nil, "publicKeyAlgorithm": nil, "transports": nil,
		},
	},
}

func validPasskeyObject(decoder *json.Decoder, fields passkeyJSONFields) bool {
	if token, err := decoder.Token(); err != nil || token != json.Delim('{') {
		return false
	}
	seen := make(map[string]struct{}, len(fields))
	for decoder.More() {
		token, err := decoder.Token()
		key, isKey := token.(string)
		child, isField := fields[key]
		_, duplicate := seen[key]
		if err != nil || !isKey || !isField || duplicate {
			return false
		}
		seen[key] = struct{}{}
		if child != nil {
			if !validPasskeyObject(decoder, child) {
				return false
			}
		} else if !validPasskeyField(decoder, key) {
			return false
		}
	}
	token, err := decoder.Token()
	return err == nil && token == json.Delim('}')
}

func validPasskeyField(decoder *json.Decoder, key string) bool {
	value, err := decoder.Token()
	if err != nil {
		return false
	}
	switch key {
	case "transports":
		if value != json.Delim('[') {
			return false
		}
		for decoder.More() {
			token, err := decoder.Token()
			if _, isString := token.(string); err != nil || !isString {
				return false
			}
		}
		token, err := decoder.Token()
		return err == nil && token == json.Delim(']')
	case "authenticatorData", "publicKey", "userHandle":
		if value == nil {
			return true
		}
		fallthrough
	case "flow_id", "id", "rawId", "clientDataJSON", "attestationObject", "signature":
		text, ok := value.(string)
		return ok && canonicalPasskeyBase64URL(text)
	default:
		_, composite := value.(json.Delim)
		return !composite
	}
}

func canonicalPasskeyBase64URL(text string) bool {
	if len(text) == 0 || len(text)%4 == 1 {
		return false
	}
	for i := range len(text) {
		c := text[i]
		if !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	// A partial base64 quantum must zero its unused bits.
	// 不完整的 Base64 编码单元必须将未使用的位清零。
	last := text[len(text)-1]
	switch len(text) % 4 {
	case 2:
		return strings.ContainsRune("AQgw", rune(last))
	case 3:
		return strings.ContainsRune("AEIMQUYcgkosw048", rune(last))
	default:
		return true
	}
}

func (h *authHandler) verifyPasskey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FlowID     string                               `json:"flow_id"`
		Credential *protocol.CredentialCreationResponse `json:"credential"`
	}
	if !decodePasskeyObject(w, r, passkeyVerifyFields, &body) {
		return
	}
	operationID := passkeyOperationID(r)
	if operationID == "" || body.Credential == nil {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	result, err := h.passkeys.Verify(r.Context(), h.token(r), body.FlowID, operationID, body.Credential)
	writePasskeyJSON(w, http.StatusCreated, result, err)
}

func (h *authHandler) revokePasskey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CredentialID string `json:"credential_id"`
	}
	if !decodePasskeyObject(w, r, passkeyJSONFields{"credential_id": nil}, &body) {
		return
	}
	operationID := passkeyOperationID(r)
	if operationID == "" {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	if err := h.passkeys.Revoke(r.Context(), h.token(r), body.CredentialID, operationID); err != nil {
		writePasskeyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func passkeyOperationID(r *http.Request) string {
	values := r.Header.Values("X-XCA-Auth-Operation")
	if len(values) != 1 || !auth.ValidOperationID(values[0]) {
		return ""
	}
	return values[0]
}

func writePasskeyJSON(w http.ResponseWriter, status int, value any, err error) {
	if err != nil {
		writePasskeyError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writePasskeyError(w http.ResponseWriter, err error) {
	var rate *auth.RateLimitError
	switch {
	case errors.Is(err, auth.ErrInvalidRequest):
		writeError(w, http.StatusBadRequest, "invalid_request")
	case errors.Is(err, auth.ErrPasskeyUnauthenticated):
		writeError(w, http.StatusUnauthorized, "authentication_required")
	case errors.Is(err, auth.ErrPasskeyRecentOTP):
		writeError(w, http.StatusForbidden, "recent_otp_required")
	case errors.Is(err, auth.ErrPasskeyInvalidRegistration):
		writeError(w, http.StatusBadRequest, "invalid_or_expired_registration")
	case errors.Is(err, auth.ErrPasskeyInvalidAuthentication):
		writeError(w, http.StatusBadRequest, "invalid_or_expired_authentication")
	case errors.Is(err, auth.ErrPasskeyDuplicate):
		writeError(w, http.StatusConflict, "credential_exists")
	case errors.Is(err, auth.ErrOperationAbandoned):
		writeError(w, http.StatusConflict, "operation_abandoned")
	case errors.Is(err, auth.ErrPasskeyNotFound):
		writeError(w, http.StatusNotFound, "credential_not_found")
	case errors.As(err, &rate):
		w.Header().Set("Retry-After", strconv.Itoa(rate.RetryAfterSeconds))
		writeError(w, http.StatusTooManyRequests, "rate_limited")
	default:
		writeError(w, http.StatusServiceUnavailable, "service_unavailable")
	}
}
