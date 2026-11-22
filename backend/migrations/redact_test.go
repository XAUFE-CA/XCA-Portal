package migrations

import (
	"errors"
	"strings"
	"testing"
)

const testDSN = "postgres://xca_dev:s3cr3t-p%40ss@127.0.0.1:5433/xca_dev?sslmode=disable"

func TestRedactRemovesCredentials(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want []string
	}{
		{
			name: "full connection string",
			err:  errors.New("cannot parse `" + testDSN + "`"),
			want: []string{"<DATABASE_URL>", "s3cr3t", "xca_dev:"},
		},
		{
			name: "decoded password only",
			err:  errors.New("auth failed for password s3cr3t-p@ss"),
			want: []string{"<REDACTED>", "s3cr3t"},
		},
		{
			name: "escaped password only",
			err:  errors.New("auth failed for password s3cr3t-p%40ss"),
			want: []string{"<REDACTED>", "s3cr3t"},
		},
		{
			name: "unrelated dsn in message",
			err:  errors.New("dial postgres://other:leak@db.internal:5432/x failed"),
			want: []string{"postgres://<redacted>@", "leak"},
		},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			got := redact(item.err, testDSN)
			for _, secret := range item.want[1:] {
				if strings.Contains(got, secret) {
					t.Fatalf("redacted message still contains %q: %s", secret, got)
				}
			}
			if !strings.Contains(got, item.want[0]) {
				t.Fatalf("redacted message is missing %q: %s", item.want[0], got)
			}
		})
	}
}

func TestRedactBoundsAndCollapsesWhitespace(t *testing.T) {
	got := redact(errors.New("line one\n\tline   two\n"+strings.Repeat("x", maxFailureDetail*2)), "")
	if strings.ContainsAny(got, "\n\t") || strings.Contains(got, "  ") {
		t.Fatalf("redacted message keeps raw whitespace: %q", got)
	}
	if runes := []rune(got); len(runes) > maxFailureDetail+1 {
		t.Fatalf("redacted message is %d runes, want at most %d", len(runes), maxFailureDetail+1)
	}
}

func TestFailureKeepsCause(t *testing.T) {
	inner := errors.New("no migration found for version 3")
	err := cause("migration failed", inner, testDSN)
	if !errors.Is(err, inner) {
		t.Fatal("wrapped failure does not expose its cause")
	}
	if !strings.Contains(err.Error(), "no migration found for version 3") {
		t.Fatalf("failure message hides the cause: %s", err.Error())
	}
}
