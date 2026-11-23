package passkeyhttp

import (
	"net/http"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/httpapi/internal/transport"
	"github.com/go-webauthn/webauthn/protocol"
)

const (
	AuthenticationOptionsPath = ListPath + "/authentication/options"
	AuthenticationVerifyPath  = ListPath + "/authentication/verify"
)

var passkeyAuthenticationVerifyFields = passkeyJSONFields{
	"flow_id": nil,
	"credential": {
		"id": nil, "rawId": nil, "type": nil, "authenticatorAttachment": nil,
		"clientExtensionResults": {},
		"response": {
			"authenticatorData": nil, "clientDataJSON": nil, "signature": nil, "userHandle": nil,
		},
	},
}

func (h *handler) passkeyAuthenticationOptions(w http.ResponseWriter, r *http.Request) {
	if !decodePasskeyObject(w, r, nil, &struct{}{}) {
		return
	}
	ip, err := transport.SourceIP(r, h.trusted)
	if err != nil {
		transport.WriteError(w, http.StatusServiceUnavailable, "service_unavailable")
		return
	}
	options, err := h.passkeys.AuthenticationOptions(r.Context(), ip)
	writePasskeyJSON(w, http.StatusOK, options, err)
}

func (h *handler) verifyPasskeyAuthentication(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FlowID     string                                `json:"flow_id"`
		Credential *protocol.CredentialAssertionResponse `json:"credential"`
	}
	if !decodePasskeyObject(w, r, passkeyAuthenticationVerifyFields, &body) {
		return
	}
	operationID := passkeyOperationID(r)
	if operationID == "" || body.FlowID == "" || !validPasskeyAssertionFields(body.Credential) {
		transport.WriteError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	ip, err := transport.SourceIP(r, h.trusted)
	if err != nil {
		transport.WriteError(w, http.StatusServiceUnavailable, "service_unavailable")
		return
	}
	token, identity, err := h.passkeys.VerifyAuthentication(r.Context(), ip, body.FlowID, operationID, body.Credential)
	if err != nil {
		writePasskeyError(w, err)
		return
	}
	http.SetCookie(w, h.cookie.Cookie(token, false))
	transport.WriteIdentity(w, &identity)
}

func validPasskeyAssertionFields(credential *protocol.CredentialAssertionResponse) bool {
	if credential == nil || credential.ID == "" || len(credential.RawID) == 0 || credential.Type == "" {
		return false
	}
	attachment := protocol.AuthenticatorAttachment(credential.AuthenticatorAttachment)
	if attachment != "" && attachment != protocol.Platform && attachment != protocol.CrossPlatform {
		return false
	}
	response := &credential.AssertionResponse
	return len(response.AuthenticatorData) != 0 && len(response.ClientDataJSON) != 0 && len(response.Signature) != 0
}
