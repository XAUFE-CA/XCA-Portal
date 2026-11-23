package passkeyhttp

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/passkey"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/ratelimit"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/session"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/config"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/httpapi/internal/transport"
	"github.com/go-webauthn/webauthn/protocol"
)

const (
	ListPath                = "/api/v1/auth/passkeys"
	RegistrationOptionsPath = ListPath + "/registration/options"
	RegistrationVerifyPath  = ListPath + "/registration/verify"
	RevokePath              = ListPath + "/revoke"
)

type handler struct {
	passkeys *passkey.Passkeys
	origin   string
	maxBody  int64
	trusted  []netip.Prefix
	cookie   transport.SessionCookie
}

func New(passkeys *passkey.Passkeys, cfg *config.Config, cookie transport.SessionCookie) http.Handler {
	return &handler{passkeys: passkeys, origin: cfg.PublicOrigin, maxBody: cfg.MaxBodyBytes, trusted: cfg.TrustedProxies, cookie: cookie}
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	transport.SetSecurityHeaders(w)
	authentication := r.URL.Path == AuthenticationOptionsPath || r.URL.Path == AuthenticationVerifyPath
	if (authentication && !h.passkeys.AuthenticationEnabled()) || (!authentication && !h.passkeys.ManagementEnabled()) {
		transport.WriteError(w, http.StatusNotFound, "invalid_request")
		return
	}
	method := http.MethodPost
	if r.URL.Path == ListPath {
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
	origins := r.Header.Values("Origin")
	if (method == http.MethodPost || len(origins) != 0) &&
		(len(origins) != 1 || origins[0] != h.origin || h.origin == "") {
		transport.WriteError(w, http.StatusForbidden, "invalid_request")
		return
	}
	if method == http.MethodPost {
		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if len(r.Header.Values("Content-Type")) != 1 || err != nil || mediaType != "application/json" {
			transport.WriteError(w, http.StatusUnsupportedMediaType, "invalid_request")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, h.maxBody)
	}
	switch r.URL.Path {
	case RegistrationOptionsPath:
		if !decodePasskeyObject(w, r, nil, &struct{}{}) {
			return
		}
		options, err := h.passkeys.Options(r.Context(), h.cookie.Token(r))
		writePasskeyJSON(w, http.StatusOK, options, err)
	case RegistrationVerifyPath:
		h.verifyPasskey(w, r)
	case ListPath:
		credentials, err := h.passkeys.List(r.Context(), h.cookie.Token(r))
		if credentials == nil {
			credentials = []passkey.PasskeySummary{}
		}
		writePasskeyJSON(w, http.StatusOK, struct {
			Credentials []passkey.PasskeySummary `json:"credentials"`
		}{credentials}, err)
	case RevokePath:
		h.revokePasskey(w, r)
	case AuthenticationOptionsPath:
		h.passkeyAuthenticationOptions(w, r)
	case AuthenticationVerifyPath:
		h.verifyPasskeyAuthentication(w, r)
	}
}

func decodePasskeyObject(w http.ResponseWriter, r *http.Request, fields passkeyJSONFields, target any) bool {
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		transport.WriteDecodeError(w, err)
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if !utf8.Valid(raw) || !validPasskeyObject(decoder, fields) || json.Unmarshal(raw, target) != nil {
		transport.WriteError(w, http.StatusBadRequest, "invalid_request")
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

func (h *handler) verifyPasskey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FlowID     string                               `json:"flow_id"`
		Credential *protocol.CredentialCreationResponse `json:"credential"`
	}
	if !decodePasskeyObject(w, r, passkeyVerifyFields, &body) {
		return
	}
	operationID := passkeyOperationID(r)
	if operationID == "" || body.Credential == nil {
		transport.WriteError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	result, err := h.passkeys.Verify(r.Context(), h.cookie.Token(r), body.FlowID, operationID, body.Credential)
	writePasskeyJSON(w, http.StatusCreated, result, err)
}

func (h *handler) revokePasskey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CredentialID string `json:"credential_id"`
	}
	if !decodePasskeyObject(w, r, passkeyJSONFields{"credential_id": nil}, &body) {
		return
	}
	operationID := passkeyOperationID(r)
	if operationID == "" {
		transport.WriteError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	if err := h.passkeys.Revoke(r.Context(), h.cookie.Token(r), body.CredentialID, operationID); err != nil {
		writePasskeyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func passkeyOperationID(r *http.Request) string {
	values := r.Header.Values("X-XCA-Auth-Operation")
	if len(values) != 1 || !session.ValidOperationID(values[0]) {
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
	var rate *ratelimit.Error
	switch {
	case errors.Is(err, auth.ErrInvalidRequest):
		transport.WriteError(w, http.StatusBadRequest, "invalid_request")
	case errors.Is(err, passkey.ErrPasskeyUnauthenticated):
		transport.WriteError(w, http.StatusUnauthorized, "authentication_required")
	case errors.Is(err, passkey.ErrPasskeyRecentOTP):
		transport.WriteError(w, http.StatusForbidden, "recent_otp_required")
	case errors.Is(err, passkey.ErrPasskeyInvalidRegistration):
		transport.WriteError(w, http.StatusBadRequest, "invalid_or_expired_registration")
	case errors.Is(err, passkey.ErrPasskeyInvalidAuthentication):
		transport.WriteError(w, http.StatusBadRequest, "invalid_or_expired_authentication")
	case errors.Is(err, passkey.ErrPasskeyDuplicate):
		transport.WriteError(w, http.StatusConflict, "credential_exists")
	case errors.Is(err, auth.ErrOperationAbandoned):
		transport.WriteError(w, http.StatusConflict, "operation_abandoned")
	case errors.Is(err, auth.ErrPasskeyNotFound):
		transport.WriteError(w, http.StatusNotFound, "credential_not_found")
	case errors.As(err, &rate):
		w.Header().Set("Retry-After", strconv.Itoa(rate.RetryAfterSeconds))
		transport.WriteError(w, http.StatusTooManyRequests, "rate_limited")
	default:
		transport.WriteError(w, http.StatusServiceUnavailable, "service_unavailable")
	}
}
