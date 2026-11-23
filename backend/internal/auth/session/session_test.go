package session

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"testing"
)

func TestSessionCredentialDigest(t *testing.T) {
	secret := make([]byte, 32)
	for i := range secret {
		secret[i] = byte(i)
	}
	token := base64.RawURLEncoding.EncodeToString(secret)
	digest, ok := Digest(token)
	want := sha256.Sum256([]byte(token))
	if !ok || string(digest) != string(want[:]) {
		t.Fatal("incorrect credential digest")
	}
	for _, invalid := range []string{"", token + "=", token[:len(token)-1], "not a token"} {
		if _, ok := Digest(invalid); ok {
			t.Errorf("accepted invalid credential %q", invalid)
		}
	}
}

func TestSessionTokenMatchesStoredDigest(t *testing.T) {
	token, digest, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	secret, err := base64.RawURLEncoding.Strict().DecodeString(token)
	if err != nil || len(secret) != 32 || digest != sha256.Sum256([]byte(token)) {
		t.Fatal("session token does not use a 32-byte secret and the digest of the encoded value")
	}
	lookup, ok := Digest(token)
	if !ok || !bytes.Equal(lookup, digest[:]) {
		t.Fatal("the existing Session lookup cannot resolve the generated token")
	}
}
