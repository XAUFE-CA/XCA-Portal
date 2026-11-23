//go:build integration

package passkey

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/netip"
	"testing"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/ratelimit"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/config"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/testpasskey"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type passkeyLoginFixture struct {
	passkeyFixture
	login *Passkeys
	cfg   config.Config
}

func setupPasskeyLogin(t *testing.T) passkeyLoginFixture {
	t.Helper()
	f := setupPasskeys(t)
	cfg := config.Config{
		Environment: "test", PublicOrigin: passkeyTestOrigin, SessionTTL: time.Hour,
		RateLimitHMACKey: passkeyRandom(t, 32),
		Passkeys: config.PasskeyConfig{
			AuthenticationEnabled: true, RPID: passkeyTestRP, RPName: "XCA test",
		},
	}
	login, err := NewPasskeys(f.pool, cfg)
	passkeyError(t, err, nil)
	if !login.AuthenticationEnabled() || login.ManagementEnabled() {
		t.Fatal("authentication and management must be independently enabled")
	}
	return passkeyLoginFixture{f, login, cfg}
}

func (f passkeyLoginFixture) anotherInstance(t *testing.T) (*Passkeys, *pgxpool.Pool) {
	t.Helper()
	pool, err := pgxpool.NewWithConfig(f.ctx, f.pool.Config())
	passkeyError(t, err, nil)
	t.Cleanup(pool.Close)
	keys, err := NewPasskeys(pool, f.cfg)
	passkeyError(t, err, nil)
	return keys, pool
}

func loginSource(n byte) netip.Addr {
	return netip.AddrFrom4([4]byte{192, 0, 2, n})
}

func (f passkeyLoginFixture) loginOptions(t *testing.T, source netip.Addr) *PasskeyAuthenticationOptions {
	t.Helper()
	options, err := f.login.AuthenticationOptions(f.ctx, source)
	passkeyError(t, err, nil)
	if options == nil {
		t.Fatal("successful login options omitted the request options")
	}
	return options
}

type loginCredential struct {
	device     *testpasskey.Authenticator
	id, handle []byte
	recordID   string
}

func (f passkeyLoginFixture) registerLogin(t *testing.T, otpSession string, options testpasskey.Options) loginCredential {
	t.Helper()
	registration := f.options(t, otpSession)
	device, id := testpasskey.NewAuthenticator(t), passkeyRandom(t, 32)
	response := device.Registration(t, registration.PublicKey.Challenge.String(), passkeyTestRP, passkeyTestOrigin, id, options)
	item, err := f.keys.Verify(f.ctx, otpSession, registration.FlowID, f.operation(t), response)
	passkeyError(t, err, nil)
	return loginCredential{device, id, passkeyHandle(t, registration), item.ID}
}

func (c loginCredential) assertion(t *testing.T, options *PasskeyAuthenticationOptions, flags testpasskey.AssertionOptions) *protocol.CredentialAssertionResponse {
	t.Helper()
	return c.device.Assertion(t, options.PublicKey.Challenge.String(), passkeyTestRP, passkeyTestOrigin, c.id, c.handle, flags)
}

type passkeyLoginResult struct {
	token    string
	identity auth.Identity
	err      error
}

func (r passkeyLoginResult) requireError(t *testing.T, want error) {
	t.Helper()
	passkeyError(t, r.err, want)
	r.requireNoIdentity(t)
}

func (r passkeyLoginResult) requireNoIdentity(t *testing.T) {
	t.Helper()
	if r.token != "" || r.identity != (auth.Identity{}) {
		t.Fatal("failed authentication returned session or account data")
	}
}

func (f passkeyLoginFixture) submit(t *testing.T, source netip.Addr, flow string, response *protocol.CredentialAssertionResponse) passkeyLoginResult {
	t.Helper()
	return verifyPasskeyLogin(f.ctx, f.login, source, flow, f.operation(t), response)
}

func verifyPasskeyLogin(ctx context.Context, keys *Passkeys, source netip.Addr, flow, operation string, response *protocol.CredentialAssertionResponse) passkeyLoginResult {
	token, identity, err := keys.VerifyAuthentication(ctx, source, flow, operation, response)
	return passkeyLoginResult{token, identity, err}
}

func (f passkeyLoginFixture) requireSession(t *testing.T, result passkeyLoginResult, userID string) {
	t.Helper()
	passkeyError(t, result.err, nil)
	session, err := f.fence.Get(f.ctx, result.token)
	passkeyError(t, err, nil)
	if session == nil || result.identity.UserID != userID || *session != result.identity {
		t.Fatalf("Session identity = %+v, verification identity = %+v, want user %s", session, result.identity, userID)
	}
}

func (f passkeyLoginFixture) loginCount(t *testing.T, query string, args ...any) int {
	t.Helper()
	var count int
	passkeyError(t, f.pool.QueryRow(f.ctx, query, args...).Scan(&count), nil)
	return count
}

type passkeyLoginState struct {
	counter                   uint32
	eligible, backedUp, uvSet bool
	lastUse                   time.Time
}

func (f passkeyLoginFixture) loginState(t *testing.T, credential loginCredential) passkeyLoginState {
	t.Helper()
	var state passkeyLoginState
	err := f.pool.QueryRow(f.ctx, `SELECT sign_count, backup_eligible, backup_state, uv_initialized, COALESCE(last_used_at, 'epoch')
		FROM passkey_credentials WHERE id = $1`, credential.recordID).Scan(
		&state.counter, &state.eligible, &state.backedUp, &state.uvSet, &state.lastUse)
	passkeyError(t, err, nil)
	state.lastUse = state.lastUse.UTC()
	return state
}

func TestPasskeyAuthenticationIssuesAnOrdinarySessionWithoutOTP(t *testing.T) {
	f := setupPasskeyLogin(t)
	source := loginSource(1)
	options := f.loginOptions(t, source)
	wire, err := json.Marshal(options.PublicKey)
	passkeyError(t, err, nil)
	var fields map[string]json.RawMessage
	passkeyError(t, json.Unmarshal(wire, &fields), nil)
	flow, err := base64.RawURLEncoding.Strict().DecodeString(options.FlowID)
	passkeyError(t, err, nil)
	if _, sent := fields["allowCredentials"]; sent || options.PublicKey.RelyingPartyID != passkeyTestRP ||
		options.PublicKey.UserVerification != protocol.VerificationRequired || len(options.PublicKey.Challenge) < 32 || len(flow) != 32 {
		t.Fatalf("options do not describe an anonymous discoverable login: %s", wire)
	}
	if count := f.loginCount(t, `SELECT count(*) FROM passkey_challenges WHERE flow_id = $1 AND kind = 'authentication'
		AND user_id IS NULL AND session_id IS NULL AND expires_at - created_at BETWEEN interval '119 seconds' AND interval '121 seconds'`, flow); count != 1 {
		t.Fatal("authentication challenge was not stored as an accountless two-minute flow")
	}
	user, otpSession := f.account(t)
	credential := f.registerLogin(t, otpSession, testpasskey.Options{})
	f.exec(t, `UPDATE users SET login_name='passkey-renamed', display_name='Renamed Test User' WHERE id=$1`, user)
	response := credential.assertion(t, options, testpasskey.AssertionOptions{SignCount: 1})
	second, _ := f.anotherInstance(t)
	result := verifyPasskeyLogin(f.ctx, second, source, options.FlowID, f.operation(t), response)
	f.requireSession(t, result, user)
	if result.identity.LoginName != "passkey-renamed" || result.identity.DisplayName != "Renamed Test User" || result.token == otpSession {
		t.Fatal("login did not issue a distinct Session for the current account identity")
	}
	digest := sha256.Sum256([]byte(result.token))
	if count := f.loginCount(t, `SELECT count(*) FROM sessions WHERE session_digest = $1 AND otp_verified_at IS NULL
		AND expires_at - created_at BETWEEN interval '3599 seconds' AND interval '3601 seconds'`, digest[:]); count != 1 {
		t.Fatal("passkey Session was not persisted with the standard TTL and absent OTP verification")
	}
	listed, err := f.keys.List(f.ctx, result.token)
	passkeyError(t, err, nil)
	if len(listed) != 1 || listed[0].ID != credential.recordID || listed[0].LastUsedAt == nil {
		t.Fatalf("ordinary Session could not list the used credential: %+v", listed)
	}
	_, err = f.keys.Options(f.ctx, result.token)
	passkeyError(t, err, ErrPasskeyRecentOTP)
	f.active(t, otpSession, credential.recordID)
	f.submit(t, source, options.FlowID, response).requireError(t, ErrPasskeyInvalidAuthentication)
}

func TestPasskeyAuthenticationRejectsInvalidCredentialsAndChallenges(t *testing.T) {
	f := setupPasskeyLogin(t)
	_, owner := f.account(t)
	active := f.registerLogin(t, owner, testpasskey.Options{})
	revoked := f.registerLogin(t, owner, testpasskey.Options{})
	passkeyError(t, f.keys.Revoke(f.ctx, owner, revoked.recordID, f.operation(t)), nil)
	disabledID, disabledSession := f.account(t)
	disabled := f.registerLogin(t, disabledSession, testpasskey.Options{})
	f.exec(t, `UPDATE users SET status = 'disabled' WHERE id = $1`, disabledID)
	otherDevice := testpasskey.NewAuthenticator(t)
	registration := f.options(t, owner)
	baseline := f.loginCount(t, `SELECT count(*) FROM sessions`)
	for i, tc := range []struct {
		name   string
		change func(*PasskeyAuthenticationOptions, *loginCredential, *string, *string, *string)
	}{
		{"unknown credential", func(_ *PasskeyAuthenticationOptions, c *loginCredential, _, _, _ *string) {
			c.id = []byte("unknown-credential")
		}},
		{"revoked credential", func(_ *PasskeyAuthenticationOptions, c *loginCredential, _, _, _ *string) { *c = revoked }},
		{"disabled account", func(_ *PasskeyAuthenticationOptions, c *loginCredential, _, _, _ *string) { *c = disabled }},
		{"another account handle", func(_ *PasskeyAuthenticationOptions, c *loginCredential, _, _, _ *string) { c.handle = disabled.handle }},
		{"missing handle", func(_ *PasskeyAuthenticationOptions, c *loginCredential, _, _, _ *string) { c.handle = nil }},
		{"short handle", func(_ *PasskeyAuthenticationOptions, c *loginCredential, _, _, _ *string) { c.handle = c.handle[:31] }},
		{"wrong public key", func(_ *PasskeyAuthenticationOptions, c *loginCredential, _, _, _ *string) { c.device = otherDevice }},
		{"wrong RP", func(_ *PasskeyAuthenticationOptions, _ *loginCredential, rp, _, _ *string) { *rp = "other.invalid" }},
		{"wrong origin", func(_ *PasskeyAuthenticationOptions, _ *loginCredential, _, origin, _ *string) {
			*origin = "http://localhost:4200"
		}},
		{"wrong challenge", func(_ *PasskeyAuthenticationOptions, _ *loginCredential, _, _, challenge *string) {
			*challenge = registration.PublicKey.Challenge.String()
		}},
		{"registration flow", func(o *PasskeyAuthenticationOptions, _ *loginCredential, _, _, challenge *string) {
			o.FlowID, *challenge = registration.FlowID, registration.PublicKey.Challenge.String()
		}},
		{"expired flow", func(o *PasskeyAuthenticationOptions, _ *loginCredential, _, _, _ *string) {
			flow, err := base64.RawURLEncoding.DecodeString(o.FlowID)
			passkeyError(t, err, nil)
			f.exec(t, `UPDATE passkey_challenges SET created_at = clock_timestamp() - interval '3 minutes',
				expires_at = clock_timestamp() - interval '1 minute' WHERE flow_id = $1`, flow)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := loginSource(byte(i + 2))
			options := f.loginOptions(t, source)
			credential := active
			rp, origin, challenge := passkeyTestRP, passkeyTestOrigin, options.PublicKey.Challenge.String()
			tc.change(options, &credential, &rp, &origin, &challenge)
			response := credential.device.Assertion(t, challenge, rp, origin, credential.id, credential.handle, testpasskey.AssertionOptions{SignCount: 1})
			f.submit(t, source, options.FlowID, response).requireError(t, ErrPasskeyInvalidAuthentication)
		})
	}
	if count := f.loginCount(t, `SELECT count(*) FROM sessions`); count != baseline {
		t.Fatal("rejected assertions created sessions")
	}
	if count := f.loginCount(t, `SELECT count(*) FROM passkey_credentials WHERE last_used_at IS NOT NULL OR sign_count <> 0`); count != 0 {
		t.Fatal("rejected assertions changed credential usage or counters")
	}
}

func TestPasskeyAuthenticationCounterAndBackupTransitions(t *testing.T) {
	f := setupPasskeyLogin(t)
	user, owner := f.account(t)
	be, bs := protocol.FlagBackupEligible, protocol.FlagBackupState
	credential := f.registerLogin(t, owner, testpasskey.Options{AddFlags: be})
	source := loginSource(1)
	initial := f.loginState(t, credential)
	if initial.counter != 0 || !initial.eligible || initial.backedUp || !initial.uvSet {
		t.Fatalf("incorrect initial registration metadata: %+v", initial)
	}
	for _, tc := range []struct {
		name        string
		counter     uint32
		flags       protocol.AuthenticatorFlags
		invalid     bool
		storedCount uint32
		backedUp    bool
	}{
		{"counterless authenticator may remain at zero", 0, be | bs, false, 0, true},
		{"increasing counter and clearing backup state", 7, be, false, 7, false},
		{"non-zero equal counter", 7, be | bs, true, 7, false},
		{"regressing counter", 6, be | bs, true, 7, false},
		{"regressing to zero", 0, be | bs, true, 7, false},
		{"backup eligibility cannot change", 8, 0, true, 7, false},
		{"invalid backup flag combination", 8, bs, true, 7, false},
		{"later valid assertion not blocked after stale counters", 8, be | bs, false, 8, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			previous := f.loginState(t, credential)
			options := f.loginOptions(t, source)
			response := credential.assertion(t, options, testpasskey.AssertionOptions{SignCount: tc.counter, AddFlags: tc.flags})
			result := f.submit(t, source, options.FlowID, response)
			if tc.invalid {
				result.requireError(t, ErrPasskeyInvalidAuthentication)
			} else {
				f.requireSession(t, result, user)
			}
			after := f.loginState(t, credential)
			if after.counter != tc.storedCount || !after.eligible || after.backedUp != tc.backedUp || !after.uvSet {
				t.Fatalf("credential metadata = %+v, want count %d and backed up %t", after, tc.storedCount, tc.backedUp)
			}
			if (tc.invalid && previous != after) || (!tc.invalid && !after.lastUse.After(previous.lastUse)) {
				t.Fatalf("incorrect last use transition from %v to %v", previous.lastUse, after.lastUse)
			}
		})
	}
}

func TestPasskeyAuthenticationRollsBackCredentialAndSessionWrites(t *testing.T) {
	f := setupPasskeyLogin(t)
	user, owner := f.account(t)
	credential := f.registerLogin(t, owner, testpasskey.Options{})
	f.exec(t, `CREATE FUNCTION fail_passkey_login_write() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN RAISE EXCEPTION 'forced test rollback'; END; $$`)
	for i, tc := range []struct{ table, event string }{{"passkey_credentials", "UPDATE"}, {"sessions", "INSERT"}} {
		t.Run(tc.table, func(t *testing.T) {
			source := loginSource(byte(i + 1))
			options := f.loginOptions(t, source)
			response := credential.assertion(t, options, testpasskey.AssertionOptions{SignCount: uint32(i + 1)})
			operation := f.operation(t)
			previous := f.loginState(t, credential)
			count := f.loginCount(t, `SELECT count(*) FROM sessions`)
			f.exec(t, `CREATE TRIGGER fail_passkey_login BEFORE `+tc.event+` ON `+tc.table+`
				FOR EACH ROW EXECUTE FUNCTION fail_passkey_login_write()`)
			result := verifyPasskeyLogin(f.ctx, f.login, source, options.FlowID, operation, response)
			result.requireError(t, auth.ErrUnavailable)
			if previous != f.loginState(t, credential) || f.loginCount(t, `SELECT count(*) FROM sessions`) != count {
				t.Fatal("a failed authentication write partially committed")
			}
			f.exec(t, `DROP TRIGGER fail_passkey_login ON `+tc.table)
			f.requireSession(t, verifyPasskeyLogin(f.ctx, f.login, source, options.FlowID, operation, response), user)
		})
	}
}

func TestPasskeyAuthenticationSerializesChallengeAndCredential(t *testing.T) {
	for _, sameFlow := range []bool{true, false} {
		name := "one credential across distinct challenges"
		if sameFlow {
			name = "one challenge submitted twice"
		}
		t.Run(name, func(t *testing.T) {
			f := setupPasskeyLogin(t)
			second, _ := f.anotherInstance(t)
			user, owner := f.account(t)
			credential := f.registerLogin(t, owner, testpasskey.Options{})
			source := loginSource(1)
			firstOptions := f.loginOptions(t, source)
			secondOptions := firstOptions
			if !sameFlow {
				secondOptions = f.loginOptions(t, source)
			}
			start, done := make(chan struct{}), make(chan passkeyLoginResult, 2)
			for _, attempt := range []struct {
				service *Passkeys
				options *PasskeyAuthenticationOptions
			}{{f.login, firstOptions}, {second, secondOptions}} {
				response := credential.assertion(t, attempt.options, testpasskey.AssertionOptions{SignCount: 1})
				op := f.operation(t)
				go func() {
					<-start
					done <- verifyPasskeyLogin(f.ctx, attempt.service, source, attempt.options.FlowID, op, response)
				}()
			}
			close(start)
			one, two := <-done, <-done
			if one.err != nil {
				one, two = two, one
			}
			f.requireSession(t, one, user)
			two.requireError(t, ErrPasskeyInvalidAuthentication)
			if count := f.loginCount(t, `SELECT count(*) FROM sessions`); count != 2 {
				t.Fatalf("race created %d login sessions, want 1", count-1)
			}
			if count := f.loginState(t, credential).counter; count != 1 {
				t.Fatalf("stored race winner counter = %d, want 1", count)
			}
		})
	}
}

func (f passkeyLoginFixture) beginBlockingLogin(t *testing.T) (pgx.Tx, int32) {
	t.Helper()
	tx, err := f.pool.Begin(f.ctx)
	passkeyError(t, err, nil)
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	var pid int32
	passkeyError(t, tx.QueryRow(f.ctx, `SELECT pg_backend_pid()`).Scan(&pid), nil)
	return tx, pid
}

func (f passkeyLoginFixture) startLogin(t *testing.T, ctx context.Context, source netip.Addr, options *PasskeyAuthenticationOptions, operation string, credential loginCredential) <-chan passkeyLoginResult {
	t.Helper()
	response := credential.assertion(t, options, testpasskey.AssertionOptions{SignCount: 1})
	done := make(chan passkeyLoginResult, 1)
	go func() { done <- verifyPasskeyLogin(ctx, f.login, source, options.FlowID, operation, response) }()
	return done
}

func TestPasskeyAuthenticationDifferentCredentialsDontBlockOnAccount(t *testing.T) {
	f := setupPasskeyLogin(t)
	user, owner := f.account(t)
	first, second := f.registerLogin(t, owner, testpasskey.Options{}), f.registerLogin(t, owner, testpasskey.Options{})
	source := loginSource(1)
	one, two := f.loginOptions(t, source), f.loginOptions(t, source)
	lock, pid := f.beginBlockingLogin(t)
	_, err := lock.Exec(f.ctx, `SELECT id FROM passkey_credentials WHERE id = $1 FOR UPDATE`, first.recordID)
	passkeyError(t, err, nil)
	blocked := f.startLogin(t, f.ctx, source, one, f.operation(t), first)
	f.blockedBy(t, pid)
	ctx, cancel := context.WithTimeout(f.ctx, 5*time.Second)
	defer cancel()
	f.requireSession(t, <-f.startLogin(t, ctx, source, two, f.operation(t), second), user)
	passkeyError(t, lock.Commit(f.ctx), nil)
	f.requireSession(t, <-blocked, user)
}

func TestPasskeyAuthenticationLockOrderWithManagement(t *testing.T) {
	for _, event := range []string{"INSERT", "UPDATE"} {
		t.Run(event, func(t *testing.T) {
			f := setupPasskeyLogin(t)
			user, owner := f.account(t)
			credential := f.registerLogin(t, owner, testpasskey.Options{})
			source := loginSource(1)
			options, registration := f.loginOptions(t, source), f.options(t, owner)
			response := registrationResponse(t, registration, passkeyRandom(t, 32))
			f.exec(t, `CREATE FUNCTION block_passkey_management() RETURNS trigger LANGUAGE plpgsql AS $$
				BEGIN PERFORM pg_advisory_xact_lock(46042); RETURN NEW; END; $$`)
			condition := ""
			if event == "UPDATE" {
				condition = `WHEN (NEW.revoked_at IS NOT NULL)`
			}
			f.exec(t, `CREATE TRIGGER block_passkey_management AFTER `+event+` ON passkey_credentials FOR EACH ROW `+
				condition+` EXECUTE FUNCTION block_passkey_management()`)
			lock, pid := f.beginBlockingLogin(t)
			_, err := lock.Exec(f.ctx, `SELECT pg_advisory_xact_lock(46042)`)
			passkeyError(t, err, nil)
			operation := f.operation(t)
			managed := make(chan error, 1)
			go func() {
				if event == "INSERT" {
					_, err := f.keys.Verify(f.ctx, owner, registration.FlowID, operation, response)
					managed <- err
				} else {
					managed <- f.keys.Revoke(f.ctx, owner, credential.recordID, operation)
				}
			}()
			writer := f.blockedBy(t, pid)
			ctx, cancel := context.WithTimeout(f.ctx, 5*time.Second)
			defer cancel()
			verified := f.startLogin(t, ctx, source, options, f.operation(t), credential)
			if event == "INSERT" {
				f.requireSession(t, <-verified, user)
			} else {
				f.blockedBy(t, writer)
			}
			passkeyError(t, lock.Commit(f.ctx), nil)
			passkeyError(t, <-managed, nil)
			if event == "UPDATE" {
				(<-verified).requireError(t, ErrPasskeyInvalidAuthentication)
			}
		})
	}
}

func TestPasskeyAuthenticationCancellationBeforeAndAfterCommit(t *testing.T) {
	f := setupPasskeyLogin(t)
	user, owner := f.account(t)
	credential := f.registerLogin(t, owner, testpasskey.Options{})
	source := loginSource(1)
	options := f.loginOptions(t, source)
	response := credential.assertion(t, options, testpasskey.AssertionOptions{SignCount: 1})
	blocked, complete := f.operation(t), f.operation(t)
	for _, operation := range []string{blocked, complete} {
		if operation == complete {
			result := verifyPasskeyLogin(f.ctx, f.login, source, options.FlowID, complete, response)
			f.requireSession(t, result, user)
			f.abandonLogin(t, operation)
			f.requireLoginGone(t, result.token, owner, credential)
		} else {
			f.abandonLogin(t, operation)
			verifyPasskeyLogin(f.ctx, f.login, source, options.FlowID, operation, response).requireError(t, auth.ErrOperationAbandoned)
		}
	}
}

func (f passkeyLoginFixture) abandonLogin(t *testing.T, operation string) {
	t.Helper()
	outcome, err := f.fence.Abandon(f.ctx, operation, "", false)
	passkeyError(t, err, nil)
	if outcome != "" {
		t.Fatalf("authentication abandon returned management outcome %q", outcome)
	}
}

func (f passkeyLoginFixture) requireLoginGone(t *testing.T, loginToken, owner string, credential loginCredential) {
	t.Helper()
	id, err := f.fence.Get(f.ctx, loginToken)
	passkeyError(t, err, nil)
	if id != nil || f.loginState(t, credential).counter != 1 {
		t.Fatal("abandon did not only revoke the new Session, preserving the credential counter")
	}
	f.active(t, owner, credential.recordID)
}

func TestPasskeyAuthenticationCancellationDuringWrite(t *testing.T) {
	for _, tc := range []struct {
		name   string
		cancel bool
	}{{"commit then revoke the new Session", false}, {"canceled context rolls back", true}} {
		t.Run(tc.name, func(t *testing.T) {
			f := setupPasskeyLogin(t)
			user, owner := f.account(t)
			credential := f.registerLogin(t, owner, testpasskey.Options{})
			source := loginSource(1)
			options, operation := f.loginOptions(t, source), f.operation(t)
			lock, pid := f.lockCredentialWrites(t)
			ctx, cancel := context.WithCancel(f.ctx)
			defer cancel()
			verified := f.startLogin(t, ctx, source, options, operation, credential)
			writer := f.blockedBy(t, pid)
			barrier := make(chan error, 1)
			go func() {
				_, err := f.fence.Abandon(f.ctx, operation, "", false)
				barrier <- err
			}()
			f.blockedBy(t, writer)
			if tc.cancel {
				cancel()
				result := <-verified
				result.requireNoIdentity(t)
				if !errors.Is(result.err, auth.ErrUnavailable) && !errors.Is(result.err, context.Canceled) {
					t.Fatalf("canceled login returned %v", result.err)
				}
				passkeyError(t, lock.Commit(f.ctx), nil)
				passkeyError(t, <-barrier, nil)
				if f.loginCount(t, `SELECT count(*) FROM sessions`) != 1 || f.loginState(t, credential).counter != 0 {
					t.Fatal("canceled verification partially committed")
				}
				response := credential.assertion(t, options, testpasskey.AssertionOptions{SignCount: 1})
				f.requireSession(t, f.submit(t, source, options.FlowID, response), user)
			} else {
				passkeyError(t, lock.Commit(f.ctx), nil)
				result := <-verified
				passkeyError(t, result.err, nil)
				passkeyError(t, <-barrier, nil)
				f.requireLoginGone(t, result.token, owner, credential)
			}
		})
	}
}

func TestPasskeyAuthenticationGlobalQuotasAndFlowCapacity(t *testing.T) {
	f := setupPasskeyLogin(t)
	var retry *ratelimit.Error
	_, err := f.login.AuthenticationOptions(f.ctx, loginSource(1))
	passkeyError(t, err, nil)
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO auth_rate_limits (scope, subject_digest, window_start, count, expires_at)
		VALUES ('passkey_auth_options_global', $1, date_trunc('minute', clock_timestamp()), $2,
			date_trunc('minute', clock_timestamp()) + interval '1 minute')
		ON CONFLICT (scope, subject_digest, window_start) DO UPDATE SET count = EXCLUDED.count`,
		make([]byte, 32), passkeyOptionsGlobal); err != nil {
		t.Fatal(err)
	}
	_, err = f.login.AuthenticationOptions(f.ctx, loginSource(2))
	if !errors.As(err, &retry) || retry.RetryAfterSeconds < 1 || retry.RetryAfterSeconds > 60 {
		t.Fatalf("global option quota error = %v", err)
	}

	g := setupPasskeyLogin(t)
	if _, err := g.pool.Exec(g.ctx, `INSERT INTO passkey_challenges
		(flow_id, kind, rp_id, origin, ceremony_version, session_data, expires_at)
		SELECT decode(lpad(to_hex(series), 64, '0'), 'hex'), 'authentication', $1, $2, 1, '{}',
			clock_timestamp() + interval '1 minute' FROM generate_series(1, $3) AS series`,
		passkeyTestRP, passkeyTestOrigin, passkeyActiveFlows); err != nil {
		t.Fatal(err)
	}
	_, err = g.login.AuthenticationOptions(g.ctx, loginSource(3))
	if !errors.As(err, &retry) || retry.RetryAfterSeconds < 1 || retry.RetryAfterSeconds > 120 {
		t.Fatalf("active flow capacity error = %v", err)
	}
}

func TestPasskeyAuthenticationDisabledAndDatabaseUnavailable(t *testing.T) {
	f := setupPasskeyLogin(t)
	_, owner := f.account(t)
	credential := f.registerLogin(t, owner, testpasskey.Options{})
	source := loginSource(1)
	options := f.loginOptions(t, source)
	response := credential.assertion(t, options, testpasskey.AssertionOptions{SignCount: 1})
	closed, pool := f.anotherInstance(t)
	pool.Close()
	for _, keys := range []*Passkeys{nil, f.keys, closed} {
		result, err := keys.AuthenticationOptions(f.ctx, source)
		passkeyError(t, err, auth.ErrUnavailable)
		if result != nil {
			t.Fatal("disabled or unavailable service returned options")
		}
		verifyPasskeyLogin(f.ctx, keys, source, options.FlowID, f.operation(t), response).requireError(t, auth.ErrUnavailable)
	}
}
