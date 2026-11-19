//go:build integration

package migrations_test

import (
	"context"
	"crypto/sha256"
	"strings"
	"sync"
	"testing"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/testdb"
	"github.com/XAUFE-CA/XCA-Portal/backend/migrations"
	"github.com/jackc/pgx/v5"
)

func connect(t *testing.T, dsn string) *pgx.Conn {
	t.Helper()
	conn, err := pgx.Connect(context.Background(), dsn)
	if err != nil {
		t.Fatal("cannot connect to isolated test database")
	}
	t.Cleanup(func() { _ = conn.Close(context.Background()) })
	return conn
}

func TestMigrationUpDown(t *testing.T) {
	dsn := testdb.New(t)
	for i := range 2 {
		if err := migrations.Up(dsn); err != nil {
			t.Fatalf("up %d: %v", i, err)
		}
	}
	conn := connect(t, dsn)
	var count int
	if err := conn.QueryRow(context.Background(), `SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('users', 'invitations', 'email_challenges', 'sessions', 'auth_rate_limits', 'auth_operations')`).Scan(&count); err != nil || count != 6 {
		t.Fatalf("expected six auth tables, got %d: %v", count, err)
	}
	var version int
	var dirty bool
	if err := conn.QueryRow(context.Background(), `SELECT version, dirty FROM schema_migrations`).Scan(&version, &dirty); err != nil || version != 1 || dirty {
		t.Fatalf("unexpected migration version %d dirty=%v: %v", version, dirty, err)
	}
	if err := migrations.Down(dsn); err != nil {
		t.Fatalf("down: %v", err)
	}
	if err := migrations.Down(dsn); err != nil {
		t.Fatalf("repeated down: %v", err)
	}
	if err := conn.QueryRow(context.Background(), `SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('users', 'invitations', 'email_challenges', 'sessions', 'auth_rate_limits', 'auth_operations')`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("expected no auth tables, got %d: %v", count, err)
	}
	if err := migrations.Up(dsn); err != nil {
		t.Fatalf("up after down: %v", err)
	}
}

func TestSchemaConstraints(t *testing.T) {
	dsn := testdb.New(t)
	if err := migrations.Up(dsn); err != nil {
		t.Fatal(err)
	}
	conn := connect(t, dsn)
	ctx := context.Background()
	insert := `INSERT INTO invitations (token_digest, email, login_name, display_name, expires_at) VALUES ($1, $2, $3, 'Example', now() + interval '1 hour')`
	digest := func(value string) []byte {
		sum := sha256.Sum256([]byte(value))
		return sum[:]
	}
	if _, err := conn.Exec(ctx, insert, digest("digest-one"), "person@example.test", "person"); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, insert, digest("digest-two"), "person@example.test", "another"); err == nil {
		t.Fatal("duplicate active invitation email was accepted")
	}
	if _, err := conn.Exec(ctx, insert, digest("digest-three"), "another@example.test", "person"); err == nil {
		t.Fatal("duplicate active invitation login name was accepted")
	}
	if _, err := conn.Exec(ctx, `UPDATE invitations SET revoked_at = now(), active_slot = false`); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, insert, digest("digest-four"), "person@example.test", "person"); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, insert, digest("digest-five"), "Person@example.test", "different"); err == nil {
		t.Fatal("unnormalized email was accepted")
	}
	if _, err := conn.Exec(ctx, `INSERT INTO email_challenges (flow_id, email, otp_digest, key_version, expires_at) VALUES ('flow', 'person@example.test', decode(repeat('01', 32), 'hex'), 1, now() + interval '1 hour')`); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, insert, []byte("short"), "other@example.test", "other"); err == nil {
		t.Fatal("invalid invitation digest length was accepted")
	}
	if _, err := conn.Exec(ctx, `UPDATE invitations SET used_at = now(), active_slot = false WHERE email = 'person@example.test' AND active_slot`); err == nil {
		t.Fatal("used invitation without a user was accepted")
	}
	var delivered bool
	if err := conn.QueryRow(ctx, `SELECT delivered_at IS NULL FROM email_challenges WHERE flow_id = 'flow'`).Scan(&delivered); err != nil || !delivered {
		t.Fatalf("new challenge must be undelivered: %v", err)
	}
}

func TestDirtyMigrationRequiresRepair(t *testing.T) {
	dsn := testdb.New(t)
	conn := connect(t, dsn)
	ctx := context.Background()
	if _, err := conn.Exec(ctx, `CREATE TABLE users (id integer)`); err != nil {
		t.Fatal(err)
	}
	if err := migrations.Up(dsn); err == nil {
		t.Fatal("expected migration failure")
	}
	if err := migrations.Up(dsn); err == nil || !strings.Contains(err.Error(), "dirty") {
		t.Fatalf("expected dirty migration error, got %v", err)
	}
	if err := migrations.Down(dsn); err == nil || !strings.Contains(err.Error(), "dirty") {
		t.Fatalf("expected dirty rollback error, got %v", err)
	}
	if _, err := conn.Exec(ctx, `DROP TABLE users; DELETE FROM schema_migrations`); err != nil {
		t.Fatal(err)
	}
	if err := migrations.Up(dsn); err != nil {
		t.Fatalf("up after explicit repair: %v", err)
	}
}

func TestConcurrentMigration(t *testing.T) {
	dsn := testdb.New(t)
	const runners = 8
	start := make(chan struct{})
	errs := make(chan error, runners)
	var wg sync.WaitGroup
	for range runners {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			errs <- migrations.Up(dsn)
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Errorf("concurrent up: %v", err)
		}
	}
	conn := connect(t, dsn)
	var version int
	var dirty bool
	if err := conn.QueryRow(context.Background(), `SELECT version, dirty FROM schema_migrations`).Scan(&version, &dirty); err != nil || version != 1 || dirty {
		t.Fatalf("unexpected migration version %d dirty=%v: %v", version, dirty, err)
	}
}
