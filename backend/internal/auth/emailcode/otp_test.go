package emailcode

import (
	"bytes"
	"regexp"
	"testing"
)

func TestOTPFormatAndDistribution(t *testing.T) {
	const samples = 10000
	format := regexp.MustCompile(`^[0-9]{6}$`)
	counts := [10]int{}
	for range samples {
		code, err := newCode()
		if err != nil {
			t.Fatal(err)
		}
		if !format.MatchString(code) {
			t.Fatal("invalid code format")
		}
		counts[code[0]-'0']++
	}
	for digit, count := range counts {
		if count < 700 || count > 1300 {
			t.Fatalf("digit %d appeared %d times in %d samples", digit, count, samples)
		}
	}
}

func TestOTPBindingAndFlowIDs(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	first, err := newFlowID()
	if err != nil {
		t.Fatal(err)
	}
	second, err := newFlowID()
	if err != nil {
		t.Fatal(err)
	}
	if first == second || !regexp.MustCompile(`^[A-Za-z0-9_-]{32,128}$`).MatchString(first) {
		t.Fatal("flow identifiers are invalid or repeated")
	}
	digest := signOTP(key, first, "012345")
	if !equalDigest(digest, signOTP(key, first, "012345")) {
		t.Fatal("valid code not verified")
	}
	for _, other := range [][]byte{
		signOTP(key, second, "012345"),
		signOTP(key, first, "012346"),
		signOTP(bytes.Repeat([]byte{42}, 32), first, "012345"),
	} {
		if equalDigest(digest, other) {
			t.Fatal("digest did not bind flow, code and key")
		}
	}
}
