package auth

import (
	"context"
	"errors"
	"net/netip"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	passkeyTrafficWindow = time.Minute
	passkeyOptionsGlobal = 160
	passkeyOptionsSource = 10
	passkeyVerifyGlobal  = 320
	passkeyVerifySource  = 20
	passkeyActiveFlows   = 256
	passkeyFlowAttempts  = 5
)

func (p *Passkeys) beginAuthentication(ctx context.Context, source netip.Addr) (pgx.Tx, error) {
	if !p.AuthenticationEnabled() || p.pool == nil {
		return nil, ErrUnavailable
	}
	if !source.IsValid() || source.Zone() != "" {
		return nil, ErrInvalidRequest
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, ErrUnavailable
	}
	return tx, nil
}

func passkeyRetry(wait time.Duration) error {
	return &RateLimitError{RetryAfterSeconds: max(1, int((wait+time.Second-1)/time.Second))}
}

func (p *Passkeys) admitPasskeyTraffic(ctx context.Context, tx pgx.Tx, source netip.Addr, options bool) (time.Time, error) {
	var now time.Time
	if err := tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return now, ErrUnavailable
	}
	globalScope, sourceScope := "passkey_auth_verify_global", "passkey_auth_verify_ip"
	globalLimit, sourceLimit := passkeyVerifyGlobal, passkeyVerifySource
	if options {
		globalScope, sourceScope = "passkey_auth_options_global", "passkey_auth_options_ip"
		globalLimit, sourceLimit = passkeyOptionsGlobal, passkeyOptionsSource
	}
	start := now.UTC().Truncate(passkeyTrafficWindow)
	expires := start.Add(passkeyTrafficWindow)
	var globalDigest [32]byte
	count, until, err := countLimit(ctx, tx, globalScope, globalDigest[:], now, start, expires, globalLimit, false)
	if err != nil {
		return now, ErrUnavailable
	}
	if count > globalLimit {
		return now, passkeyRetry(until.Sub(now))
	}
	ipDigest := subjectDigest(p.rateLimitKey, sourceScope, source.Unmap().String())
	count, until, err = countLimit(ctx, tx, sourceScope, ipDigest, now, start, expires, sourceLimit, false)
	if err != nil {
		return now, ErrUnavailable
	}
	if count > sourceLimit {
		return now, passkeyRetry(until.Sub(now))
	}
	// The caller rolls back rejected admissions so a blocked source cannot drain the global budget.
	// 调用方回滚被拒绝的请求额度，避免已受限的来源耗尽全局额度。
	return now, nil
}

func prunePasskeyRateLimits(ctx context.Context, tx pgx.Tx, now time.Time) error {
	_, err := tx.Exec(ctx, `WITH expired AS (
		SELECT scope, subject_digest, window_start FROM auth_rate_limits
		WHERE expires_at <= $1 AND scope IN ('passkey_auth_options_global', 'passkey_auth_options_ip',
			'passkey_auth_verify_global', 'passkey_auth_verify_ip', 'passkey_auth_flow') FOR UPDATE SKIP LOCKED
	)
	DELETE FROM auth_rate_limits AS limits USING expired
	WHERE limits.scope = expired.scope AND limits.subject_digest = expired.subject_digest
		AND limits.window_start = expired.window_start`, now)
	if err != nil {
		return ErrUnavailable
	}
	return nil
}

// reservePasskeyAttempt commits the budget before assertion verification or its rollback.
// reservePasskeyAttempt 在断言验证或事务回滚前提交尝试额度。
func (p *Passkeys) reservePasskeyAttempt(ctx context.Context, source netip.Addr, flow []byte, flowID string) error {
	tx, err := p.beginAuthentication(ctx, source)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	now, err := p.admitPasskeyTraffic(ctx, tx, source, false)
	if err != nil {
		return err
	}
	if err := prunePasskeyRateLimits(ctx, tx, now); err != nil {
		return err
	}
	var start, expires time.Time
	err = tx.QueryRow(ctx, `SELECT created_at, expires_at FROM passkey_challenges
		WHERE flow_id = $1 AND kind = 'authentication' AND rp_id = $2 AND origin = $3
		AND ceremony_version = $4 AND expires_at > clock_timestamp() AND consumed_at IS NULL`,
		flow, p.rpID, p.origin, passkeyCeremonyVersion).Scan(&start, &expires)
	var result error
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		result = ErrPasskeyInvalidAuthentication
	case err != nil:
		return ErrUnavailable
	default:
		const scope = "passkey_auth_flow"
		digest := subjectDigest(p.rateLimitKey, scope, flowID)
		count, until, err := countLimit(ctx, tx, scope, digest, now, start, expires, passkeyFlowAttempts, false)
		if err != nil {
			return ErrUnavailable
		}
		if count > passkeyFlowAttempts {
			result = passkeyRetry(until.Sub(now))
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return ErrUnavailable
	}
	return result
}
