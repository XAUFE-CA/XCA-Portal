package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Sessions struct {
	pool *pgxpool.Pool
	ttl  time.Duration
}

func NewSessions(pool *pgxpool.Pool, ttl time.Duration) *Sessions {
	return &Sessions{pool: pool, ttl: ttl}
}

func (s *Sessions) Verify(ctx context.Context, service *Service, flow, code string) (string, Identity, error) {
	return s.verify(ctx, service, flow, code, "")
}

// VerifyWithOperation links the mutation to a durable cancellation fence.
// VerifyWithOperation 把本次身份变更与持久化取消屏障关联起来。
func (s *Sessions) VerifyWithOperation(ctx context.Context, service *Service, flow, code, operationID string) (string, Identity, error) {
	if !ValidOperationID(operationID) {
		return "", Identity{}, ErrInvalidRequest
	}
	return s.verify(ctx, service, flow, code, operationID)
}

func (s *Sessions) verify(ctx context.Context, service *Service, flow, code, operationID string) (string, Identity, error) {
	if s == nil || s.pool == nil || s.ttl <= 0 || service == nil {
		return "", Identity{}, ErrUnavailable
	}
	token, digest, err := newSessionToken()
	if err != nil {
		return "", Identity{}, err
	}
	var identity Identity
	err = service.WithVerifiedChallenge(ctx, flow, code, func(ctx context.Context, tx pgx.Tx, verified Identity) error {
		identity = verified
		if operationID != "" {
			if err := claimOperation(ctx, tx, operationID, "verify", digest[:]); err != nil {
				return err
			}
		}
		return insertSession(ctx, tx, digest, verified.UserID, s.ttl, true)
	})
	if err != nil {
		return "", Identity{}, err
	}
	return token, identity, nil
}

func newSessionToken() (string, [sha256.Size]byte, error) {
	var secret [32]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return "", [sha256.Size]byte{}, ErrUnavailable
	}
	token := base64.RawURLEncoding.EncodeToString(secret[:])
	return token, sha256.Sum256([]byte(token)), nil
}

func insertSession(ctx context.Context, tx pgx.Tx, digest [sha256.Size]byte, userID string, ttl time.Duration, verifiedOTP bool) error {
	_, err := tx.Exec(ctx, `INSERT INTO sessions (session_digest, user_id, expires_at, otp_verified_at)
		VALUES ($1, $2, clock_timestamp() + make_interval(secs => $3::double precision),
			CASE WHEN $4::boolean THEN statement_timestamp() END)`, digest[:], userID, ttl.Seconds(), verifiedOTP)
	return err
}

func sessionDigest(token string) ([]byte, bool) {
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(decoded) != 32 || base64.RawURLEncoding.EncodeToString(decoded) != token {
		return nil, false
	}
	digest := sha256.Sum256([]byte(token))
	return digest[:], true
}

func (s *Sessions) Get(ctx context.Context, token string) (*Identity, error) {
	digest, ok := sessionDigest(token)
	if !ok {
		return nil, nil
	}
	if s == nil || s.pool == nil {
		return nil, ErrUnavailable
	}
	var id Identity
	err := s.pool.QueryRow(ctx, `UPDATE sessions AS s SET last_used_at = clock_timestamp()
		FROM users AS u WHERE s.session_digest = $1 AND s.user_id = u.id
		AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp() AND u.status = 'active'
		RETURNING u.id, u.login_name, u.display_name`, digest).Scan(&id.UserID, &id.LoginName, &id.DisplayName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, ErrUnavailable
	}
	return &id, nil
}

func (s *Sessions) Revoke(ctx context.Context, token string) error {
	digest, ok := sessionDigest(token)
	if !ok {
		return nil
	}
	if s == nil || s.pool == nil {
		return ErrUnavailable
	}
	_, err := s.pool.Exec(ctx, `UPDATE sessions SET revoked_at = clock_timestamp() WHERE session_digest = $1 AND revoked_at IS NULL`, digest)
	if err != nil {
		return ErrUnavailable
	}
	return nil
}
