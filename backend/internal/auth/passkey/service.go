package passkey

import (
	"context"
	"errors"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/session"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/config"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrPasskeyUnauthenticated     = errors.New("authentication_required")
	ErrPasskeyRecentOTP           = errors.New("recent_otp_required")
	ErrPasskeyInvalidRegistration = errors.New("invalid_or_expired_registration")
	ErrPasskeyDuplicate           = errors.New("credential_exists")
)

const passkeyChallengeTTL = 2 * time.Minute

type Passkeys struct {
	pool                  *pgxpool.Pool
	webauthn              *webauthn.WebAuthn
	rpID                  string
	origin                string
	recentOTP             time.Duration
	managementEnabled     bool
	authenticationEnabled bool
	sessionTTL            time.Duration
	rateLimitKey          []byte
}

type PasskeySummary struct {
	ID             string     `json:"id"`
	Label          *string    `json:"label"`
	CreatedAt      time.Time  `json:"created_at"`
	LastUsedAt     *time.Time `json:"last_used_at"`
	BackupEligible bool       `json:"backup_eligible"`
	BackupState    bool       `json:"backup_state"`
}

func NewPasskeys(pool *pgxpool.Pool, cfg config.Config) (*Passkeys, error) {
	p := cfg.Passkeys
	if !p.Enabled && !p.AuthenticationEnabled {
		return nil, nil
	}
	if cfg.Environment != "test" || p.RPID == "" || p.RPName == "" || cfg.PublicOrigin == "" ||
		p.Enabled && p.RecentOTP <= 0 ||
		p.AuthenticationEnabled && (cfg.SessionTTL <= 0 || len(cfg.RateLimitHMACKey) < 32) {
		return nil, errors.New("invalid passkey configuration")
	}
	resident := true
	wa, err := webauthn.New(&webauthn.Config{
		RPID: p.RPID, RPDisplayName: p.RPName, RPOrigins: []string{cfg.PublicOrigin},
		AttestationPreference: protocol.PreferNoAttestation,
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			ResidentKey: protocol.ResidentKeyRequirementRequired, RequireResidentKey: &resident,
			UserVerification: protocol.VerificationRequired,
		},
		Timeouts: webauthn.TimeoutsConfig{
			Registration: webauthn.TimeoutConfig{Timeout: passkeyChallengeTTL},
			Login:        webauthn.TimeoutConfig{Timeout: passkeyChallengeTTL},
		},
	})
	if err != nil {
		return nil, errors.New("invalid WebAuthn configuration")
	}
	return &Passkeys{
		pool: pool, webauthn: wa, rpID: p.RPID, origin: cfg.PublicOrigin, recentOTP: p.RecentOTP,
		managementEnabled: p.Enabled, authenticationEnabled: p.AuthenticationEnabled,
		sessionTTL: cfg.SessionTTL, rateLimitKey: cfg.RateLimitHMACKey,
	}, nil
}

func (p *Passkeys) ManagementEnabled() bool { return p != nil && p.managementEnabled }

func (p *Passkeys) AuthenticationEnabled() bool { return p != nil && p.authenticationEnabled }

func (p *Passkeys) List(ctx context.Context, token string) ([]PasskeySummary, error) {
	digest, ok := session.Digest(token)
	if !ok {
		return nil, ErrPasskeyUnauthenticated
	}
	if !p.ManagementEnabled() || p.pool == nil {
		return nil, auth.ErrUnavailable
	}
	rows, err := p.pool.Query(ctx, `SELECT COALESCE(c.id::text, ''), c.label,
		COALESCE(c.created_at, 'epoch'), c.last_used_at, COALESCE(c.backup_eligible, false), COALESCE(c.backup_state, false)
		FROM sessions AS s JOIN users AS u ON u.id = s.user_id
		LEFT JOIN passkey_credentials AS c ON c.user_id = u.id AND c.rp_id = $2 AND c.revoked_at IS NULL
		WHERE s.session_digest = $1 AND s.revoked_at IS NULL AND s.expires_at > statement_timestamp() AND u.status = 'active'
		ORDER BY c.created_at, c.id`, digest, p.rpID)
	if err != nil {
		return nil, auth.ErrUnavailable
	}
	defer rows.Close()
	if !rows.Next() {
		if rows.Err() != nil {
			return nil, auth.ErrUnavailable
		}
		return nil, ErrPasskeyUnauthenticated
	}
	result := make([]PasskeySummary, 0)
	for {
		item, err := scanPasskeySummary(rows)
		if err != nil {
			return nil, auth.ErrUnavailable
		}
		if item.ID != "" {
			result = append(result, item)
		}
		if !rows.Next() {
			break
		}
	}
	if rows.Err() != nil {
		return nil, auth.ErrUnavailable
	}
	return result, nil
}

func scanPasskeySummary(row pgx.Row) (PasskeySummary, error) {
	var item PasskeySummary
	err := row.Scan(&item.ID, &item.Label, &item.CreatedAt, &item.LastUsedAt, &item.BackupEligible, &item.BackupState)
	return item, err
}

func (p *Passkeys) Revoke(ctx context.Context, token, id, operationID string) error {
	if !session.ValidOperationID(id) || !session.ValidOperationID(operationID) {
		return auth.ErrInvalidRequest
	}
	return p.withMutation(ctx, token, operationID, func(tx pgx.Tx, actor passkeyActor, digest []byte) error {
		result, err := tx.Exec(ctx, `UPDATE passkey_credentials SET revoked_at = clock_timestamp()
			WHERE id = $1 AND user_id = $2 AND rp_id = $3 AND revoked_at IS NULL`, id, actor.userID, p.rpID)
		if err != nil {
			return auth.ErrUnavailable
		}
		if result.RowsAffected() == 0 {
			return auth.ErrPasskeyNotFound
		}
		return session.RecordPasskeyEffect(ctx, tx, operationID, digest, id, "revocation")
	})
}

// withMutation takes the operation lock before session, account and credential locks.
// withMutation 先锁定操作，再锁定会话、账户和凭据。
func (p *Passkeys) withMutation(ctx context.Context, token, operationID string, change func(pgx.Tx, passkeyActor, []byte) error) error {
	tx, digest, err := p.begin(ctx, token)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	if err := session.ClaimOperation(ctx, tx, operationID, "passkey_manage", nil); err != nil {
		return err
	}
	actor, err := p.lockActor(ctx, tx, digest, false)
	if err != nil {
		return err
	}
	if err := change(tx, actor, digest); err != nil {
		return err
	}
	return p.commitRecent(ctx, tx, actor)
}

func (p *Passkeys) begin(ctx context.Context, token string) (pgx.Tx, []byte, error) {
	digest, ok := session.Digest(token)
	if !ok {
		return nil, nil, ErrPasskeyUnauthenticated
	}
	if !p.ManagementEnabled() || p.pool == nil {
		return nil, nil, auth.ErrUnavailable
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, nil, auth.ErrUnavailable
	}
	return tx, digest, nil
}

func (p *Passkeys) commitRecent(ctx context.Context, tx pgx.Tx, actor passkeyActor) error {
	if err := p.checkRecent(ctx, tx, actor); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return auth.ErrUnavailable
	}
	return nil
}

type passkeyActor struct {
	userID, sessionID string
	user              passkeyUser
}

func (p *Passkeys) lockActor(ctx context.Context, tx pgx.Tx, digest []byte, initializeHandle bool) (passkeyActor, error) {
	var actor passkeyActor
	userLock := `FOR SHARE OF u`
	if initializeHandle {
		userLock = `FOR UPDATE OF u`
	}
	err := tx.QueryRow(ctx, `SELECT s.id::text, u.id::text, u.login_name, u.display_name, u.webauthn_user_handle
		FROM sessions AS s JOIN users AS u ON u.id = s.user_id WHERE s.session_digest = $1
		AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp() AND u.status = 'active' FOR SHARE OF s `+userLock, digest).
		Scan(&actor.sessionID, &actor.userID, &actor.user.name, &actor.user.displayName, &actor.user.handle)
	if errors.Is(err, pgx.ErrNoRows) {
		return actor, ErrPasskeyUnauthenticated
	}
	if err != nil {
		return actor, auth.ErrUnavailable
	}
	return actor, p.checkRecent(ctx, tx, actor)
}

// checkRecent uses the database clock after locks or writes that may have waited.
// checkRecent 在可能发生等待的加锁或写入之后使用数据库时钟。
func (p *Passkeys) checkRecent(ctx context.Context, tx pgx.Tx, actor passkeyActor) error {
	var valid, fresh bool
	err := tx.QueryRow(ctx, `SELECT s.revoked_at IS NULL AND s.expires_at > t.at AND u.status = 'active',
		COALESCE(s.otp_verified_at <= t.at AND s.otp_verified_at > t.at - make_interval(secs => $3), false)
		FROM sessions AS s JOIN users AS u ON u.id = s.user_id CROSS JOIN (SELECT clock_timestamp() AS at) AS t
		WHERE s.id = $1 AND u.id = $2`, actor.sessionID, actor.userID, p.recentOTP.Seconds()).Scan(&valid, &fresh)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && !valid {
		return ErrPasskeyUnauthenticated
	}
	if err != nil {
		return auth.ErrUnavailable
	}
	if !fresh {
		return ErrPasskeyRecentOTP
	}
	return nil
}
