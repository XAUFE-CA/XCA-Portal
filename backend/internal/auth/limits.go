package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	limitWindow = 15 * time.Minute
	resendDelay = time.Minute
)

func subjectDigest(key []byte, scope, value string) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte("xca/rate-limit/v1\x00"))
	_, _ = mac.Write([]byte(scope))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}

func lockLimitSubjects(ctx context.Context, tx pgx.Tx, ipDigest, emailDigest []byte) error {
	for _, item := range []struct {
		namespace int32
		digest    []byte
	}{{1, ipDigest}, {2, emailDigest}} {
		key := int32(binary.BigEndian.Uint32(item.digest[:4]))
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1::integer, $2::integer)`, item.namespace, key); err != nil {
			return err
		}
	}
	return nil
}

func countLimit(ctx context.Context, tx pgx.Tx, scope string, digest []byte, now, start, expiry time.Time, max int, renewable bool) (int, time.Time, error) {
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

func (s *Service) applyLimits(ctx context.Context, tx pgx.Tx, ipDigest, emailDigest, cooldownDigest []byte, now time.Time) (time.Duration, error) {
	start := now.UTC().Truncate(limitWindow)
	expiry := start.Add(limitWindow)
	var retry time.Duration
	limits := []struct {
		scope         string
		digest        []byte
		start, expiry time.Time
		max           int
		renewable     bool
	}{
		{"ip", ipDigest, start, expiry, 30, false},
		{"email", emailDigest, start, expiry, 3, false},
		{"email_cooldown", cooldownDigest, time.Unix(0, 0).UTC(), now.Add(resendDelay), 1, true},
	}
	for _, limit := range limits {
		count, until, err := countLimit(ctx, tx, limit.scope, limit.digest, now, limit.start, limit.expiry, limit.max, limit.renewable)
		if err != nil {
			return 0, err
		}
		if count > limit.max && until.After(now) && until.Sub(now) > retry {
			retry = until.Sub(now)
		}
	}
	return retry, nil
}

// CleanExpiredRateLimits removes only windows that have already expired.
// CleanExpiredRateLimits 只删除已经过期的时间窗口。
func (s *Service) CleanExpiredRateLimits(ctx context.Context) (int64, error) {
	result, err := s.pool.Exec(ctx, `DELETE FROM auth_rate_limits WHERE expires_at <= clock_timestamp()`)
	if err != nil {
		return 0, ErrUnavailable
	}
	return result.RowsAffected(), nil
}
