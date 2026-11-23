package emailcode

import (
	"context"
	"crypto/sha256"
	"errors"
	"log/slog"
	"net/netip"
	"sync"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/ratelimit"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/config"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/invitation"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/mail"
	"github.com/jackc/pgx/v5/pgxpool"
)

const challengeTTL = 10 * time.Minute

var ErrInvalidCode = errors.New("invalid_or_expired_code")

type Challenge struct {
	FlowID    string
	ExpiresAt time.Time
}

type Service struct {
	pool       *pgxpool.Pool
	sender     mail.Sender
	logger     *slog.Logger
	keys       map[int][]byte
	keyVersion int
	rateKey    []byte
	ctx        context.Context
	cancel     context.CancelFunc
	mu         sync.Mutex
	closed     bool
	work       sync.WaitGroup
	slots      chan struct{}
}

// New creates an internal service and refuses to start when a live challenge key is missing.
// New 创建内部服务，缺少有效验证码流程所需密钥时拒绝启动。
func New(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, sender mail.Sender, logger *slog.Logger, capacity int) (*Service, error) {
	if pool == nil || sender == nil || capacity < 1 || cfg.OTPKeyVersion < 1 || len(cfg.OTPHMACKey) < 32 || len(cfg.RateLimitHMACKey) < 32 {
		return nil, auth.ErrUnavailable
	}
	keys := make(map[int][]byte, len(cfg.OTPPreviousKeys)+1)
	keys[cfg.OTPKeyVersion] = append([]byte(nil), cfg.OTPHMACKey...)
	for version, key := range cfg.OTPPreviousKeys {
		if version < 1 || len(key) < 32 || version == cfg.OTPKeyVersion {
			return nil, auth.ErrUnavailable
		}
		keys[version] = append([]byte(nil), key...)
	}
	rows, err := pool.Query(ctx, `SELECT DISTINCT key_version FROM email_challenges WHERE used_at IS NULL AND expires_at > clock_timestamp()`)
	if err != nil {
		return nil, auth.ErrUnavailable
	}
	for rows.Next() {
		var version int
		if rows.Scan(&version) != nil || keys[version] == nil {
			rows.Close()
			return nil, auth.ErrUnavailable
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, auth.ErrUnavailable
	}
	serviceCtx, cancel := context.WithCancel(context.Background())
	return &Service{
		pool: pool, sender: sender, logger: logger, keys: keys, keyVersion: cfg.OTPKeyVersion,
		rateKey: append([]byte(nil), cfg.RateLimitHMACKey...), ctx: serviceCtx, cancel: cancel,
		slots: make(chan struct{}, capacity),
	}, nil
}

func (s *Service) reserve() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return false
	}
	select {
	case s.slots <- struct{}{}:
		s.work.Add(1)
		return true
	default:
		return false
	}
}

func (s *Service) release() {
	<-s.slots
	s.work.Done()
}

// Close cancels delivery and waits for admitted work to finish.
// Close 取消投递并等待已接纳的任务结束。
func (s *Service) Close() {
	s.mu.Lock()
	if !s.closed {
		s.closed = true
		s.cancel()
	}
	s.mu.Unlock()
	s.work.Wait()
}

// Request creates an opaque flow without revealing whether the account or invitation is eligible or waiting for SMTP.
// Request 创建不暴露账户与邀请是否可用的流程，并且不等待 SMTP。
func (s *Service) Request(ctx context.Context, email, invitationToken string, ip netip.Addr) (Challenge, error) {
	email, err := invitation.NormalizeEmail(email)
	if err != nil || !ip.IsValid() || len(invitationToken) > 512 {
		return Challenge{}, auth.ErrInvalidRequest
	}
	if !s.reserve() {
		return Challenge{}, auth.ErrUnavailable
	}
	owned := true
	defer func() {
		if owned {
			s.release()
		}
	}()
	flow, err := newFlowID()
	if err != nil {
		return Challenge{}, auth.ErrUnavailable
	}
	code, err := newCode()
	if err != nil {
		return Challenge{}, auth.ErrUnavailable
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Challenge{}, auth.ErrUnavailable
	}
	defer tx.Rollback(context.Background())
	ipDigest := ratelimit.SubjectDigest(s.rateKey, "ip", ip.Unmap().String())
	emailDigest := ratelimit.SubjectDigest(s.rateKey, "email", email)
	cooldownDigest := ratelimit.SubjectDigest(s.rateKey, "email_cooldown", email)
	if err := lockLimitSubjects(ctx, tx, ipDigest, emailDigest); err != nil {
		return Challenge{}, auth.ErrUnavailable
	}
	var now time.Time
	if err := tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return Challenge{}, auth.ErrUnavailable
	}
	retry, err := s.applyLimits(ctx, tx, ipDigest, emailDigest, cooldownDigest, now)
	if err != nil {
		return Challenge{}, auth.ErrUnavailable
	}
	if retry > 0 {
		if tx.Commit(ctx) != nil {
			return Challenge{}, auth.ErrUnavailable
		}
		return Challenge{}, &ratelimit.Error{RetryAfterSeconds: int((retry + time.Second - 1) / time.Second)}
	}
	var userID, invitationID *string
	tokenDigest := sha256.Sum256([]byte(invitationToken))
	err = tx.QueryRow(ctx, `
		SELECT
			(SELECT id::text FROM users WHERE email = $1 AND status = 'active' AND NOT $3),
			(SELECT id::text FROM invitations WHERE email = $1 AND token_digest = $2 AND $3
			 AND active_slot AND revoked_at IS NULL AND used_at IS NULL AND expires_at > $4)`,
		email, tokenDigest[:], invitationToken != "", now).Scan(&userID, &invitationID)
	if err != nil {
		return Challenge{}, auth.ErrUnavailable
	}
	if _, err := tx.Exec(ctx, `UPDATE email_challenges SET used_at = $2 WHERE email = $1 AND used_at IS NULL`, email, now); err != nil {
		return Challenge{}, auth.ErrUnavailable
	}
	expires := now.Add(challengeTTL)
	_, err = tx.Exec(ctx, `
		INSERT INTO email_challenges (flow_id, email, otp_digest, key_version, invitation_id, user_id, expires_at, created_at)
		VALUES ($1, $2, $3, $4, $5::uuid, $6::uuid, $7, $8)`,
		flow, email, signOTP(s.keys[s.keyVersion], flow, code), s.keyVersion, invitationID, userID, expires, now)
	if err != nil || tx.Commit(ctx) != nil {
		return Challenge{}, auth.ErrUnavailable
	}
	owned = false
	go s.deliver(flow, email, code, userID != nil || invitationID != nil)
	return Challenge{FlowID: flow, ExpiresAt: expires.UTC()}, nil
}

func (s *Service) deliver(flow, email, code string, eligible bool) {
	defer s.release()
	ctx, cancel := context.WithTimeout(s.ctx, 15*time.Second)
	defer cancel()
	if eligible {
		if err := s.sender.Send(ctx, mail.Message{To: email, Code: code, ExpiresIn: challengeTTL}); err != nil {
			if s.logger != nil {
				s.logger.Error("email delivery failed")
			}
		} else if _, err := s.pool.Exec(ctx, `UPDATE email_challenges SET delivered_at = clock_timestamp() WHERE flow_id = $1 AND used_at IS NULL AND expires_at > clock_timestamp()`, flow); err != nil && s.logger != nil {
			s.logger.Error("email delivery confirmation failed")
		}
	}
	<-ctx.Done()
}
