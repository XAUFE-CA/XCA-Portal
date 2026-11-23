package ratelimit

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"time"

	"github.com/jackc/pgx/v5"
)

type Error struct {
	RetryAfterSeconds int
}

func (e *Error) Error() string { return "rate_limited" }

func SubjectDigest(key []byte, scope, value string) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte("xca/rate-limit/v1\x00"))
	_, _ = mac.Write([]byte(scope))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}

func Count(ctx context.Context, tx pgx.Tx, scope string, digest []byte, now, start, expiry time.Time, max int, renewable bool) (int, time.Time, error) {
	var count int
	var until time.Time
	err := tx.QueryRow(ctx, `
		INSERT INTO auth_rate_limits (scope, subject_digest, window_start, count, expires_at)
		VALUES ($1, $2, $3, 1, $4)
		ON CONFLICT (scope, subject_digest, window_start) DO UPDATE SET
			count = CASE WHEN $5 AND auth_rate_limits.expires_at <= $6 THEN 1
			             ELSE LEAST(auth_rate_limits.count + 1, $7 + 1) END,
			expires_at = CASE WHEN $5 AND auth_rate_limits.expires_at <= $6 THEN EXCLUDED.expires_at
			                  ELSE auth_rate_limits.expires_at END
		RETURNING count, expires_at`, scope, digest, start, expiry, renewable, now, max).Scan(&count, &until)
	return count, until, err
}
