package passkey

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/netip"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/session"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/jackc/pgx/v5"
)

var ErrPasskeyInvalidAuthentication = errors.New("invalid_or_expired_authentication")

type PasskeyAuthenticationOptions struct {
	FlowID    string                                     `json:"flow_id"`
	PublicKey protocol.PublicKeyCredentialRequestOptions `json:"publicKey"`
}

func (p *Passkeys) AuthenticationOptions(ctx context.Context, source netip.Addr) (*PasskeyAuthenticationOptions, error) {
	tx, err := p.beginAuthentication(ctx, source)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(context.Background())
	// Keep the capacity check and insert serialized even across rate window boundaries.
	// 即使跨越限流时间窗，也要串行执行容量检查和写入。
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(3, 0)`); err != nil {
		return nil, auth.ErrUnavailable
	}
	now, err := p.admitPasskeyTraffic(ctx, tx, source, true)
	if err != nil {
		return nil, err
	}
	if err := prunePasskeyRateLimits(ctx, tx, now); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM passkey_challenges WHERE flow_id IN (
		SELECT flow_id FROM passkey_challenges WHERE kind = 'authentication' AND expires_at <= $1
		FOR UPDATE SKIP LOCKED)`, now); err != nil {
		return nil, auth.ErrUnavailable
	}
	var active int
	var firstExpiry *time.Time
	if err := tx.QueryRow(ctx, `SELECT count(*), min(expires_at) FROM passkey_challenges
		WHERE kind = 'authentication' AND consumed_at IS NULL AND expires_at > $1`, now).Scan(&active, &firstExpiry); err != nil {
		return nil, auth.ErrUnavailable
	}
	if active >= passkeyActiveFlows {
		if err := tx.Commit(ctx); err != nil {
			return nil, auth.ErrUnavailable
		}
		return nil, passkeyRetry(firstExpiry.Sub(now))
	}
	assertion, session, err := p.webauthn.BeginDiscoverableLogin(webauthn.WithLoginOrigin(p.origin))
	if err != nil {
		return nil, auth.ErrUnavailable
	}
	data, err := json.Marshal(session)
	if err != nil {
		return nil, auth.ErrUnavailable
	}
	var flow [32]byte
	if _, err := rand.Read(flow[:]); err != nil {
		return nil, auth.ErrUnavailable
	}
	if _, err := tx.Exec(ctx, `INSERT INTO passkey_challenges
		(flow_id, kind, rp_id, origin, ceremony_version, session_data, created_at, expires_at)
		VALUES ($1, 'authentication', $2, $3, $4, $5, statement_timestamp(),
			statement_timestamp() + make_interval(secs => $6))`,
		flow[:], p.rpID, p.origin, passkeyCeremonyVersion, data, passkeyChallengeTTL.Seconds()); err != nil {
		return nil, auth.ErrUnavailable
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, auth.ErrUnavailable
	}
	return &PasskeyAuthenticationOptions{FlowID: base64.RawURLEncoding.EncodeToString(flow[:]), PublicKey: assertion.Response}, nil
}

func (p *Passkeys) VerifyAuthentication(ctx context.Context, source netip.Addr, flowID, operationID string, response *protocol.CredentialAssertionResponse) (string, auth.Identity, error) {
	var flow [32]byte
	if !session.ValidOperationID(operationID) || len(flowID) != base64.RawURLEncoding.EncodedLen(len(flow)) {
		return "", auth.Identity{}, auth.ErrInvalidRequest
	}
	if n, err := base64.RawURLEncoding.Strict().Decode(flow[:], []byte(flowID)); err != nil || n != len(flow) {
		return "", auth.Identity{}, auth.ErrInvalidRequest
	}
	if err := p.reservePasskeyAttempt(ctx, source, flow[:], flowID); err != nil {
		return "", auth.Identity{}, err
	}
	return p.completeAuthentication(ctx, flow[:], operationID, response)
}

func (p *Passkeys) completeAuthentication(ctx context.Context, flow []byte, operationID string, response *protocol.CredentialAssertionResponse) (string, auth.Identity, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return "", auth.Identity{}, auth.ErrUnavailable
	}
	defer tx.Rollback(context.Background())
	token, digest, err := session.NewToken()
	if err != nil {
		return "", auth.Identity{}, err
	}
	// Lock the operation, challenge, account, and credential in that order.
	// 按操作、挑战、账户、凭据的顺序加锁。
	if err := session.ClaimOperation(ctx, tx, operationID, "verify", digest[:]); err != nil {
		return "", auth.Identity{}, err
	}
	ceremony, err := p.lockAuthentication(ctx, tx, flow)
	if err != nil {
		return "", auth.Identity{}, err
	}
	user, credential, err := p.verifyAssertion(ceremony, response, func(rawID, userHandle []byte) (webauthn.User, error) {
		return p.lockLoginCredential(ctx, tx, rawID, userHandle)
	})
	if err != nil {
		return "", auth.Identity{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE passkey_credentials SET sign_count = $2, backup_state = $3,
		last_used_at = clock_timestamp() WHERE id = $1`, user.recordID, int64(credential.Authenticator.SignCount), credential.Flags.BackupState); err != nil {
		return "", auth.Identity{}, auth.ErrUnavailable
	}
	if err := session.Insert(ctx, tx, digest, user.identity.UserID, p.sessionTTL, false); err != nil {
		return "", auth.Identity{}, auth.ErrUnavailable
	}
	result, err := tx.Exec(ctx, `UPDATE passkey_challenges SET consumed_at = clock_timestamp()
		WHERE flow_id = $1 AND consumed_at IS NULL AND expires_at > clock_timestamp()`, flow)
	if err != nil {
		return "", auth.Identity{}, auth.ErrUnavailable
	}
	if result.RowsAffected() != 1 {
		return "", auth.Identity{}, ErrPasskeyInvalidAuthentication
	}
	if err := tx.Commit(ctx); err != nil {
		return "", auth.Identity{}, auth.ErrUnavailable
	}
	return token, user.identity, nil
}

func (p *Passkeys) lockAuthentication(ctx context.Context, tx pgx.Tx, flow []byte) (webauthn.SessionData, error) {
	var session webauthn.SessionData
	var data []byte
	err := tx.QueryRow(ctx, `SELECT session_data FROM passkey_challenges WHERE flow_id = $1
		AND kind = 'authentication' AND rp_id = $2 AND origin = $3 AND ceremony_version = $4
		AND user_id IS NULL AND session_id IS NULL AND consumed_at IS NULL AND expires_at > clock_timestamp()
		FOR UPDATE`, flow, p.rpID, p.origin, passkeyCeremonyVersion).Scan(&data)
	if errors.Is(err, pgx.ErrNoRows) {
		return session, ErrPasskeyInvalidAuthentication
	}
	if err != nil || json.Unmarshal(data, &session) != nil || session.RelyingPartyID != p.rpID || session.Origin != p.origin ||
		session.UserVerification != protocol.VerificationRequired || session.Mediation != protocol.MediationDefault ||
		len(session.UserID) != 0 || len(session.AllowedCredentialIDs) != 0 || session.AuthorizeUVInitialization {
		return session, auth.ErrUnavailable
	}
	return session, nil
}

func (p *Passkeys) verifyAssertion(session webauthn.SessionData, response *protocol.CredentialAssertionResponse, resolve webauthn.DiscoverableUserHandler) (*passkeyLoginUser, *webauthn.Credential, error) {
	if response == nil || len(response.RawID) > 1023 || base64.RawURLEncoding.EncodeToString(response.RawID) != response.ID {
		return nil, nil, ErrPasskeyInvalidAuthentication
	}
	parsed, err := response.Parse()
	if err != nil || parsed.Response.CollectedClientData.Origin != p.origin || len(parsed.Response.UserHandle) != 32 {
		return nil, nil, ErrPasskeyInvalidAuthentication
	}
	user, credential, err := p.webauthn.ValidatePasskeyLogin(resolve, session, parsed)
	if errors.Is(err, auth.ErrUnavailable) {
		return nil, nil, auth.ErrUnavailable
	}
	if err != nil || credential.Authenticator.CloneWarning {
		return nil, nil, ErrPasskeyInvalidAuthentication
	}
	login, ok := user.(*passkeyLoginUser)
	if !ok {
		return nil, nil, ErrPasskeyInvalidAuthentication
	}
	return login, credential, nil
}

type passkeyLoginUser struct {
	passkeyUser
	identity    auth.Identity
	recordID    string
	credentials [1]webauthn.Credential
}

func (u *passkeyLoginUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials[:] }

func (p *Passkeys) lockLoginCredential(ctx context.Context, tx pgx.Tx, id, handle []byte) (*passkeyLoginUser, error) {
	user := &passkeyLoginUser{}
	err := tx.QueryRow(ctx, `SELECT id::text, login_name, display_name, webauthn_user_handle
		FROM users WHERE webauthn_user_handle = $1 AND status = 'active' FOR SHARE`, handle).
		Scan(&user.identity.UserID, &user.identity.LoginName, &user.identity.DisplayName, &user.handle)
	if err != nil {
		return nil, loginLookupError(err)
	}
	user.name, user.displayName = user.identity.LoginName, user.identity.DisplayName
	credential := &user.credentials[0]
	var counter int64
	var backupEligible, backupState, uvInitialized bool
	err = tx.QueryRow(ctx, `SELECT id::text, credential_id, public_key, sign_count, backup_eligible, backup_state, uv_initialized
		FROM passkey_credentials WHERE rp_id = $1 AND credential_id = $2 AND user_id = $3 AND revoked_at IS NULL FOR UPDATE`,
		p.rpID, id, user.identity.UserID).Scan(&user.recordID, &credential.ID, &credential.PublicKey, &counter,
		&backupEligible, &backupState, &uvInitialized)
	if err != nil {
		return nil, loginLookupError(err)
	}
	credential.Authenticator.SignCount = uint32(counter)
	var flags protocol.AuthenticatorFlags
	if backupEligible {
		flags |= protocol.FlagBackupEligible
	}
	if backupState {
		flags |= protocol.FlagBackupState
	}
	if uvInitialized {
		flags |= protocol.FlagUserVerified
	}
	credential.Flags = webauthn.NewCredentialFlags(flags)
	return user, nil
}

func loginLookupError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrPasskeyInvalidAuthentication
	}
	return auth.ErrUnavailable
}
