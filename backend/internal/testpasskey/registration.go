package testpasskey

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"testing"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/protocol/webauthncbor"
)

type Options struct {
	OmitFlags   protocol.AuthenticatorFlags
	AddFlags    protocol.AuthenticatorFlags
	Ceremony    protocol.CeremonyType
	CrossOrigin bool
	TopOrigin   string
	AttestedID  []byte
	COSEKey     []byte
	SignCount   uint32
}

func Response(t testing.TB, challenge, rpID, origin string, id []byte) *protocol.CredentialCreationResponse {
	t.Helper()
	return ResponseWith(t, challenge, rpID, origin, id, Options{})
}

func ResponseWith(t testing.TB, challenge, rpID, origin string, id []byte, options Options) *protocol.CredentialCreationResponse {
	t.Helper()
	if options.COSEKey == nil {
		return NewAuthenticator(t).Registration(t, challenge, rpID, origin, id, options)
	}
	return registration(t, challenge, rpID, origin, id, options)
}

func registration(t testing.TB, challenge, rpID, origin string, id []byte, options Options) *protocol.CredentialCreationResponse {
	t.Helper()
	if options.Ceremony == "" {
		options.Ceremony = protocol.CreateCeremony
	}
	clientData := collectedClientData(t, options.Ceremony, challenge, origin, options.CrossOrigin, options.TopOrigin)
	key := options.COSEKey
	attestedID := options.AttestedID
	if attestedID == nil {
		attestedID = id
	}
	if len(attestedID) > 65535 {
		t.Fatal("attested credential ID exceeds the binary field size")
	}
	rpHash := sha256.Sum256([]byte(rpID))
	flags := protocol.FlagUserPresent | protocol.FlagUserVerified | protocol.FlagAttestedCredentialData
	flags = (flags | options.AddFlags) &^ options.OmitFlags
	authData := bytes.NewBuffer(make([]byte, 0, 55+len(attestedID)+len(key)))
	authData.Write(rpHash[:])
	authData.WriteByte(byte(flags))
	authData.Write(binary.BigEndian.AppendUint32(nil, options.SignCount))
	authData.Write(make([]byte, 16))
	authData.Write(binary.BigEndian.AppendUint16(nil, uint16(len(attestedID))))
	authData.Write(attestedID)
	authData.Write(key)
	attestation := marshalCBOR(t, map[string]any{
		"fmt": "none", "authData": authData.Bytes(), "attStmt": map[string]any{},
	})
	return &protocol.CredentialCreationResponse{
		PublicKeyCredential: credential(id),
		AttestationResponse: protocol.AuthenticatorAttestationResponse{
			AuthenticatorResponse: protocol.AuthenticatorResponse{ClientDataJSON: clientData},
			AuthenticatorData:     authData.Bytes(), AttestationObject: attestation,
		},
	}
}

func marshalCBOR(t testing.TB, value any) []byte {
	t.Helper()
	encoded, err := webauthncbor.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}
