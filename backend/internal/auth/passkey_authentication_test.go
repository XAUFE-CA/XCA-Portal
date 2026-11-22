package auth

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"testing"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/config"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/testpasskey"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

const assertionRP = "localhost"
const assertionOrigin = "http://localhost:4102"

func newAssertionTestService(t *testing.T) *Passkeys {
	t.Helper()
	p, err := NewPasskeys(nil, config.Config{Environment: "test", PublicOrigin: assertionOrigin,
		SessionTTL: 24 * time.Hour, RateLimitHMACKey: []byte("phase-c-test-rate-key-not-a-secret"),
		Passkeys: config.PasskeyConfig{AuthenticationEnabled: true, RPID: assertionRP, RPName: "XCA Test"}})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestDiscoverablePasskeyAssertionSignatures(t *testing.T) {
	p := newAssertionTestService(t)
	options, session, err := p.webauthn.BeginDiscoverableLogin(webauthn.WithLoginOrigin(assertionOrigin))
	if err != nil {
		t.Fatal(err)
	}
	if p.ManagementEnabled() || !p.AuthenticationEnabled() || options.Response.UserVerification != protocol.VerificationRequired ||
		options.Response.Timeout != 120000 || options.Response.RelyingPartyID != assertionRP ||
		len(options.Response.AllowedCredentials) != 0 || len(session.UserID) != 0 {
		t.Fatalf("unexpected discoverable options: %+v", options.Response)
	}
	challenge := options.Response.Challenge.String()
	id, handle := []byte("signed-credential"), bytes.Repeat([]byte{0x32}, 32)
	authenticator := testpasskey.NewAuthenticator(t)
	registration, err := authenticator.Registration(t, challenge, assertionRP, assertionOrigin, id, testpasskey.Options{}).Parse()
	if err != nil {
		t.Fatal(err)
	}
	user := &passkeyLoginUser{passkeyUser: passkeyUser{handle: handle}, credentials: [1]webauthn.Credential{{
		ID: id, PublicKey: registration.Response.AttestationObject.AuthData.AttData.CredentialPublicKey,
		Flags: webauthn.NewCredentialFlags(protocol.FlagUserVerified),
	}}}
	resolve := func(rawID, userHandle []byte) (webauthn.User, error) {
		if !bytes.Equal(rawID, id) || !bytes.Equal(userHandle, handle) {
			return nil, ErrPasskeyInvalidAuthentication
		}
		return user, nil
	}
	fresh := func(opts testpasskey.AssertionOptions) *protocol.CredentialAssertionResponse {
		return authenticator.Assertion(t, challenge, assertionRP, assertionOrigin, id, handle, opts)
	}
	if actual, credential, err := p.verifyAssertion(*session, fresh(testpasskey.AssertionOptions{}), resolve); err != nil ||
		actual != user || credential.Authenticator.SignCount != 0 || !bytes.Equal(credential.ID, id) {
		t.Fatalf("valid counterless assertion was not accepted: %v", err)
	}
	for _, tc := range []struct {
		name     string
		response *protocol.CredentialAssertionResponse
		mutate   func(*protocol.CredentialAssertionResponse)
	}{
		{"bad signature", fresh(testpasskey.AssertionOptions{}), func(r *protocol.CredentialAssertionResponse) {
			r.AssertionResponse.Signature[len(r.AssertionResponse.Signature)-1] ^= 1
		}},
		{"modified authenticator data", fresh(testpasskey.AssertionOptions{}), func(r *protocol.CredentialAssertionResponse) {
			r.AssertionResponse.AuthenticatorData[36] ^= 1
		}},
		{"modified client data", fresh(testpasskey.AssertionOptions{}), func(r *protocol.CredentialAssertionResponse) {
			r.AssertionResponse.ClientDataJSON = append(r.AssertionResponse.ClientDataJSON, ' ')
		}},
		{"wrong challenge", authenticator.Assertion(t, base64.RawURLEncoding.EncodeToString(make([]byte, 32)), assertionRP, assertionOrigin, id, handle, testpasskey.AssertionOptions{}), nil},
		{"wrong RP", authenticator.Assertion(t, challenge, "other.example.org", assertionOrigin, id, handle, testpasskey.AssertionOptions{}), nil},
		{"wrong origin", authenticator.Assertion(t, challenge, assertionRP, "http://localhost:4101", id, handle, testpasskey.AssertionOptions{}), nil},
		{"missing UV", fresh(testpasskey.AssertionOptions{OmitFlags: protocol.FlagUserVerified}), nil},
		{"missing UP", fresh(testpasskey.AssertionOptions{OmitFlags: protocol.FlagUserPresent}), nil},
		{"invalid ceremony", fresh(testpasskey.AssertionOptions{Ceremony: protocol.CreateCeremony}), nil},
		{"cross-origin iframe", fresh(testpasskey.AssertionOptions{CrossOrigin: true, TopOrigin: "https://other.example.org"}), nil},
		{"unexpected backup eligibility", fresh(testpasskey.AssertionOptions{AddFlags: protocol.FlagBackupEligible}), nil},
		{"backup state without eligibility", fresh(testpasskey.AssertionOptions{AddFlags: protocol.FlagBackupState}), nil},
		{"wrong user handle", authenticator.Assertion(t, challenge, assertionRP, assertionOrigin, id, bytes.Repeat([]byte{0x55}, 32), testpasskey.AssertionOptions{}), nil},
		{"empty user handle", authenticator.Assertion(t, challenge, assertionRP, assertionOrigin, id, nil, testpasskey.AssertionOptions{}), nil},
		{"credential ID substitution", authenticator.Assertion(t, challenge, assertionRP, assertionOrigin, []byte("other-credential"), handle, testpasskey.AssertionOptions{}), nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.mutate != nil {
				tc.mutate(tc.response)
			}
			if _, _, err := p.verifyAssertion(*session, tc.response, resolve); !errors.Is(err, ErrPasskeyInvalidAuthentication) {
				t.Fatalf("invalid signed response error = %v", err)
			}
		})
	}
	if _, _, err := p.verifyAssertion(*session, fresh(testpasskey.AssertionOptions{}), func(_, _ []byte) (webauthn.User, error) {
		return nil, ErrUnavailable
	}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("credential store failure became authentication failure: %v", err)
	}

	user.credentials[0].Flags = webauthn.NewCredentialFlags(protocol.FlagUserVerified | protocol.FlagBackupEligible)
	for _, tc := range []struct {
		name        string
		old, next   uint32
		backupState bool
		want        error
	}{
		{"counterless sync", 0, 0, true, nil}, {"initialized", 0, 3, true, nil}, {"advanced", 3, 4, false, nil},
		{"repeated", 3, 3, false, ErrPasskeyInvalidAuthentication},
		{"regressed", 3, 2, true, ErrPasskeyInvalidAuthentication},
		{"reset", 3, 0, true, ErrPasskeyInvalidAuthentication},
	} {
		t.Run(tc.name, func(t *testing.T) {
			user.credentials[0].Authenticator.SignCount = tc.old
			flags := protocol.FlagBackupEligible
			if tc.backupState {
				flags |= protocol.FlagBackupState
			}
			_, credential, err := p.verifyAssertion(*session, fresh(testpasskey.AssertionOptions{SignCount: tc.next, AddFlags: flags}), resolve)
			if !errors.Is(err, tc.want) {
				t.Fatalf("counter %d -> %d: %v", tc.old, tc.next, err)
			}
			if err == nil && (credential.Authenticator.SignCount != tc.next || !credential.Flags.BackupEligible || credential.Flags.BackupState != tc.backupState) {
				t.Fatalf("unexpected verified state: %+v", credential)
			}
		})
	}
}

func TestSessionTokenMatchesStoredDigest(t *testing.T) {
	token, digest, err := newSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	secret, err := base64.RawURLEncoding.Strict().DecodeString(token)
	if err != nil || len(secret) != 32 || digest != sha256.Sum256([]byte(token)) {
		t.Fatal("session token does not use a 32-byte secret and the digest of the encoded value")
	}
	lookup, ok := sessionDigest(token)
	if !ok || !bytes.Equal(lookup, digest[:]) {
		t.Fatal("the existing Session lookup cannot resolve the generated token")
	}
}
