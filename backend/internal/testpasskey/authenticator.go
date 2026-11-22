package testpasskey

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"testing"

	"github.com/go-webauthn/webauthn/protocol"
)

type Authenticator struct {
	private *ecdsa.PrivateKey
}

type AssertionOptions struct {
	OmitFlags   protocol.AuthenticatorFlags
	AddFlags    protocol.AuthenticatorFlags
	Ceremony    protocol.CeremonyType
	CrossOrigin bool
	TopOrigin   string
	SignCount   uint32
}

func NewAuthenticator(t testing.TB) *Authenticator {
	t.Helper()
	private, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return &Authenticator{private: private}
}

func (a *Authenticator) Registration(t testing.TB, challenge, rpID, origin string, id []byte, opts Options) *protocol.CredentialCreationResponse {
	t.Helper()
	if opts.COSEKey == nil {
		// COSE key labels encode EC2, ES256, P-256, and the two point coordinates.
		// COSE 密钥标签表示 EC2、ES256、P-256 和两个点坐标。
		opts.COSEKey = marshalCBOR(t, map[int]any{
			1: 2, 3: -7, -1: 1,
			-2: a.private.X.FillBytes(make([]byte, 32)), -3: a.private.Y.FillBytes(make([]byte, 32)),
		})
	}
	return registration(t, challenge, rpID, origin, id, opts)
}

func (a *Authenticator) Assertion(t testing.TB, challenge, rpID, origin string, id, handle []byte, opts AssertionOptions) *protocol.CredentialAssertionResponse {
	t.Helper()
	if opts.Ceremony == "" {
		opts.Ceremony = protocol.AssertCeremony
	}
	clientData := collectedClientData(t, opts.Ceremony, challenge, origin, opts.CrossOrigin, opts.TopOrigin)
	const authDataSize = sha256.Size + 1 + 4
	var signed [authDataSize + sha256.Size]byte
	rpHash := sha256.Sum256([]byte(rpID))
	copy(signed[:sha256.Size], rpHash[:])
	flags := protocol.FlagUserPresent | protocol.FlagUserVerified | opts.AddFlags
	signed[sha256.Size] = byte(flags &^ opts.OmitFlags)
	binary.BigEndian.PutUint32(signed[sha256.Size+1:authDataSize], opts.SignCount)
	clientHash := sha256.Sum256(clientData)
	copy(signed[authDataSize:], clientHash[:])
	digest := sha256.Sum256(signed[:])
	signature, err := ecdsa.SignASN1(rand.Reader, a.private, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return &protocol.CredentialAssertionResponse{
		PublicKeyCredential: credential(id),
		AssertionResponse: protocol.AuthenticatorAssertionResponse{
			AuthenticatorResponse: protocol.AuthenticatorResponse{ClientDataJSON: clientData},
			AuthenticatorData:     signed[:authDataSize:authDataSize],
			Signature:             signature,
			UserHandle:            handle,
		},
	}
}

func collectedClientData(t testing.TB, ceremony protocol.CeremonyType, challenge, origin string, crossOrigin bool, topOrigin string) []byte {
	t.Helper()
	data, err := json.Marshal(protocol.CollectedClientData{
		Type: ceremony, Challenge: challenge, Origin: origin,
		CrossOrigin: crossOrigin, TopOrigin: topOrigin,
	})
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func credential(id []byte) protocol.PublicKeyCredential {
	return protocol.PublicKeyCredential{
		Credential: protocol.Credential{ID: base64.RawURLEncoding.EncodeToString(id), Type: "public-key"},
		RawID:      id,
	}
}
