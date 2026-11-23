//go:build integration

package emailcode

import (
	"context"
	"crypto/sha256"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/session"
)

func TestSessionTransactionAndDevices(t *testing.T) {
	env := setupIntegration(t)
	ctx := context.Background()
	email := testEmail(t)
	item, invitation := createInvitation(t, env, email, "session-member")
	flow := request(t, env.svc, email, invitation, "192.0.2.10")
	messageID, code := mailpitMessage(t, email, "")
	waitDelivered(t, env.pool, flow.FlowID)
	sessions := session.NewSessions(env.pool, time.Hour)
	if _, err := env.pool.Exec(ctx, `CREATE FUNCTION reject_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'rejected'; END $$; CREATE TRIGGER reject_session BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION reject_session()`); err != nil {
		t.Fatal(err)
	}
	if _, _, err := sessions.Verify(ctx, env.svc, flow.FlowID, code); !errors.Is(err, auth.ErrUnavailable) {
		t.Fatal("session insertion failure did not abort verification")
	}
	var users int
	var used *time.Time
	if err := env.pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE email=$1`, email).Scan(&users); err != nil || users != 0 {
		t.Fatal("activation was not rolled back")
	}
	if err := env.pool.QueryRow(ctx, `SELECT used_at FROM invitations WHERE id=$1`, item.ID).Scan(&used); err != nil || used != nil {
		t.Fatal("invitation was consumed on failure")
	}
	if _, err := env.pool.Exec(ctx, `DROP TRIGGER reject_session ON sessions; DROP FUNCTION reject_session()`); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan string, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			token, _, err := sessions.Verify(ctx, env.svc, flow.FlowID, code)
			if err == nil {
				results <- token
			} else if !errors.Is(err, ErrInvalidCode) {
				t.Errorf("verification failed unexpectedly: %v", err)
			}
		}()
	}
	wg.Wait()
	close(results)
	var first string
	count := 0
	for token := range results {
		first = token
		count++
	}
	if count != 1 {
		t.Fatalf("concurrent verification produced %d sessions", count)
	}
	digest := sha256.Sum256([]byte(first))
	var stored []byte
	var freshOTP bool
	if err := env.pool.QueryRow(ctx, `SELECT session_digest,
		COALESCE(otp_verified_at BETWEEN created_at AND clock_timestamp(), false) FROM sessions`).
		Scan(&stored, &freshOTP); err != nil || string(stored) != string(digest[:]) || string(stored) == first {
		t.Fatal("session credential was not stored as SHA-256")
	}
	if !freshOTP {
		t.Fatal("invitation activation did not stamp the new session with its OTP verification time")
	}
	if _, err := env.pool.Exec(ctx, `UPDATE auth_rate_limits SET expires_at = clock_timestamp() - interval '1 second' WHERE scope = 'email_cooldown'`); err != nil {
		t.Fatal(err)
	}
	secondFlow := request(t, env.svc, email, "", "192.0.2.11")
	_, secondCode := mailpitMessage(t, email, messageID)
	waitDelivered(t, env.pool, secondFlow.FlowID)
	second, _, err := sessions.Verify(ctx, env.svc, secondFlow.FlowID, secondCode)
	if err != nil || second == first {
		t.Fatal("second device did not receive a distinct session")
	}
	secondDigest := sha256.Sum256([]byte(second))
	var otpVerifiedAt time.Time
	if err := env.pool.QueryRow(ctx, `SELECT otp_verified_at FROM sessions WHERE session_digest = $1`, secondDigest[:]).
		Scan(&otpVerifiedAt); err != nil {
		t.Fatalf("email sign-in did not stamp its new session: %v", err)
	}
	if _, err := env.pool.Exec(ctx, `UPDATE sessions SET last_used_at = otp_verified_at - interval '1 second'
		WHERE session_digest = $1`, secondDigest[:]); err != nil {
		t.Fatal(err)
	}
	if err := sessions.Revoke(ctx, first); err != nil {
		t.Fatal(err)
	}
	if id, err := sessions.Get(ctx, first); err != nil || id != nil {
		t.Fatal("revoked session remained active")
	}
	if id, err := sessions.Get(ctx, second); err != nil || id == nil || id.LoginName != "session-member" {
		t.Fatal("revoking one device affected another")
	}
	var afterRead, lastUsed time.Time
	if err := env.pool.QueryRow(ctx, `SELECT otp_verified_at, last_used_at FROM sessions WHERE session_digest = $1`, secondDigest[:]).
		Scan(&afterRead, &lastUsed); err != nil || !afterRead.Equal(otpVerifiedAt) || lastUsed.Before(otpVerifiedAt) {
		t.Fatalf("session lookup must refresh usage without extending OTP freshness: %v", err)
	}
	if _, err := env.pool.Exec(ctx, `UPDATE users SET status='disabled' WHERE email=$1`, email); err != nil {
		t.Fatal(err)
	}
	if id, err := sessions.Get(ctx, second); err != nil || id != nil {
		t.Fatal("disabled user retained session")
	}
	if _, err := env.pool.Exec(ctx, `UPDATE users SET status='active' WHERE email=$1`, email); err != nil {
		t.Fatal(err)
	}
	if _, err := env.pool.Exec(ctx, `UPDATE sessions SET expires_at=created_at + interval '1 microsecond'`); err != nil {
		t.Fatal(err)
	}
	if id, err := sessions.Get(ctx, second); err != nil || id != nil {
		t.Fatal("expired session remained active")
	}
	env.pool.Close()
	if _, err := sessions.Get(ctx, second); !errors.Is(err, auth.ErrUnavailable) {
		t.Fatal("database failure was mistaken for a guest")
	}
}
