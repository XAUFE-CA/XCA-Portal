//go:build integration

package invitation_test

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/invitation"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/testdb"
	"github.com/XAUFE-CA/XCA-Portal/backend/migrations"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestInvitationLifecycle(t *testing.T) {
	dsn := testdb.New(t)
	if err := migrations.Up(dsn); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	store := invitation.NewStore(pool)
	input := invitation.CreateInput{Email: "  Member@Example.org ", LoginName: " Member-1 ", DisplayName: " 成员 "}
	created, token, err := store.Create(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if len(token) != 43 || created.Email != "member@example.org" || created.LoginName != "member-1" || created.DisplayName != "成员" || created.Status != "active" {
		t.Fatal("create returned invalid normalized fields or credential")
	}
	if created.ExpiresAt.Sub(created.CreatedAt) != 7*24*time.Hour {
		t.Fatal("invitation does not have the default seven-day lifetime")
	}
	var stored []byte
	if err := pool.QueryRow(ctx, `SELECT token_digest FROM invitations WHERE id = $1`, created.ID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte(token))
	if string(stored) != string(digest[:]) {
		t.Fatal("stored credential is not the token digest")
	}
	item, err := store.Get(ctx, created.ID)
	if err != nil || item.Status != "active" || item.ID != created.ID {
		t.Fatalf("get active invitation: %v", err)
	}
	if _, _, err := store.Create(ctx, input); !errors.Is(err, invitation.ErrConflict) {
		t.Fatalf("duplicate invitation: %v", err)
	}
	if err := store.Revoke(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
	item, err = store.Get(ctx, created.ID)
	if err != nil || item.Status != "revoked" {
		t.Fatalf("get revoked invitation: %v", err)
	}
	if err := store.Revoke(ctx, created.ID); !errors.Is(err, invitation.ErrNotRevocable) {
		t.Fatalf("repeat revoke: %v", err)
	}
	replacement, _, err := store.Create(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE invitations SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = $1`, replacement.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.Create(ctx, input); err != nil {
		t.Fatalf("expired slot not released: %v", err)
	}
	item, err = store.Get(ctx, replacement.ID)
	if err != nil || item.Status != "expired" {
		t.Fatalf("get expired invitation: %v", err)
	}
	if _, err := store.Get(ctx, "not-a-uuid"); !errors.Is(err, invitation.ErrNotFound) {
		t.Fatalf("invalid ID: %v", err)
	}
	custom, _, err := store.Create(ctx, invitation.CreateInput{
		Email: "custom@example.org", LoginName: "custom", DisplayName: "Custom", TTL: 12*time.Hour + 30*time.Minute,
	})
	if err != nil {
		t.Fatal(err)
	}
	if custom.ExpiresAt.Sub(custom.CreatedAt) != 12*time.Hour+30*time.Minute {
		t.Fatal("custom TTL not applied")
	}
}

func TestConcurrentInvitationCreation(t *testing.T) {
	dsn := testdb.New(t)
	if err := migrations.Up(dsn); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	store := invitation.NewStore(pool)
	for _, sameEmail := range []bool{true, false} {
		var wg sync.WaitGroup
		results := make(chan error, 12)
		for i := range 12 {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				input := invitation.CreateInput{Email: fmt.Sprintf("member-%d@example.org", i), LoginName: fmt.Sprintf("member-%d", i), DisplayName: "Member"}
				if sameEmail {
					input.Email = "same@example.org"
					input.LoginName = fmt.Sprintf("email-case-%d", i)
				} else {
					input.Email = fmt.Sprintf("login-case-%d@example.org", i)
					input.LoginName = "same-login"
				}
				_, _, err := store.Create(ctx, input)
				results <- err
			}(i)
		}
		wg.Wait()
		close(results)
		successes := 0
		for err := range results {
			if err == nil {
				successes++
			} else if !errors.Is(err, invitation.ErrConflict) {
				t.Fatalf("unexpected create error: %v", err)
			}
		}
		if successes != 1 {
			t.Fatalf("got %d successful creates, want one", successes)
		}
	}
}

func TestActivationPreventsReissueAndRevocation(t *testing.T) {
	dsn := testdb.New(t)
	if err := migrations.Up(dsn); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	store := invitation.NewStore(pool)
	input := invitation.CreateInput{Email: "member@example.org", LoginName: "member", DisplayName: "Member"}
	item, _, err := store.Create(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if err := invitation.LockKeys(ctx, tx, input.Email, input.LoginName); err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	result := make(chan error, 1)
	go func() {
		close(started)
		_, _, err := store.Create(ctx, input)
		result <- err
	}()
	<-started
	var userID string
	if err := tx.QueryRow(ctx, `INSERT INTO users (email, login_name, display_name) VALUES ($1, $2, $3) RETURNING id::text`,
		input.Email, input.LoginName, input.DisplayName).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE invitations SET used_at = now(), active_slot = false, user_id = $1 WHERE id = $2`, userID, item.ID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-result; !errors.Is(err, invitation.ErrConflict) {
		t.Fatalf("reissue after activation: %v", err)
	}
	if err := store.Revoke(ctx, item.ID); !errors.Is(err, invitation.ErrNotRevocable) {
		t.Fatalf("revoke used invitation: %v", err)
	}
	used, err := store.Get(ctx, item.ID)
	if err != nil || used.Status != "used" || used.UserID == nil || *used.UserID != userID {
		t.Fatalf("get used invitation: %v", err)
	}
	for _, candidate := range []invitation.CreateInput{
		{Email: input.Email, LoginName: "different", DisplayName: "Member"},
		{Email: "different@example.org", LoginName: input.LoginName, DisplayName: "Member"},
	} {
		if _, _, err := store.Create(ctx, candidate); !errors.Is(err, invitation.ErrConflict) {
			t.Fatalf("existing account conflict: %v", err)
		}
	}
}
