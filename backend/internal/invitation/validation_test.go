package invitation_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/invitation"
)

func TestNormalizeEmail(t *testing.T) {
	for _, tc := range []struct {
		input string
		want  string
		valid bool
	}{
		{"  Member+Tag@Example.COM  ", "member+tag@example.com", true},
		{"name@example.org", "name@example.org", true},
		{"Member <member@example.com>", "", false},
		{"member@example.com\r\nBcc:x@example.com", "", false},
		{"member @example.com", "", false},
		{"member", "", false},
		{strings.Repeat("a", 250) + "@x.org", "", false},
	} {
		got, err := invitation.NormalizeEmail(tc.input)
		if (err == nil) != tc.valid || got != tc.want {
			t.Errorf("NormalizeEmail(%q) = %q, %v", tc.input, got, err)
		}
	}
}

func TestNormalizeLogin(t *testing.T) {
	for _, tc := range []struct {
		input string
		want  string
		valid bool
	}{
		{"  Member-01_Name  ", "member-01_name", true},
		{"a", "a", true},
		{strings.Repeat("a", 128), strings.Repeat("a", 128), true},
		{"Guest", "", false},
		{"ROOT", "", false},
		{"-member", "", false},
		{"member name", "", false},
		{"成员", "", false},
		{"member\x1b[31m", "", false},
		{strings.Repeat("a", 129), "", false},
	} {
		got, err := invitation.NormalizeLogin(tc.input)
		if (err == nil) != tc.valid || got != tc.want {
			t.Errorf("NormalizeLogin(%q) = %q, %v", tc.input, got, err)
		}
	}
}

func TestCreateRejectsInvalidDisplayNameBeforeDatabaseAccess(t *testing.T) {
	store := invitation.NewStore(nil)
	for _, display := range []string{"", "  ", "line\nbreak", "escape\x1b[31m", "hidden\u202ename", strings.Repeat("a", 129)} {
		_, _, err := store.Create(context.Background(), invitation.CreateInput{
			Email: "member@example.org", LoginName: "member", DisplayName: display,
		})
		if !errors.Is(err, invitation.ErrInvalidInput) {
			t.Errorf("display %q: expected invalid input, got %v", display, err)
		}
	}
}

func TestCreateRejectsInvalidTTLBeforeDatabaseAccess(t *testing.T) {
	store := invitation.NewStore(nil)
	for _, ttl := range []time.Duration{-time.Second, time.Nanosecond, time.Microsecond + time.Nanosecond, invitation.MaxTTL + time.Microsecond} {
		_, _, err := store.Create(context.Background(), invitation.CreateInput{
			Email: "member@example.org", LoginName: "member", DisplayName: "Member", TTL: ttl,
		})
		if !errors.Is(err, invitation.ErrInvalidInput) {
			t.Errorf("TTL %v: expected invalid input, got %v", ttl, err)
		}
	}
}
