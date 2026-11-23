package emailcode

import (
	"context"
	"encoding/binary"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/ratelimit"
	"github.com/jackc/pgx/v5"
)

const (
	limitWindow = 15 * time.Minute
	resendDelay = time.Minute
)

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
		count, until, err := ratelimit.Count(ctx, tx, limit.scope, limit.digest, now, limit.start, limit.expiry, limit.max, limit.renewable)
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
		return 0, auth.ErrUnavailable
	}
	return result.RowsAffected(), nil
}
