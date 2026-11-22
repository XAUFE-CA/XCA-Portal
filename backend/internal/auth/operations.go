package auth

import (
	"context"
	"errors"
	"regexp"

	"github.com/jackc/pgx/v5"
)

var (
	ErrOperationAbandoned = errors.New("operation_abandoned")
	operationIDPattern    = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
)

func ValidOperationID(id string) bool {
	return operationIDPattern.MatchString(id)
}

// claimOperation runs in the same transaction as the identity mutation.
// Its primary-key lock serializes the mutation with an abandon barrier.
// claimOperation 与身份变更在同一事务中执行，主键锁使该变更与取消屏障串行。
func claimOperation(ctx context.Context, tx pgx.Tx, id, kind string, digest []byte) error {
	var inserted string
	err := tx.QueryRow(ctx, `INSERT INTO auth_operations (id, kind, state, session_digest)
		VALUES ($1::uuid, $2, 'completed', $3)
		ON CONFLICT (id) DO NOTHING RETURNING id::text`, id, kind, digest).Scan(&inserted)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrOperationAbandoned
	}
	if err != nil {
		return ErrUnavailable
	}
	return nil
}

// Abandon fences late writes and reports the compensation outcome for Passkey management.
// Abandon 阻止晚到的写入，并报告 Passkey 管理操作的补偿结果。
func (s *Sessions) Abandon(ctx context.Context, id, token string, allowPasskeys bool) (string, error) {
	if !ValidOperationID(id) {
		return "", ErrInvalidRequest
	}
	if s == nil || s.pool == nil {
		return "", ErrUnavailable
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", ErrUnavailable
	}
	defer tx.Rollback(context.Background())
	if _, err := tx.Exec(ctx, `INSERT INTO auth_operations (id, kind, state)
		VALUES ($1::uuid, 'abandon', 'abandoned') ON CONFLICT (id) DO NOTHING`, id); err != nil {
		return "", ErrUnavailable
	}
	var kind string
	var digest []byte
	if err := tx.QueryRow(ctx, `SELECT kind, session_digest FROM auth_operations
		WHERE id = $1::uuid FOR UPDATE`, id).Scan(&kind, &digest); err != nil {
		return "", ErrUnavailable
	}
	if kind == "verify" && digest != nil {
		if _, err := tx.Exec(ctx, `UPDATE sessions SET revoked_at = clock_timestamp()
			WHERE session_digest = $1 AND revoked_at IS NULL`, digest); err != nil {
			return "", ErrUnavailable
		}
	}
	var outcome string
	if kind == "passkey_manage" {
		outcome, err = abandonPasskeyEffect(ctx, tx, id, token, allowPasskeys)
		if err != nil {
			return "", err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE auth_operations SET state = 'abandoned'
		WHERE id = $1::uuid`, id); err != nil {
		return "", ErrUnavailable
	}
	if err := tx.Commit(ctx); err != nil {
		return "", ErrUnavailable
	}
	return outcome, nil
}

// RevokeWithOperation makes a logout observable by the same barrier even if
// its HTTP response was interrupted.
// RevokeWithOperation 使注销经由同一屏障可被观测，即使其 HTTP 响应已中断。
func (s *Sessions) RevokeWithOperation(ctx context.Context, token, operationID string) error {
	if !ValidOperationID(operationID) {
		return ErrInvalidRequest
	}
	if s == nil || s.pool == nil {
		return ErrUnavailable
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ErrUnavailable
	}
	defer tx.Rollback(context.Background())
	if err := claimOperation(ctx, tx, operationID, "logout", nil); err != nil {
		return err
	}
	if digest, ok := sessionDigest(token); ok {
		if _, err := tx.Exec(ctx, `UPDATE sessions SET revoked_at = clock_timestamp()
			WHERE session_digest = $1 AND revoked_at IS NULL`, digest); err != nil {
			return ErrUnavailable
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return ErrUnavailable
	}
	return nil
}
