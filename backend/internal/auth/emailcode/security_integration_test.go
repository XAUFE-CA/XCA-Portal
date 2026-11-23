//go:build integration

package emailcode

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/ratelimit"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/invitation"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/mail"
	"github.com/jackc/pgx/v5"
)

type senderFunc func(context.Context, mail.Message) error

func (f senderFunc) Send(ctx context.Context, message mail.Message) error { return f(ctx, message) }

func TestAttemptLimitAndExpiry(t *testing.T) {
	env := setupIntegration(t)
	ctx := context.Background()
	email := testEmail(t)
	_, token := createInvitation(t, env, email, "attempt-user")
	flow := request(t, env.svc, email, token, "192.0.2.40")
	_, code := mailpitMessage(t, email, "")
	waitDelivered(t, env.pool, flow.FlowID)
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	var invalid atomic.Int32
	var attemptsWG sync.WaitGroup
	for range 20 {
		attemptsWG.Add(1)
		go func() {
			defer attemptsWG.Done()
			if errors.Is(env.svc.WithVerifiedChallenge(ctx, flow.FlowID, wrong, acceptVerification), ErrInvalidCode) {
				invalid.Add(1)
			}
		}()
	}
	attemptsWG.Wait()
	if invalid.Load() != 20 {
		t.Fatal("concurrent incorrect attempts were not all rejected")
	}
	if err := env.svc.WithVerifiedChallenge(ctx, flow.FlowID, code, acceptVerification); !errors.Is(err, ErrInvalidCode) {
		t.Fatal("attempt limit bypassed")
	}
	var attempts int
	if err := env.pool.QueryRow(ctx, `SELECT attempts FROM email_challenges WHERE flow_id = $1`, flow.FlowID).Scan(&attempts); err != nil || attempts != maxAttempts {
		t.Fatal("failed attempts were not retained")
	}

	expiredEmail := testEmail(t)
	_, expiredToken := createInvitation(t, env, expiredEmail, "expiry-user")
	expired := request(t, env.svc, expiredEmail, expiredToken, "192.0.2.41")
	_, expiredCode := mailpitMessage(t, expiredEmail, "")
	waitDelivered(t, env.pool, expired.FlowID)
	if _, err := env.pool.Exec(ctx, `UPDATE email_challenges SET created_at = clock_timestamp() - interval '11 minutes', expires_at = clock_timestamp() - interval '1 second' WHERE flow_id = $1`, expired.FlowID); err != nil {
		t.Fatal(err)
	}
	if err := env.svc.WithVerifiedChallenge(ctx, expired.FlowID, expiredCode, acceptVerification); !errors.Is(err, ErrInvalidCode) {
		t.Fatal("expired flow accepted")
	}
}

func TestKeyRotationRetainsLiveChallenges(t *testing.T) {
	env := setupIntegration(t)
	email := testEmail(t)
	_, token := createInvitation(t, env, email, "rotate-user")
	flow := request(t, env.svc, email, token, "192.0.2.42")
	_, code := mailpitMessage(t, email, "")
	waitDelivered(t, env.pool, flow.FlowID)
	env.svc.Close()
	next := env.cfg
	next.OTPKeyVersion = 2
	next.OTPHMACKey = []byte("abcdef0123456789abcdef0123456789")
	if service, err := New(context.Background(), env.pool, next, env.sender, nil, 4); err == nil {
		service.Close()
		t.Fatal("removed a key still needed by a live challenge")
	}
	next.OTPPreviousKeys = map[int][]byte{1: env.cfg.OTPHMACKey}
	service, err := New(context.Background(), env.pool, next, env.sender, nil, 4)
	if err != nil {
		t.Fatal("rotation with previous key failed")
	}
	defer service.Close()
	if err := service.WithVerifiedChallenge(context.Background(), flow.FlowID, code, acceptVerification); err != nil {
		t.Fatal("challenge signed by previous key could not be verified")
	}
}

func TestConcurrentVerificationAndInvitationConsumption(t *testing.T) {
	env := setupIntegration(t)
	ctx := context.Background()
	email := testEmail(t)
	_, token := createInvitation(t, env, email, "concurrent-user")
	flow := request(t, env.svc, email, token, "192.0.2.43")
	_, code := mailpitMessage(t, email, "")
	waitDelivered(t, env.pool, flow.FlowID)
	secondID, err := newFlowID()
	if err != nil {
		t.Fatal(err)
	}
	_, err = env.pool.Exec(ctx, `INSERT INTO email_challenges
		(flow_id, email, otp_digest, key_version, invitation_id, user_id, expires_at, delivered_at, created_at)
		SELECT $2, email, $3, key_version, invitation_id, user_id, expires_at, delivered_at, created_at
		FROM email_challenges WHERE flow_id = $1`, flow.FlowID, secondID, signOTP(env.cfg.OTPHMACKey, secondID, code))
	if err != nil {
		t.Fatal(err)
	}
	var ok atomic.Int32
	var failed atomic.Int32
	var calls atomic.Int32
	var wg sync.WaitGroup
	for i := range 24 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			id := flow.FlowID
			if i%2 == 1 {
				id = secondID
			}
			err := env.svc.WithVerifiedChallenge(ctx, id, code, func(context.Context, pgx.Tx, auth.Identity) error {
				calls.Add(1)
				return nil
			})
			if err == nil {
				ok.Add(1)
			} else if errors.Is(err, ErrInvalidCode) {
				failed.Add(1)
			}
		}()
	}
	wg.Wait()
	if ok.Load() != 1 || failed.Load() != 23 || calls.Load() != 1 {
		t.Fatalf("verification results: successful=%d invalid=%d callbacks=%d", ok.Load(), failed.Load(), calls.Load())
	}
}

func TestActivationConflictAndRevocation(t *testing.T) {
	env := setupIntegration(t)
	ctx := context.Background()
	email := testEmail(t)
	item, token := createInvitation(t, env, email, "conflict-user")
	flow := request(t, env.svc, email, token, "192.0.2.44")
	_, code := mailpitMessage(t, email, "")
	waitDelivered(t, env.pool, flow.FlowID)
	_, err := env.pool.Exec(ctx, `INSERT INTO users (email, login_name, display_name) VALUES ($1, 'conflict-user', 'Other')`, testEmail(t))
	if err != nil {
		t.Fatal(err)
	}
	if err := env.svc.WithVerifiedChallenge(ctx, flow.FlowID, code, acceptVerification); !errors.Is(err, ErrInvalidCode) {
		t.Fatal("username conflict did not reject activation")
	}
	var used *time.Time
	if err := env.pool.QueryRow(ctx, `SELECT used_at FROM invitations WHERE id = $1`, item.ID).Scan(&used); err != nil || used != nil {
		t.Fatal("conflict left a partly consumed invitation")
	}
	if _, err := env.pool.Exec(ctx, `DELETE FROM users WHERE login_name = 'conflict-user'`); err != nil {
		t.Fatal(err)
	}
	if err := invitation.NewStore(env.pool).Revoke(ctx, item.ID); err != nil {
		t.Fatal(err)
	}
	if err := env.svc.WithVerifiedChallenge(ctx, flow.FlowID, code, acceptVerification); !errors.Is(err, ErrInvalidCode) {
		t.Fatal("revoked invitation was activated")
	}
}

func TestDisablingAccountInvalidatesPendingLogin(t *testing.T) {
	env := setupIntegration(t)
	ctx := context.Background()
	email := testEmail(t)
	if _, err := env.pool.Exec(ctx, `INSERT INTO users (email, login_name, display_name) VALUES ($1, 'disable-user', 'Member')`, email); err != nil {
		t.Fatal(err)
	}
	flow := request(t, env.svc, email, "", "192.0.2.45")
	_, code := mailpitMessage(t, email, "")
	waitDelivered(t, env.pool, flow.FlowID)
	if _, err := env.pool.Exec(ctx, `UPDATE users SET status = 'disabled' WHERE email = $1`, email); err != nil {
		t.Fatal(err)
	}
	if err := env.svc.WithVerifiedChallenge(ctx, flow.FlowID, code, acceptVerification); !errors.Is(err, ErrInvalidCode) {
		t.Fatal("disabled account authenticated")
	}
}

func TestRateLimitWindowBoundaries(t *testing.T) {
	env := setupIntegration(t)
	ctx := context.Background()
	start := time.Date(2035, time.January, 1, 0, 0, 0, 0, time.UTC)
	ipDigest := ratelimit.SubjectDigest(env.cfg.RateLimitHMACKey, "ip", "192.0.2.5")
	emailDigest := ratelimit.SubjectDigest(env.cfg.RateLimitHMACKey, "email", "boundary@example.invalid")
	cooldownDigest := ratelimit.SubjectDigest(env.cfg.RateLimitHMACKey, "email_cooldown", "boundary@example.invalid")
	for _, test := range []struct {
		offset time.Duration
		retry  time.Duration
	}{
		{0, 0},
		{59 * time.Second, time.Second},
		{60 * time.Second, 0},
		{61 * time.Second, 14*time.Minute - time.Second},
		{15 * time.Minute, 0},
	} {
		tx, err := env.pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		retry, err := env.svc.applyLimits(ctx, tx, ipDigest, emailDigest, cooldownDigest, start.Add(test.offset))
		if err != nil || retry != test.retry {
			_ = tx.Rollback(ctx)
			t.Fatalf("offset %v: retry=%v expected=%v", test.offset, retry, test.retry)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
}

func TestAtomicLimitsAndRestart(t *testing.T) {
	env := setupIntegration(t)
	ctx := context.Background()
	if _, err := env.pool.Exec(ctx, `INSERT INTO users (email, login_name, display_name)
		SELECT 'limit-' || n || '@example.invalid', 'limit-' || n, 'Limit' FROM generate_series(0, 39) AS n`); err != nil {
		t.Fatal(err)
	}
	var allowed atomic.Int32
	var limited atomic.Int32
	var wg sync.WaitGroup
	for i := range 40 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := env.svc.Request(ctx, fmt.Sprintf("limit-%d@example.invalid", i), "", netip.MustParseAddr("198.51.100.1"))
			var rate *ratelimit.Error
			if err == nil {
				allowed.Add(1)
			} else if errors.As(err, &rate) && rate.RetryAfterSeconds > 0 {
				limited.Add(1)
			}
		}()
	}
	wg.Wait()
	if allowed.Load() != 30 || limited.Load() != 10 {
		t.Fatalf("IP limit allowed=%d limited=%d", allowed.Load(), limited.Load())
	}
	poll(t, func() bool {
		var delivered int
		err := env.pool.QueryRow(ctx, `SELECT count(*) FROM email_challenges WHERE email LIKE 'limit-%@example.invalid' AND delivered_at IS NOT NULL`).Scan(&delivered)
		return err == nil && delivered == 30
	})
	env.svc.Close()
	restarted, err := New(ctx, env.pool, env.cfg, env.sender, nil, 128)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	_, err = restarted.Request(ctx, testEmail(t), "", netip.MustParseAddr("198.51.100.1"))
	var rate *ratelimit.Error
	if !errors.As(err, &rate) {
		t.Fatal("IP limit was lost on restart")
	}

	email := testEmail(t)
	allowed.Store(0)
	limited.Store(0)
	for i := range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ip := netip.MustParseAddr(fmt.Sprintf("203.0.113.%d", i+1))
			_, err := restarted.Request(ctx, email, "", ip)
			var rate *ratelimit.Error
			if err == nil {
				allowed.Add(1)
			} else if errors.As(err, &rate) {
				limited.Add(1)
			}
		}()
	}
	wg.Wait()
	if allowed.Load() != 1 || limited.Load() != 11 {
		t.Fatalf("email cooldown allowed=%d limited=%d", allowed.Load(), limited.Load())
	}
	var malformed int
	if err := env.pool.QueryRow(ctx, `SELECT count(*) FROM auth_rate_limits WHERE octet_length(subject_digest) <> 32`).Scan(&malformed); err != nil || malformed != 0 {
		t.Fatal("rate limit subjects are not keyed digests")
	}
	if _, err := env.pool.Exec(ctx, `UPDATE auth_rate_limits SET expires_at = clock_timestamp() - interval '1 second' WHERE scope = 'email_cooldown' AND subject_digest = $1`, ratelimit.SubjectDigest(env.cfg.RateLimitHMACKey, "email_cooldown", email)); err != nil {
		t.Fatal(err)
	}
	removed, err := restarted.CleanExpiredRateLimits(ctx)
	if err != nil || removed < 1 {
		t.Fatal("expired rate-limit window was not cleaned")
	}
	_, err = restarted.Request(ctx, email, "", netip.MustParseAddr("203.0.113.99"))
	if !errors.As(err, &rate) {
		t.Fatal("cleaning cooldown erased the active email quota")
	}
}

func TestDeliveryFailureAndCapacityAreNotEligibilitySignals(t *testing.T) {
	env := setupIntegration(t)
	ctx := context.Background()
	fakeService, err := New(ctx, env.pool, env.cfg, env.sender, nil, 1)
	if err != nil {
		t.Fatal(err)
	}
	defer fakeService.Close()
	request(t, fakeService, testEmail(t), "", "192.0.2.48")
	if _, err := fakeService.Request(ctx, testEmail(t), "", netip.MustParseAddr("192.0.2.49")); !errors.Is(err, auth.ErrUnavailable) {
		t.Fatal("ineligible flow released capacity earlier than eligible flow")
	}
	fakeService.Close()
	started, release := make(chan struct{}), make(chan struct{})
	sender := senderFunc(func(ctx context.Context, _ mail.Message) error {
		close(started)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-release:
			return errors.New("private SMTP details")
		}
	})
	service, err := New(ctx, env.pool, env.cfg, sender, nil, 1)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	email := testEmail(t)
	_, token := createInvitation(t, env, email, "delivery-user")
	flow := request(t, service, email, token, "192.0.2.46")
	<-started
	if _, err := service.Request(ctx, testEmail(t), "", netip.MustParseAddr("192.0.2.47")); !errors.Is(err, auth.ErrUnavailable) {
		t.Fatal("saturated sender did not reject requests before eligibility checks")
	}
	close(release)
	service.Close()
	if err := service.WithVerifiedChallenge(ctx, flow.FlowID, "000000", acceptVerification); !errors.Is(err, ErrInvalidCode) {
		t.Fatal("failed delivery produced a verifiable flow")
	}
}
