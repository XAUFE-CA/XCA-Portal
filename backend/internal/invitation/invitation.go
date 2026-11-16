package invitation

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrConflict     = errors.New("email or login name already in use")
	ErrNotFound     = errors.New("invitation not found")
	ErrNotRevocable = errors.New("invitation is already used or revoked")
)

const (
	DefaultTTL = 7 * 24 * time.Hour
	MinTTL     = time.Microsecond
	MaxTTL     = 365 * 24 * time.Hour
)

type Invitation struct {
	ID          string
	Email       string
	LoginName   string
	DisplayName string
	CreatedAt   time.Time
	ExpiresAt   time.Time
	RevokedAt   *time.Time
	UsedAt      *time.Time
	UserID      *string
	Status      string
}

type CreateInput struct {
	Email       string
	LoginName   string
	DisplayName string
	TTL         time.Duration
}

// LockKeys serializes invitation creation and activation for matching identities.
// LockKeys 对匹配身份的邀请创建和激活进行串行化。
func LockKeys(ctx context.Context, tx pgx.Tx, email, login string) error {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('xca-invitation-email:' || $1, 0))`, email); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('xca-invitation-login:' || $1, 0))`, login)
	return err
}

type Store struct {
	pool *pgxpool.Pool
}

// NewStore binds invitation operations to the supplied connection pool.
// NewStore 将邀请操作绑定到指定连接池。
func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// Create returns the invitation and its secret only after the transaction commits.
// Create 仅在事务提交后返回邀请及其密钥。
func (s *Store) Create(ctx context.Context, input CreateInput) (Invitation, string, error) {
	email, err := NormalizeEmail(input.Email)
	if err != nil {
		return Invitation{}, "", err
	}
	login, err := NormalizeLogin(input.LoginName)
	if err != nil {
		return Invitation{}, "", err
	}
	display, err := normalizeDisplayName(input.DisplayName)
	if err != nil {
		return Invitation{}, "", err
	}
	ttl := input.TTL
	if ttl == 0 {
		ttl = DefaultTTL
	}
	if ttl < MinTTL || ttl > MaxTTL || ttl%time.Microsecond != 0 {
		return Invitation{}, "", ErrInvalidInput
	}
	var random [32]byte
	if _, err := rand.Read(random[:]); err != nil {
		return Invitation{}, "", err
	}
	token := base64.RawURLEncoding.EncodeToString(random[:])
	digest := sha256.Sum256([]byte(token))
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Invitation{}, "", err
	}
	defer tx.Rollback(ctx)

	if err = LockKeys(ctx, tx, email, login); err != nil {
		return Invitation{}, "", err
	}
	if _, err = tx.Exec(ctx, `UPDATE invitations SET active_slot = false WHERE active_slot AND expires_at <= now() AND (email = $1 OR login_name = $2)`, email, login); err != nil {
		return Invitation{}, "", err
	}
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE email = $1 OR login_name = $2)`, email, login).Scan(&exists); err != nil {
		return Invitation{}, "", err
	}
	if exists {
		return Invitation{}, "", ErrConflict
	}
	var invitation Invitation
	err = tx.QueryRow(ctx, `INSERT INTO invitations (token_digest, email, login_name, display_name, expires_at)
		VALUES ($1, $2, $3, $4, now() + $5::bigint * interval '1 microsecond')
		RETURNING id::text, email, login_name, display_name, created_at, expires_at`,
		digest[:], email, login, display, ttl.Microseconds()).Scan(&invitation.ID, &invitation.Email, &invitation.LoginName,
		&invitation.DisplayName, &invitation.CreatedAt, &invitation.ExpiresAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return Invitation{}, "", ErrConflict
		}
		return Invitation{}, "", err
	}
	if err = tx.Commit(ctx); err != nil {
		return Invitation{}, "", err
	}
	invitation.Status = "active"
	return invitation, token, nil
}

// Get retrieves an invitation by its non-secret UUID.
// Get 按非密钥 UUID 查询邀请。
func (s *Store) Get(ctx context.Context, id string) (Invitation, error) {
	var uuid pgtype.UUID
	if err := uuid.Scan(id); err != nil {
		return Invitation{}, ErrNotFound
	}
	var invitation Invitation
	err := s.pool.QueryRow(ctx, `SELECT id::text, email, login_name, display_name, created_at, expires_at,
		revoked_at, used_at, user_id::text,
		CASE WHEN used_at IS NOT NULL THEN 'used' WHEN revoked_at IS NOT NULL THEN 'revoked'
		WHEN expires_at <= now() THEN 'expired' ELSE 'active' END
		FROM invitations WHERE id = $1`, uuid).Scan(&invitation.ID, &invitation.Email,
		&invitation.LoginName, &invitation.DisplayName, &invitation.CreatedAt, &invitation.ExpiresAt,
		&invitation.RevokedAt, &invitation.UsedAt, &invitation.UserID, &invitation.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return Invitation{}, ErrNotFound
	}
	return invitation, err
}

// Revoke invalidates an unused invitation without modifying any account.
// Revoke 撤销未使用的邀请，不修改任何账户。
func (s *Store) Revoke(ctx context.Context, id string) error {
	var uuid pgtype.UUID
	if err := uuid.Scan(id); err != nil {
		return ErrNotFound
	}
	tag, err := s.pool.Exec(ctx, `UPDATE invitations SET revoked_at = now(), active_slot = false
		WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL`, uuid)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 1 {
		return nil
	}
	_, err = s.Get(ctx, id)
	if err != nil {
		return err
	}
	return ErrNotRevocable
}
