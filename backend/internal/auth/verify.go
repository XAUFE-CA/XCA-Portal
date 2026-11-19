package auth

import (
	"context"
	"errors"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/invitation"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const maxAttempts = 5

type Identity struct {
	UserID      string
	LoginName   string
	DisplayName string
}

// WithVerifiedChallenge runs the caller's session operation in the activation transaction.
// WithVerifiedChallenge 在账户激活事务中执行调用方的会话操作。
func (s *Service) WithVerifiedChallenge(ctx context.Context, flow, code string, finish func(context.Context, pgx.Tx, Identity) error) error {
	if !validFlow(flow) || !validCode(code) || finish == nil {
		return ErrInvalidRequest
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ErrUnavailable
	}
	defer tx.Rollback(context.Background())
	var email string
	var digest []byte
	var version, attempts int
	var invitationID, userID *string
	var expires time.Time
	var used, delivered *time.Time
	err = tx.QueryRow(ctx, `
		SELECT email, otp_digest, key_version, invitation_id::text, user_id::text,
		       expires_at, attempts, used_at, delivered_at
		FROM email_challenges WHERE flow_id = $1 FOR UPDATE`, flow).
		Scan(&email, &digest, &version, &invitationID, &userID, &expires, &attempts, &used, &delivered)
	if errors.Is(err, pgx.ErrNoRows) {
		_ = equalDigest(signOTP(s.keys[s.keyVersion], flow, code), make([]byte, 32))
		return ErrInvalidCode
	}
	if err != nil {
		return ErrUnavailable
	}
	key, exists := s.keys[version]
	if !exists {
		return ErrUnavailable
	}
	matches := equalDigest(digest, signOTP(key, flow, code))
	var now time.Time
	if err := tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return ErrUnavailable
	}
	if used != nil || delivered == nil || !expires.After(now) || attempts >= maxAttempts || (invitationID == nil && userID == nil) {
		return ErrInvalidCode
	}
	if !matches {
		if _, err := tx.Exec(ctx, `UPDATE email_challenges SET attempts = attempts + 1 WHERE flow_id = $1`, flow); err != nil || tx.Commit(ctx) != nil {
			return ErrUnavailable
		}
		return ErrInvalidCode
	}
	var identity Identity
	if invitationID != nil {
		identity, err = activate(ctx, tx, *invitationID, email)
	} else {
		identity, err = activeUser(ctx, tx, *userID, email)
	}
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE email_challenges SET used_at = clock_timestamp() WHERE flow_id = $1`, flow); err != nil {
		return ErrUnavailable
	}
	if err := finish(ctx, tx, identity); err != nil {
		if errors.Is(err, ErrOperationAbandoned) {
			return err
		}
		return ErrUnavailable
	}
	if err := tx.Commit(ctx); err != nil {
		return ErrUnavailable
	}
	return nil
}

func validFlow(flow string) bool {
	if len(flow) < 32 || len(flow) > 128 {
		return false
	}
	for _, c := range flow {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-') {
			return false
		}
	}
	return true
}

func validCode(code string) bool {
	if len(code) != 6 {
		return false
	}
	for _, c := range code {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func activeUser(ctx context.Context, tx pgx.Tx, userID, email string) (Identity, error) {
	var identity Identity
	err := tx.QueryRow(ctx, `SELECT id::text, login_name, display_name FROM users WHERE id = $1::uuid AND email = $2 AND status = 'active' FOR UPDATE`, userID, email).
		Scan(&identity.UserID, &identity.LoginName, &identity.DisplayName)
	if errors.Is(err, pgx.ErrNoRows) {
		return Identity{}, ErrInvalidCode
	}
	if err != nil {
		return Identity{}, ErrUnavailable
	}
	return identity, nil
}

func activate(ctx context.Context, tx pgx.Tx, invitationID, email string) (Identity, error) {
	var inviteEmail, login string
	err := tx.QueryRow(ctx, `SELECT email, login_name FROM invitations WHERE id = $1::uuid`, invitationID).Scan(&inviteEmail, &login)
	if errors.Is(err, pgx.ErrNoRows) {
		return Identity{}, ErrInvalidCode
	}
	if err != nil {
		return Identity{}, ErrUnavailable
	}
	if err := invitation.LockKeys(ctx, tx, inviteEmail, login); err != nil {
		return Identity{}, ErrUnavailable
	}
	var displayName string
	err = tx.QueryRow(ctx, `
		SELECT display_name FROM invitations WHERE id = $1::uuid AND email = $2 AND active_slot
		AND revoked_at IS NULL AND used_at IS NULL AND expires_at > clock_timestamp() FOR UPDATE`, invitationID, email).Scan(&displayName)
	if errors.Is(err, pgx.ErrNoRows) {
		return Identity{}, ErrInvalidCode
	}
	if err != nil {
		return Identity{}, ErrUnavailable
	}
	var identity Identity
	err = tx.QueryRow(ctx, `INSERT INTO users (email, login_name, display_name, status) VALUES ($1, $2, $3, 'active') RETURNING id::text, login_name, display_name`, email, login, displayName).
		Scan(&identity.UserID, &identity.LoginName, &identity.DisplayName)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return Identity{}, ErrInvalidCode
		}
		return Identity{}, ErrUnavailable
	}
	if _, err := tx.Exec(ctx, `UPDATE invitations SET active_slot = false, used_at = clock_timestamp(), user_id = $2::uuid WHERE id = $1::uuid`, invitationID, identity.UserID); err != nil {
		return Identity{}, ErrUnavailable
	}
	return identity, nil
}
