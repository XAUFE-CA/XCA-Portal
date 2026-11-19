package auth

import (
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
	digest, ok := sessionDigest(token)
	want := sha256.Sum256([]byte(token))
	if !ok || string(digest) != string(want[:]) {
		t.Fatal("incorrect credential digest")
	}
	for _, invalid := range []string{"", token + "=", token[:len(token)-1], "not a token"} {
		if _, ok := sessionDigest(invalid); ok {
			t.Errorf("accepted invalid credential %q", invalid)
		}
	}
}
