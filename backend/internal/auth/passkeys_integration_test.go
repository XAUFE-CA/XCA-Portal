//go:build integration

package auth

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/config"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/testdb"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/testpasskey"
	"github.com/XAUFE-CA/XCA-Portal/backend/migrations"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const passkeyTestOrigin = "http://localhost:4100"
const passkeyTestRP = "localhost"

type passkeyFixture struct {
	ctx   context.Context
	pool  *pgxpool.Pool
	keys  *Passkeys
	fence *Sessions
}

func setupPasskeys(t *testing.T) passkeyFixture {
	t.Helper()
	dsn := testdb.New(t)
	if err := migrations.Up(dsn); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	t.Cleanup(cancel)
	poolConfig, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	poolConfig.MaxConns = 8
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	keys, err := NewPasskeys(pool, config.Config{
		Environment: "test", PublicOrigin: passkeyTestOrigin,
		Passkeys: config.PasskeyConfig{Enabled: true, RPID: passkeyTestRP, RPName: "XCA test", RecentOTP: 5 * time.Minute},
	})
	if err != nil || keys == nil {
		t.Fatalf("enabled passkey service: %v", err)
	}
	return passkeyFixture{ctx, pool, keys, NewSessions(pool, time.Hour)}
}

func (f passkeyFixture) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, sql, args...); err != nil {
		t.Fatal(err)
	}
}

func (f passkeyFixture) account(t *testing.T) (string, string) {
	t.Helper()
	var id string
	name := "passkey-" + hex.EncodeToString(passkeyRandom(t, 8))
	if err := f.pool.QueryRow(f.ctx, `INSERT INTO users (email, login_name, display_name)
		VALUES ($1, $2, 'Test User') RETURNING id::text`, name+"@example.invalid", name).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id, f.session(t, id)
}

func (f passkeyFixture) session(t *testing.T, user string) string {
	t.Helper()
	token := base64.RawURLEncoding.EncodeToString(passkeyRandom(t, 32))
	digest := sha256.Sum256([]byte(token))
	f.exec(t, `INSERT INTO sessions (user_id, session_digest, expires_at, otp_verified_at)
		VALUES ($1, $2, clock_timestamp() + interval '1 hour', clock_timestamp())`, user, digest[:])
	return token
}

func passkeyRandom(t *testing.T, size int) []byte {
	t.Helper()
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		t.Fatal(err)
	}
	return value
}

func (f passkeyFixture) operation(t *testing.T) string {
	t.Helper()
	var id string
	if err := f.pool.QueryRow(f.ctx, `SELECT gen_random_uuid()::text`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func (f passkeyFixture) options(t *testing.T, token string) *PasskeyOptions {
	t.Helper()
	options, err := f.keys.Options(f.ctx, token)
	if err != nil || options == nil {
		t.Fatalf("registration options: %v", err)
	}
	return options
}

func registrationResponse(t *testing.T, options *PasskeyOptions, id []byte) *protocol.CredentialCreationResponse {
	t.Helper()
	return testpasskey.Response(t, options.PublicKey.Challenge.String(), passkeyTestRP, passkeyTestOrigin, id)
}

func (f passkeyFixture) register(t *testing.T, token string, id []byte) PasskeySummary {
	t.Helper()
	options := f.options(t, token)
	result, err := f.keys.Verify(f.ctx, token, options.FlowID, f.operation(t), registrationResponse(t, options, id))
	passkeyError(t, err, nil)
	if result.ID == "" || result.CreatedAt.IsZero() || result.Label != nil || result.LastUsedAt != nil {
		t.Fatalf("unexpected registration summary: %+v", result)
	}
	return result
}

func passkeyError(t *testing.T, got, want error) {
	t.Helper()
	if !errors.Is(got, want) {
		t.Fatalf("error = %v, want %v", got, want)
	}
}

func (f passkeyFixture) active(t *testing.T, token string, ids ...string) {
	t.Helper()
	list, err := f.keys.List(f.ctx, token)
	passkeyError(t, err, nil)
	if len(list) != len(ids) {
		t.Fatalf("active credentials = %d, want %d", len(list), len(ids))
	}
	for _, id := range ids {
		found := false
		for _, item := range list {
			found = found || item.ID == id
		}
		if !found {
			t.Fatalf("active list omitted %s", id)
		}
	}
}

func passkeyHandle(t *testing.T, options *PasskeyOptions) []byte {
	t.Helper()
	wire, err := json.Marshal(options.PublicKey.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	var encoded string
	if err := json.Unmarshal(wire, &encoded); err != nil {
		t.Fatal(err)
	}
	handle, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(handle) != 32 {
		t.Fatalf("user handle is not 32 base64url bytes: %v", err)
	}
	return handle
}

func TestPasskeyBindingAndExclusion(t *testing.T) {
	f := setupPasskeys(t)
	user, token := f.account(t)
	otherSession := f.session(t, user)
	_, otherUser := f.account(t)
	start := make(chan struct{})
	type result struct {
		options *PasskeyOptions
		err     error
	}
	results := make(chan result, 2)
	for _, actor := range []string{token, otherSession} {
		go func() {
			<-start
			options, err := f.keys.Options(f.ctx, actor)
			results <- result{options, err}
		}()
	}
	close(start)
	first, second := <-results, <-results
	passkeyError(t, first.err, nil)
	passkeyError(t, second.err, nil)
	handle := passkeyHandle(t, first.options)
	if !bytes.Equal(handle, passkeyHandle(t, second.options)) || bytes.Equal(handle, passkeyHandle(t, f.options(t, otherUser))) {
		t.Fatal("concurrent first use did not assign one distinct handle per account")
	}
	if first.options.FlowID == second.options.FlowID || bytes.Equal(first.options.PublicKey.Challenge, second.options.PublicKey.Challenge) {
		t.Fatal("separate registration ceremonies reused flow or challenge")
	}
	if len(first.options.PublicKey.CredentialExcludeList) != 0 || len(second.options.PublicKey.CredentialExcludeList) != 0 {
		t.Fatal("new account has excluded credentials")
	}
	f.exec(t, `UPDATE users SET login_name='renamed', display_name='Renamed', email='renamed@example.invalid' WHERE id=$1`, user)
	if !bytes.Equal(handle, passkeyHandle(t, f.options(t, token))) {
		t.Fatal("renaming account changed its opaque handle")
	}
	firstID, secondID := []byte("credential-one"), []byte("credential-two")
	registration := f.options(t, token)
	response := testpasskey.ResponseWith(t, registration.PublicKey.Challenge.String(), passkeyTestRP, passkeyTestOrigin, firstID,
		testpasskey.Options{AddFlags: protocol.FlagBackupEligible | protocol.FlagBackupState, SignCount: 4294967294})
	one, err := f.keys.Verify(f.ctx, token, registration.FlowID, f.operation(t), response)
	passkeyError(t, err, nil)
	if !one.BackupEligible || !one.BackupState {
		t.Fatal("registration summary omitted authenticator backup flags")
	}
	parsed, err := response.Parse()
	if err != nil {
		t.Fatal(err)
	}
	var storedID, storedKey []byte
	var signCount int64
	var uv bool
	if err := f.pool.QueryRow(f.ctx, `SELECT credential_id, public_key, sign_count, uv_initialized
		FROM passkey_credentials WHERE id = $1`, one.ID).Scan(&storedID, &storedKey, &signCount, &uv); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(storedID, firstID) || !bytes.Equal(storedKey, parsed.Response.AttestationObject.AuthData.AttData.CredentialPublicKey) ||
		signCount != 4294967294 || !uv || one.Label != nil || one.LastUsedAt != nil {
		t.Fatal("stored credential is missing authenticator data or has unassigned public values")
	}
	two := f.register(t, otherSession, secondID)
	f.active(t, token, one.ID, two.ID)
	f.active(t, otherUser)
	passkeyError(t, f.keys.Revoke(f.ctx, token, one.ID, f.operation(t)), nil)
	f.active(t, token, two.ID)
	exclusions := f.options(t, token).PublicKey.CredentialExcludeList
	if len(exclusions) != 2 {
		t.Fatalf("exclusions = %d, want active and revoked IDs", len(exclusions))
	}
	seen := make(map[string]bool)
	for _, descriptor := range exclusions {
		seen[string(descriptor.CredentialID)] = true
	}
	if !seen[string(firstID)] || !seen[string(secondID)] || len(f.options(t, otherUser).PublicKey.CredentialExcludeList) != 0 {
		t.Fatal("exclusions do not match the account's active and revoked credentials")
	}
}

func TestPasskeyChallengeBindingAndLifetime(t *testing.T) {
	f := setupPasskeys(t)
	user, token := f.account(t)
	sameUser := f.session(t, user)
	_, otherUser := f.account(t)
	options := f.options(t, token)
	response := registrationResponse(t, options, []byte("bound-credential"))
	for _, wrongSession := range []string{sameUser, otherUser} {
		_, err := f.keys.Verify(f.ctx, wrongSession, options.FlowID, f.operation(t), response)
		passkeyError(t, err, ErrPasskeyInvalidRegistration)
	}
	created, err := f.keys.Verify(f.ctx, token, options.FlowID, f.operation(t), response)
	passkeyError(t, err, nil)
	_, err = f.keys.Verify(f.ctx, token, options.FlowID, f.operation(t), response)
	passkeyError(t, err, ErrPasskeyInvalidRegistration)

	options = f.options(t, token)
	flow, err := base64.RawURLEncoding.DecodeString(options.FlowID)
	passkeyError(t, err, nil)
	var ttlSeconds float64
	if err := f.pool.QueryRow(f.ctx, `SELECT extract(epoch FROM expires_at - created_at)::float8
		FROM passkey_challenges WHERE flow_id=$1`, flow).Scan(&ttlSeconds); err != nil {
		t.Fatal(err)
	}
	if ttlSeconds != 120 {
		t.Fatalf("registration challenge lifetime = %v seconds, want 120", ttlSeconds)
	}
	f.exec(t, `UPDATE passkey_challenges SET created_at=statement_timestamp()-interval '2 minutes',
		expires_at=statement_timestamp() WHERE flow_id=$1`, flow)
	_, err = f.keys.Verify(f.ctx, token, options.FlowID, f.operation(t), registrationResponse(t, options, []byte("expired-credential")))
	passkeyError(t, err, ErrPasskeyInvalidRegistration)
	f.active(t, token, created.ID)
	f.active(t, otherUser)
}

func TestPasskeySessionAndRecentOTP(t *testing.T) {
	f := setupPasskeys(t)
	user, token := f.account(t)
	key := f.register(t, token, []byte("recent-otp"))
	digest := sha256.Sum256([]byte(token))
	options := f.options(t, token)
	response := registrationResponse(t, options, []byte("second-otp"))
	for _, tc := range []struct {
		name, sql string
	}{
		{"null", "NULL"},
		{"aged", "statement_timestamp() - interval '6 minutes'"},
		{"past outer boundary", "statement_timestamp() - interval '5 minutes'"},
		{"future", "statement_timestamp() + interval '1 minute'"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f.exec(t, `UPDATE sessions SET otp_verified_at=`+tc.sql+` WHERE session_digest=$1`, digest[:])
			_, err := f.keys.Options(f.ctx, token)
			passkeyError(t, err, ErrPasskeyRecentOTP)
			_, err = f.keys.Verify(f.ctx, token, options.FlowID, f.operation(t), response)
			passkeyError(t, err, ErrPasskeyRecentOTP)
			passkeyError(t, f.keys.Revoke(f.ctx, token, key.ID, f.operation(t)), ErrPasskeyRecentOTP)
			f.active(t, token, key.ID)
		})
	}
	f.exec(t, `UPDATE sessions SET otp_verified_at=statement_timestamp()-interval '295 seconds' WHERE session_digest=$1`, digest[:])
	_ = f.options(t, token)
	f.exec(t, `UPDATE users SET status='disabled' WHERE id=$1`, user)
	_, err := f.keys.Options(f.ctx, token)
	passkeyError(t, err, ErrPasskeyUnauthenticated)
	_, err = f.keys.Verify(f.ctx, token, options.FlowID, f.operation(t), response)
	passkeyError(t, err, ErrPasskeyUnauthenticated)
	_, err = f.keys.List(f.ctx, token)
	passkeyError(t, err, ErrPasskeyUnauthenticated)
	passkeyError(t, f.keys.Revoke(f.ctx, token, key.ID, f.operation(t)), ErrPasskeyUnauthenticated)

	f.exec(t, `UPDATE users SET status='active' WHERE id=$1`, user)
	f.exec(t, `UPDATE sessions SET created_at=statement_timestamp()-interval '1 hour',
		expires_at=statement_timestamp() WHERE session_digest=$1`, digest[:])
	_, err = f.keys.List(f.ctx, token)
	passkeyError(t, err, ErrPasskeyUnauthenticated)
	f.exec(t, `UPDATE sessions SET expires_at=statement_timestamp()+interval '1 hour',
		revoked_at=statement_timestamp() WHERE session_digest=$1`, digest[:])
	_, err = f.keys.List(f.ctx, token)
	passkeyError(t, err, ErrPasskeyUnauthenticated)
	_, err = f.keys.List(f.ctx, base64.RawURLEncoding.EncodeToString(passkeyRandom(t, 32)))
	passkeyError(t, err, ErrPasskeyUnauthenticated)
}

func passkeyRace(t *testing.T, first, second func() error, loser error) {
	t.Helper()
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, worker := range []func() error{first, second} {
		go func() {
			<-start
			results <- worker()
		}()
	}
	close(start)
	a, b := <-results, <-results
	if !(a == nil && errors.Is(b, loser) || b == nil && errors.Is(a, loser)) {
		t.Fatalf("race errors = %v, %v; want one success and %v", a, b, loser)
	}
}

func TestPasskeyDuplicateCredentialOwnership(t *testing.T) {
	f := setupPasskeys(t)
	_, first := f.account(t)
	_, second := f.account(t)
	duplicate := []byte("never-reassign-this-id")
	bound := f.register(t, first, duplicate)
	attempt := func(token string) error {
		options := f.options(t, token)
		_, err := f.keys.Verify(f.ctx, token, options.FlowID, f.operation(t), registrationResponse(t, options, duplicate))
		return err
	}
	for _, token := range []string{first, second} {
		passkeyError(t, attempt(token), ErrPasskeyDuplicate)
	}
	passkeyError(t, f.keys.Revoke(f.ctx, first, bound.ID, f.operation(t)), nil)
	for _, token := range []string{first, second} {
		passkeyError(t, attempt(token), ErrPasskeyDuplicate)
	}
	f.active(t, first)
	f.active(t, second)

	for _, actors := range [][2]string{{first, first}, {first, second}} {
		id := passkeyRandom(t, 32)
		worker := func(token string) func() error {
			options := f.options(t, token)
			op := f.operation(t)
			response := registrationResponse(t, options, id)
			return func() error {
				_, err := f.keys.Verify(f.ctx, token, options.FlowID, op, response)
				return err
			}
		}
		passkeyRace(t, worker(actors[0]), worker(actors[1]), ErrPasskeyDuplicate)
	}
	one, err := f.keys.List(f.ctx, first)
	passkeyError(t, err, nil)
	two, err := f.keys.List(f.ctx, second)
	passkeyError(t, err, nil)
	if len(one)+len(two) != 2 || len(one) < 1 {
		t.Fatal("duplicate races did not persist exactly one credential per ID")
	}
}

func TestPasskeyConcurrentRevokeAndLostResponse(t *testing.T) {
	f := setupPasskeys(t)
	user, owner := f.account(t)
	sameUser := f.session(t, user)
	_, other := f.account(t)
	key := f.register(t, owner, []byte("revoke-credential"))
	passkeyError(t, f.keys.Revoke(f.ctx, other, key.ID, f.operation(t)), ErrPasskeyNotFound)
	f.active(t, owner, key.ID)
	firstOp, secondOp := f.operation(t), f.operation(t)
	passkeyRace(t, func() error { return f.keys.Revoke(f.ctx, owner, key.ID, firstOp) },
		func() error { return f.keys.Revoke(f.ctx, sameUser, key.ID, secondOp) }, ErrPasskeyNotFound)
	f.active(t, owner)

	key = f.register(t, owner, []byte("revoke-lost-response"))
	op := f.operation(t)
	blocked := f.operation(t)
	f.abandon(t, blocked, owner, "")
	passkeyError(t, f.keys.Revoke(f.ctx, owner, key.ID, blocked), ErrOperationAbandoned)
	f.active(t, owner, key.ID)
	passkeyError(t, f.keys.Revoke(f.ctx, owner, key.ID, op), nil)
	_, err := f.fence.Abandon(f.ctx, op, sameUser, true)
	passkeyError(t, err, ErrPasskeyNotFound)
	_, err = f.fence.Abandon(f.ctx, op, owner, false)
	passkeyError(t, err, ErrPasskeyNotFound)
	f.abandon(t, op, owner, "revocation_committed")
	f.abandon(t, op, owner, "revocation_committed")
	f.active(t, owner)
}

func (f passkeyFixture) abandon(t *testing.T, operation, token, want string) {
	t.Helper()
	outcome, err := f.fence.Abandon(f.ctx, operation, token, true)
	passkeyError(t, err, nil)
	if outcome != want {
		t.Fatalf("abandon outcome = %q, want %q", outcome, want)
	}
}

func TestPasskeyForcedRollback(t *testing.T) {
	f := setupPasskeys(t)
	_, token := f.account(t)
	options := f.options(t, token)
	response := registrationResponse(t, options, []byte("rollback-credential"))
	op := f.operation(t)
	f.exec(t, `CREATE FUNCTION fail_passkey_effect() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN RAISE EXCEPTION 'forced test rollback'; END; $$`)
	f.exec(t, `CREATE TRIGGER fail_passkey_effect BEFORE INSERT ON passkey_operation_effects
		FOR EACH ROW EXECUTE FUNCTION fail_passkey_effect()`)
	_, err := f.keys.Verify(f.ctx, token, options.FlowID, op, response)
	passkeyError(t, err, ErrUnavailable)
	f.active(t, token)
	f.exec(t, `DROP TRIGGER fail_passkey_effect ON passkey_operation_effects`)
	key, err := f.keys.Verify(f.ctx, token, options.FlowID, op, response)
	passkeyError(t, err, nil)
	f.active(t, token, key.ID)

	revoke := f.operation(t)
	f.exec(t, `CREATE TRIGGER fail_passkey_effect BEFORE INSERT ON passkey_operation_effects
		FOR EACH ROW EXECUTE FUNCTION fail_passkey_effect()`)
	passkeyError(t, f.keys.Revoke(f.ctx, token, key.ID, revoke), ErrUnavailable)
	f.active(t, token, key.ID)
	f.exec(t, `DROP TRIGGER fail_passkey_effect ON passkey_operation_effects`)
	passkeyError(t, f.keys.Revoke(f.ctx, token, key.ID, revoke), nil)
	f.active(t, token)
}

func TestPasskeyRegistrationBarrierBeforeAndAfterCommit(t *testing.T) {
	f := setupPasskeys(t)
	user, token := f.account(t)
	otherSession := f.session(t, user)
	options := f.options(t, token)
	blocked, complete := f.operation(t), f.operation(t)
	response := registrationResponse(t, options, []byte("barrier-credential"))
	f.abandon(t, blocked, token, "")
	_, err := f.keys.Verify(f.ctx, token, options.FlowID, blocked, response)
	passkeyError(t, err, ErrOperationAbandoned)
	f.active(t, token)
	key, err := f.keys.Verify(f.ctx, token, options.FlowID, complete, response)
	passkeyError(t, err, nil)
	f.active(t, token, key.ID)
	_, err = f.fence.Abandon(f.ctx, complete, otherSession, true)
	passkeyError(t, err, ErrPasskeyNotFound)
	_, err = f.fence.Abandon(f.ctx, complete, token, false)
	passkeyError(t, err, ErrPasskeyNotFound)
	f.active(t, token, key.ID)
	f.abandon(t, complete, token, "registration_revoked")
	f.abandon(t, complete, token, "registration_revoked")
	f.active(t, token)
	if list := f.options(t, token).PublicKey.CredentialExcludeList; len(list) != 1 || !bytes.Equal(list[0].CredentialID, response.RawID) {
		t.Fatal("compensated registration is not retained as a revoked exclusion")
	}
}

func (f passkeyFixture) lockCredentialWrites(t *testing.T) (pgx.Tx, int32) {
	t.Helper()
	tx, err := f.pool.Begin(f.ctx)
	passkeyError(t, err, nil)
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	var pid int32
	if err := tx.QueryRow(f.ctx, `SELECT pg_backend_pid()`).Scan(&pid); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(f.ctx, `LOCK TABLE passkey_credentials IN SHARE MODE`); err != nil {
		t.Fatal(err)
	}
	return tx, pid
}

func (f passkeyFixture) blockedBy(t *testing.T, blocker int32) int32 {
	t.Helper()
	ctx, cancel := context.WithTimeout(f.ctx, 5*time.Second)
	defer cancel()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var pid int32
		err := f.pool.QueryRow(ctx, `SELECT pid FROM pg_stat_activity
			WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)) LIMIT 1`, blocker).Scan(&pid)
		if err == nil {
			return pid
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("waiting for PostgreSQL blocker %d: %v", blocker, err)
		}
		select {
		case <-ctx.Done():
			t.Fatalf("no PostgreSQL request blocked by PID %d: %v", blocker, ctx.Err())
		case <-ticker.C:
		}
	}
}

func TestPasskeyRegistrationBarrierDuringWrite(t *testing.T) {
	for _, tc := range []struct {
		name   string
		cancel bool
	}{{"commit then compensate", false}, {"request canceled before commit", true}} {
		t.Run(tc.name, func(t *testing.T) {
			f := setupPasskeys(t)
			_, token := f.account(t)
			op := f.operation(t)
			options := f.options(t, token)
			response := registrationResponse(t, options, []byte("in-flight-credential"))
			lock, pid := f.lockCredentialWrites(t)
			request, cancel := context.WithCancel(f.ctx)
			defer cancel()
			verified := make(chan error, 1)
			go func() {
				_, err := f.keys.Verify(request, token, options.FlowID, op, response)
				verified <- err
			}()
			writer := f.blockedBy(t, pid)
			type outcome struct {
				value string
				err   error
			}
			barrier := make(chan outcome, 1)
			go func() {
				value, err := f.fence.Abandon(f.ctx, op, token, true)
				barrier <- outcome{value, err}
			}()
			f.blockedBy(t, writer)
			want := "registration_revoked"
			if tc.cancel {
				cancel()
				want = ""
				if err := <-verified; !errors.Is(err, ErrUnavailable) && !errors.Is(err, context.Canceled) {
					t.Fatalf("canceled registration error = %v", err)
				}
			}
			passkeyError(t, lock.Commit(f.ctx), nil)
			if !tc.cancel {
				passkeyError(t, <-verified, nil)
			}
			got := <-barrier
			passkeyError(t, got.err, nil)
			if got.value != want {
				t.Fatalf("in-flight abandon = %q, want %q", got.value, want)
			}
			f.active(t, token)
			_, err := f.keys.Verify(f.ctx, token, options.FlowID, op, response)
			passkeyError(t, err, ErrOperationAbandoned)
			if tc.cancel {
				key, err := f.keys.Verify(f.ctx, token, options.FlowID, f.operation(t), response)
				passkeyError(t, err, nil)
				f.active(t, token, key.ID)
			}
		})
	}
}

func TestPasskeyOTPExpiresWhileRegistrationWaits(t *testing.T) {
	f := setupPasskeys(t)
	_, token := f.account(t)
	options := f.options(t, token)
	response := registrationResponse(t, options, []byte("otp-expires-during-write"))
	digest := sha256.Sum256([]byte(token))
	var expiry time.Time
	if err := f.pool.QueryRow(f.ctx, `UPDATE sessions SET otp_verified_at = clock_timestamp() - interval '296 seconds'
		WHERE session_digest = $1 RETURNING otp_verified_at + interval '5 minutes'`, digest[:]).Scan(&expiry); err != nil {
		t.Fatal(err)
	}
	op := f.operation(t)
	lock, pid := f.lockCredentialWrites(t)
	done := make(chan error, 1)
	go func() {
		_, err := f.keys.Verify(f.ctx, token, options.FlowID, op, response)
		done <- err
	}()
	f.blockedBy(t, pid)
	f.exec(t, `SELECT pg_sleep_until($1)`, expiry)
	passkeyError(t, lock.Commit(f.ctx), nil)
	passkeyError(t, <-done, ErrPasskeyRecentOTP)
	f.active(t, token)

	f.exec(t, `UPDATE sessions SET otp_verified_at = clock_timestamp() WHERE session_digest = $1`, digest[:])
	item, err := f.keys.Verify(f.ctx, token, options.FlowID, op, response)
	passkeyError(t, err, nil)
	f.active(t, token, item.ID)
}

func TestPasskeyDatabaseUnavailable(t *testing.T) {
	f := setupPasskeys(t)
	_, token := f.account(t)
	key := f.register(t, token, []byte("unavailable-credential"))
	options := f.options(t, token)
	response := registrationResponse(t, options, []byte("unavailable-registration"))
	verifyOp, revokeOp := f.operation(t), f.operation(t)
	f.pool.Close()
	_, err := f.keys.Options(f.ctx, token)
	passkeyError(t, err, ErrUnavailable)
	_, err = f.keys.Verify(f.ctx, token, options.FlowID, verifyOp, response)
	passkeyError(t, err, ErrUnavailable)
	_, err = f.keys.List(f.ctx, token)
	passkeyError(t, err, ErrUnavailable)
	passkeyError(t, f.keys.Revoke(f.ctx, token, key.ID, revokeOp), ErrUnavailable)
	_, err = f.fence.Abandon(f.ctx, revokeOp, token, true)
	passkeyError(t, err, ErrUnavailable)
}
