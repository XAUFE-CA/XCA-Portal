//go:build integration

package migrations_test

import (
	"context"
	"crypto/sha256"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/session"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/testdb"
	"github.com/XAUFE-CA/XCA-Portal/backend/migrations"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
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

func assertMigrationVersion(t *testing.T, conn *pgx.Conn, want int) {
	t.Helper()
	var version int
	var dirty bool
	if err := conn.QueryRow(context.Background(), `SELECT version, dirty FROM schema_migrations`).Scan(&version, &dirty); err != nil || version != want || dirty {
		t.Fatalf("migration version=%d dirty=%v, want clean version %d: %v", version, dirty, want, err)
	}
}

func assertAuthTables(t *testing.T, conn *pgx.Conn, wantLegacy, wantPasskey int) {
	t.Helper()
	var legacy, passkey int
	err := conn.QueryRow(context.Background(), `SELECT
		count(*) FILTER (WHERE table_name IN ('users', 'invitations', 'email_challenges', 'sessions', 'auth_rate_limits', 'auth_operations')),
		count(*) FILTER (WHERE table_name IN ('passkey_credentials', 'passkey_challenges', 'passkey_operation_effects'))
		FROM information_schema.tables WHERE table_schema = current_schema()`).Scan(&legacy, &passkey)
	if err != nil || legacy != wantLegacy || passkey != wantPasskey {
		t.Fatalf("legacy/passkey tables = %d/%d, want %d/%d: %v", legacy, passkey, wantLegacy, wantPasskey, err)
	}
}

func TestMigrationUpDown(t *testing.T) {
	dsn := testdb.New(t)
	for i := range 2 {
		if err := migrations.Up(dsn); err != nil {
			t.Fatalf("up %d: %v", i, err)
		}
	}
	conn := connect(t, dsn)
	assertMigrationVersion(t, conn, 2)
	assertAuthTables(t, conn, 6, 3)
	if err := migrations.Down(dsn); err != nil {
		t.Fatalf("down: %v", err)
	}
	assertMigrationVersion(t, conn, 1)
	assertAuthTables(t, conn, 6, 0)
	if err := migrations.Down(dsn); err != nil {
		t.Fatalf("repeated down: %v", err)
	}
	assertAuthTables(t, conn, 0, 0)
	if err := migrations.Up(dsn); err != nil {
		t.Fatalf("up after down: %v", err)
	}
	assertMigrationVersion(t, conn, 2)
	assertAuthTables(t, conn, 6, 3)
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

func TestUnknownMigrationVersionReportsCause(t *testing.T) {
	dsn := testdb.New(t)
	if err := migrations.Up(dsn); err != nil {
		t.Fatal(err)
	}
	conn := connect(t, dsn)
	// A squashed migration leaves databases pointing at a version no file provides.
	// 压平的迁移会让数据库记录的版本不再对应任何文件。
	if _, err := conn.Exec(context.Background(), `UPDATE schema_migrations SET version = 99`); err != nil {
		t.Fatal(err)
	}
	err := migrations.Up(dsn)
	if err == nil {
		t.Fatal("expected migration failure")
	}
	if !strings.Contains(err.Error(), "inspect database state before retrying") ||
		!strings.Contains(err.Error(), "no migration found for version 99") {
		t.Fatalf("failure must keep the fixed hint and the cause, got %v", err)
	}
	if strings.Contains(err.Error(), dsn) {
		t.Fatalf("failure must not print the connection string: %v", err)
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
	assertMigrationVersion(t, conn, 2)
}

func TestPasskeyMigrationPreservesLegacySessionsAndFences(t *testing.T) {
	dsn := testdb.New(t)
	if err := migrations.Up(dsn); err != nil {
		t.Fatal(err)
	}
	if err := migrations.Down(dsn); err != nil {
		t.Fatal(err)
	}
	conn := connect(t, dsn)
	assertMigrationVersion(t, conn, 1)
	ctx := context.Background()
	token := strings.Repeat("A", 43)
	digest := sha256.Sum256([]byte(token))
	const verifyID = "39000000-0000-4000-8000-000000000001"
	const manageID = "39000000-0000-4000-8000-000000000002"
	var sessionID string
	err := conn.QueryRow(ctx, `WITH account AS (
		INSERT INTO users (email, login_name, display_name)
		VALUES ('legacy@example.test', 'legacy', 'Legacy') RETURNING id
	)
	INSERT INTO sessions (session_digest, user_id, expires_at)
	SELECT $1, id, clock_timestamp() + interval '1 hour' FROM account RETURNING id::text`, digest[:]).Scan(&sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, `INSERT INTO auth_operations (id, kind, state, session_digest)
		VALUES ($1, 'verify', 'completed', $2)`, verifyID, digest[:]); err != nil {
		t.Fatal(err)
	}

	if err := migrations.Up(dsn); err != nil {
		t.Fatal(err)
	}
	assertMigrationVersion(t, conn, 2)
	var otpVerifiedAt *time.Time
	if err := conn.QueryRow(ctx, `SELECT otp_verified_at FROM sessions WHERE id = $1`, sessionID).
		Scan(&otpVerifiedAt); err != nil || otpVerifiedAt != nil {
		t.Fatalf("upgrading a legacy session must not grant OTP freshness: timestamp=%v err=%v", otpVerifiedAt, err)
	}
	if _, err := conn.Exec(ctx, `WITH operation AS (
		INSERT INTO auth_operations (id, kind, state)
		VALUES ($1, 'passkey_manage', 'completed') RETURNING id
	), credential AS (
		INSERT INTO passkey_credentials
			(user_id, rp_id, credential_id, public_key, sign_count, backup_eligible, backup_state, uv_initialized)
		SELECT user_id, 'localhost', decode('01', 'hex'), decode('02', 'hex'), 0, false, false, true
		FROM sessions WHERE id = $3 RETURNING id
	)
	INSERT INTO passkey_operation_effects (operation_id, actor_session_digest, credential_record_id, effect)
	SELECT operation.id, $2, credential.id, 'registration' FROM operation CROSS JOIN credential`, manageID, digest[:], sessionID); err != nil {
		t.Fatal(err)
	}
	if err := migrations.Down(dsn); err != nil {
		t.Fatal(err)
	}
	assertMigrationVersion(t, conn, 1)

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	sessions := session.NewSessions(pool, time.Hour)
	if id, err := sessions.Get(ctx, token); err != nil || id == nil || id.LoginName != "legacy" {
		t.Fatalf("legacy session did not survive upgrade and rollback: %v %v", id, err)
	}
	if err := sessions.RevokeWithOperation(ctx, token, manageID); !errors.Is(err, auth.ErrOperationAbandoned) {
		t.Fatalf("rolled-back management operation no longer fences its ID: %v", err)
	}
	if _, err := sessions.Abandon(ctx, verifyID, "", false); err != nil {
		t.Fatal(err)
	}
	if id, err := sessions.Get(ctx, token); err != nil || id != nil {
		t.Fatalf("legacy verification fence did not revoke its session: %v %v", id, err)
	}
}

func TestPasskeySchemaConstraints(t *testing.T) {
	dsn := testdb.New(t)
	if err := migrations.Up(dsn); err != nil {
		t.Fatal(err)
	}
	conn := connect(t, dsn)
	ctx := context.Background()
	const alice = "40000000-0000-4000-8000-000000000001"
	const bob = "40000000-0000-4000-8000-000000000002"
	const session = "40000000-0000-4000-8000-000000000003"
	digest := sha256.Sum256([]byte("passkey-schema-session"))
	if _, err := conn.Exec(ctx, `INSERT INTO users (id, email, login_name, display_name)
		VALUES ($1, 'alice@example.test', 'alice', 'Alice'), ($2, 'bob@example.test', 'bob', 'Bob')`, alice, bob); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, `INSERT INTO sessions (id, session_digest, user_id, expires_at)
		VALUES ($1, $2, $3, clock_timestamp() + interval '1 hour')`, session, digest[:], alice); err != nil {
		t.Fatal(err)
	}

	t.Run("user handle is opaque and unique", func(t *testing.T) {
		const setHandle = `UPDATE users SET webauthn_user_handle = $1 WHERE id = $2`
		handle := sha256.Sum256([]byte("test-handle"))
		assertPostgresCode(t, conn, "23514", setHandle, handle[:31], alice)
		if _, err := conn.Exec(ctx, setHandle, handle[:], alice); err != nil {
			t.Fatal(err)
		}
		assertPostgresCode(t, conn, "23505", setHandle, handle[:], bob)
	})
	t.Run("revocation does not free the credential ID within its RP", func(t *testing.T) {
		const insert = `INSERT INTO passkey_credentials
			(user_id, rp_id, credential_id, public_key, sign_count, backup_eligible, backup_state, uv_initialized)
			VALUES ($1, $2, $3, $4, $5, $6, $7, true)`
		key := []byte{1}
		credential := []byte{2}
		if _, err := conn.Exec(ctx, insert, alice, "portal.example.test", credential, key, int64(4294967295), true, true); err != nil {
			t.Fatal(err)
		}
		if _, err := conn.Exec(ctx, `UPDATE passkey_credentials SET revoked_at = clock_timestamp() WHERE user_id = $1`, alice); err != nil {
			t.Fatal(err)
		}
		assertPostgresCode(t, conn, "23505", insert, bob, "portal.example.test", credential, key, int64(0), false, false)
		if _, err := conn.Exec(ctx, insert, bob, "other.example.test", credential, key, int64(0), false, false); err != nil {
			t.Fatal(err)
		}
		assertPostgresCode(t, conn, "23514", insert, alice, "portal.example.test", []byte{3}, key, int64(0), false, true)
		assertPostgresCode(t, conn, "23514", insert, alice, "portal.example.test", []byte{4}, key, int64(4294967296), false, false)
		assertPostgresCode(t, conn, "23514", insert, alice, "portal.example.test", make([]byte, 1024), key, int64(0), false, false)
	})
	t.Run("challenge scope and session cleanup", func(t *testing.T) {
		const insert = `INSERT INTO passkey_challenges
			(flow_id, kind, rp_id, origin, ceremony_version, session_data, user_id, session_id, expires_at)
			VALUES ($1, $2, 'localhost', 'http://localhost:4102', 1, '{}', $3, $4,
				clock_timestamp() + interval '3 minutes')`
		registration := sha256.Sum256([]byte("registration-flow"))
		authentication := sha256.Sum256([]byte("authentication-flow"))
		assertPostgresCode(t, conn, "23514", insert, registration[:], "registration", alice, nil)
		assertPostgresCode(t, conn, "23514", insert, authentication[:], "authentication", alice, session)
		if _, err := conn.Exec(ctx, insert, registration[:], "registration", alice, session); err != nil {
			t.Fatal(err)
		}
		if _, err := conn.Exec(ctx, insert, authentication[:], "authentication", nil, nil); err != nil {
			t.Fatal(err)
		}
		if _, err := conn.Exec(ctx, `DELETE FROM sessions WHERE id = $1`, session); err != nil {
			t.Fatal(err)
		}
		var flowID []byte
		if err := conn.QueryRow(ctx, `SELECT flow_id FROM passkey_challenges`).Scan(&flowID); err != nil || string(flowID) != string(authentication[:]) {
			t.Fatalf("session removal must leave only the unrelated authentication challenge: %x %v", flowID, err)
		}
	})
	t.Run("management operation cannot issue a session", func(t *testing.T) {
		assertPostgresCode(t, conn, "23514", `INSERT INTO auth_operations (id, kind, state, session_digest)
			VALUES ('fa000000-0000-4000-8000-000000000001', 'passkey_manage', 'completed', $1)`, digest[:])
	})
}

func assertPostgresCode(t *testing.T, conn *pgx.Conn, code, query string, args ...any) {
	t.Helper()
	var pgErr *pgconn.PgError
	if _, err := conn.Exec(context.Background(), query, args...); !errors.As(err, &pgErr) || pgErr.Code != code {
		t.Fatalf("expected PostgreSQL error %s, got %v", code, err)
	}
}
