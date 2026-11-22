package auth

import (
	"bytes"
	"errors"
	"testing"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/config"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/testpasskey"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/protocol/webauthncbor"
	"github.com/go-webauthn/webauthn/webauthn"
)

func TestPasskeyRegistrationProtocol(t *testing.T) {
	const rp = "localhost"
	const origin = "http://localhost:4102"
	p, err := NewPasskeys(nil, config.Config{Environment: "test", PublicOrigin: origin,
		Passkeys: config.PasskeyConfig{Enabled: true, RPID: rp, RPName: "XCA Test", RecentOTP: 5 * time.Minute}})
	if err != nil {
		t.Fatal(err)
	}
	user := passkeyUser{name: "portal-member", displayName: "Portal Member", handle: bytes.Repeat([]byte{0x42}, 32)}
	creation, session, err := p.webauthn.BeginRegistration(user, webauthn.WithRegistrationOrigin(origin))
	if err != nil {
		t.Fatal(err)
	}
	options := creation.Response
	if options.RelyingParty.ID != rp || options.User.Name != "portal-member" || options.User.DisplayName != "Portal Member" ||
		options.AuthenticatorSelection.ResidentKey != protocol.ResidentKeyRequirementRequired ||
		options.AuthenticatorSelection.UserVerification != protocol.VerificationRequired ||
		options.AuthenticatorSelection.AuthenticatorAttachment != "" || options.Attestation != protocol.PreferNoAttestation ||
		options.Timeout != 120000 {
		t.Fatalf("unexpected registration policy: %+v", options)
	}
	if handle, ok := options.User.ID.(protocol.URLEncodedBase64); !ok || !bytes.Equal(handle, user.handle) {
		t.Fatal("browser registration user ID was not the stable account handle")
	}
	challenge, id := options.Challenge.String(), []byte("test-credential")
	valid := testpasskey.ResponseWith(t, challenge, rp, origin, id, testpasskey.Options{
		AddFlags: protocol.FlagBackupEligible | protocol.FlagBackupState,
	})
	credential, err := p.verifyRegistration(user, *session, valid)
	if err != nil || !bytes.Equal(credential.ID, id) || !credential.Flags.UserVerified || !credential.Flags.UserPresent ||
		!credential.Flags.BackupEligible || !credential.Flags.BackupState || len(credential.PublicKey) == 0 {
		t.Fatalf("valid authenticator data was rejected or lost: %v", err)
	}

	malformedKey, err := webauthncbor.Marshal(map[int]any{1: 2, 3: -7, -1: 1, -2: make([]byte, 32), -3: make([]byte, 32)})
	if err != nil {
		t.Fatal(err)
	}
	other, err := protocol.CreateChallenge()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, challenge, rp, origin string
		vector                      testpasskey.Options
		mutate                      func(*protocol.CredentialCreationResponse)
	}{
		{"wrong challenge", other.String(), rp, origin, testpasskey.Options{}, nil},
		{"wrong RP hash", challenge, "example.com", origin, testpasskey.Options{}, nil},
		{"wrong origin", challenge, rp, "http://localhost:4101", testpasskey.Options{}, nil},
		{"cross-origin iframe", challenge, rp, origin, testpasskey.Options{CrossOrigin: true, TopOrigin: "https://other.example.com"}, nil},
		{"wrong ceremony", challenge, rp, origin, testpasskey.Options{Ceremony: protocol.AssertCeremony}, nil},
		{"missing user verification", challenge, rp, origin, testpasskey.Options{OmitFlags: protocol.FlagUserVerified}, nil},
		{"missing user presence", challenge, rp, origin, testpasskey.Options{OmitFlags: protocol.FlagUserPresent}, nil},
		{"backup without eligibility", challenge, rp, origin, testpasskey.Options{AddFlags: protocol.FlagBackupState}, nil},
		{"malformed attestation", challenge, rp, origin, testpasskey.Options{}, func(r *protocol.CredentialCreationResponse) {
			r.AttestationResponse.AttestationObject = []byte{0xff}
		}},
		{"replaced ID", challenge, rp, origin, testpasskey.Options{AttestedID: []byte("another-credential")}, nil},
		{"invalid EC point", challenge, rp, origin, testpasskey.Options{COSEKey: malformedKey}, nil},
		{"unsolicited extension", challenge, rp, origin, testpasskey.Options{}, func(r *protocol.CredentialCreationResponse) {
			r.ClientExtensionResults.Extra = map[string]any{"test-extension": true}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := testpasskey.ResponseWith(t, tc.challenge, tc.rp, tc.origin, id, tc.vector)
			if tc.mutate != nil {
				tc.mutate(response)
			}
			if _, err := p.verifyRegistration(user, *session, response); !errors.Is(err, ErrPasskeyInvalidRegistration) {
				t.Fatalf("invalid registration not rejected: %v", err)
			}
		})
	}
	user.handle = bytes.Repeat([]byte{0x24}, 32)
	if _, err := p.verifyRegistration(user, *session, valid); !errors.Is(err, ErrPasskeyInvalidRegistration) {
		t.Fatalf("credential response accepted for a different handle: %v", err)
	}
}
