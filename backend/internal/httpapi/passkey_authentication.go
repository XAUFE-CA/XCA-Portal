package httpapi

import (
	"net/http"

	"github.com/go-webauthn/webauthn/protocol"
)

const (
	passkeyAuthenticationOptionsPath = passkeyListPath + "/authentication/options"
	passkeyAuthenticationVerifyPath  = passkeyListPath + "/authentication/verify"
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

func (h *authHandler) passkeyAuthenticationOptions(w http.ResponseWriter, r *http.Request) {
	if !decodePasskeyObject(w, r, nil, &struct{}{}) {
		return
	}
	ip, err := sourceIP(r, h.cfg.TrustedProxies)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "service_unavailable")
		return
	}
	options, err := h.passkeys.AuthenticationOptions(r.Context(), ip)
	writePasskeyJSON(w, http.StatusOK, options, err)
}

func (h *authHandler) verifyPasskeyAuthentication(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FlowID     string                                `json:"flow_id"`
		Credential *protocol.CredentialAssertionResponse `json:"credential"`
	}
	if !decodePasskeyObject(w, r, passkeyAuthenticationVerifyFields, &body) {
		return
	}
	operationID := passkeyOperationID(r)
	if operationID == "" || body.FlowID == "" || !validPasskeyAssertionFields(body.Credential) {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	ip, err := sourceIP(r, h.cfg.TrustedProxies)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "service_unavailable")
		return
	}
	token, identity, err := h.passkeys.VerifyAuthentication(r.Context(), ip, body.FlowID, operationID, body.Credential)
	if err != nil {
		writePasskeyError(w, err)
		return
	}
	http.SetCookie(w, h.cookie(token, false))
	writeIdentity(w, &identity)
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
