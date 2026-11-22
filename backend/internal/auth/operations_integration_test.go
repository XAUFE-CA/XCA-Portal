//go:build integration

package auth

import (
	"context"
	"crypto/sha256"
	"errors"
	"testing"
	"time"
)

func TestDurableOperationBarrier(t *testing.T) {
	env := setupIntegration(t)
	ctx := context.Background()
	email := testEmail(t)
	_, invitation := createInvitation(t, env, email, "barrier-member")
	flow := request(t, env.svc, email, invitation, "192.0.2.120")
	_, code := mailpitMessage(t, email, "")
	waitDelivered(t, env.pool, flow.FlowID)

	sessions := NewSessions(env.pool, time.Hour)
	blocked := "11111111-1111-4111-8111-111111111111"
	if _, err := sessions.Abandon(ctx, blocked, "", false); err != nil {
		t.Fatal(err)
	}
	if _, _, err := sessions.VerifyWithOperation(ctx, env.svc, flow.FlowID, code, blocked); !errors.Is(err, ErrOperationAbandoned) {
		t.Fatalf("abandoned verification committed: %v", err)
	}
	var count int
	if err := env.pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE email = $1`, email).Scan(&count); err != nil || count != 0 {
		t.Fatal("abandoned verification activated an account")
	}

	valid := "22222222-2222-4222-8222-222222222222"
	token, _, err := sessions.VerifyWithOperation(ctx, env.svc, flow.FlowID, code, valid)
	if err != nil {
		t.Fatal(err)
	}
	if id, err := sessions.Get(ctx, token); err != nil || id == nil {
		t.Fatal("committed verification created no usable session")
	}
	if _, err := sessions.Abandon(ctx, valid, "", false); err != nil {
		t.Fatal(err)
	}
	if id, err := sessions.Get(ctx, token); err != nil || id != nil {
		t.Fatal("barrier did not revoke an already committed verification")
	}
	if _, err := sessions.Abandon(ctx, valid, "", false); err != nil {
		t.Fatal("abandon must be idempotent")
	}

	blockedLogout := "33333333-3333-4333-8333-333333333333"
	if _, err := sessions.Abandon(ctx, blockedLogout, "", false); err != nil {
		t.Fatal(err)
	}
	if err := sessions.RevokeWithOperation(ctx, token, blockedLogout); !errors.Is(err, ErrOperationAbandoned) {
		t.Fatalf("late logout was not fenced: %v", err)
	}
	logout := "44444444-4444-4444-8444-444444444444"
	if err := sessions.RevokeWithOperation(ctx, token, logout); err != nil {
		t.Fatal(err)
	}
	if _, err := sessions.Abandon(ctx, logout, "", false); err != nil {
		t.Fatal("abandon after completed logout must succeed")
	}
}

func TestBarrierWaitsForInFlightSessionCommit(t *testing.T) {
	env := setupIntegration(t)
	ctx := context.Background()
	sessions := NewSessions(env.pool, time.Hour)
	var userID string
	if err := env.pool.QueryRow(ctx, `INSERT INTO users (email, login_name, display_name, status)
		VALUES ($1, 'pending-commit', 'Pending', 'active') RETURNING id::text`,
		testEmail(t)).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	token := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	digest := sha256.Sum256([]byte(token))
	tx, err := env.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	operationID := "55555555-5555-4555-8555-555555555555"
	if err := claimOperation(ctx, tx, operationID, "verify", digest[:]); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO sessions (session_digest, user_id, expires_at)
		VALUES ($1, $2::uuid, now() + interval '1 hour')`, digest[:], userID); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := sessions.Abandon(ctx, operationID, "", false)
		done <- err
	}()
	// The barrier must not return before the original transaction releases its PK lock.
	// 原事务释放主键锁前，屏障不得返回。
	select {
	case err := <-done:
		t.Fatalf("barrier passed a live transaction: %v", err)
	case <-time.After(70 * time.Millisecond):
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("barrier remained blocked after commit")
	}
	if id, err := sessions.Get(ctx, token); err != nil || id != nil {
		t.Fatal("late committed session survived the barrier")
	}
}
