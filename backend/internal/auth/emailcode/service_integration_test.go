//go:build integration

package emailcode

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth/ratelimit"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/config"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/invitation"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/mail"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/testdb"
	"github.com/XAUFE-CA/XCA-Portal/backend/migrations"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var codePattern = regexp.MustCompile(`\b[0-9]{6}\b`)

type integrationEnv struct {
	pool   *pgxpool.Pool
	cfg    config.Config
	sender mail.Sender
	svc    *Service
}

func setupIntegration(t *testing.T) *integrationEnv {
	t.Helper()
	dsn := testdb.New(t)
	if err := migrations.Up(dsn); err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal("cannot open isolated test database")
	}
	t.Cleanup(pool.Close)
	host, port, err := net.SplitHostPort(os.Getenv("XCA_TEST_SMTP_ADDR"))
	if err != nil || host != "127.0.0.1" {
		t.Fatal("XCA_TEST_SMTP_ADDR must identify the loopback test SMTP server")
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil {
		t.Fatal("invalid test SMTP port")
	}
	cfg := config.Config{
		Environment: "test", SMTPHost: host, SMTPPort: portNumber, SMTPTLSMode: "none", MailFrom: "xca@example.invalid",
		DependencyTimeout: 5 * time.Second, OTPKeyVersion: 1,
		OTPHMACKey: []byte("0123456789abcdef0123456789abcdef"), RateLimitHMACKey: []byte("fedcba9876543210fedcba9876543210"),
	}
	sender, err := mail.NewSMTP(cfg)
	if err != nil {
		t.Fatal(err)
	}
	svc, err := New(context.Background(), pool, cfg, sender, nil, 128)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(svc.Close)
	return &integrationEnv{pool: pool, cfg: cfg, sender: sender, svc: svc}
}

func testEmail(t *testing.T) string {
	t.Helper()
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(b[:]) + "@example.invalid"
}

func poll(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(30 * time.Millisecond)
	}
	t.Fatal("timed out waiting for test condition")
}

func mailpitMessage(t *testing.T, email, exceptID string) (string, string) {
	t.Helper()
	base := os.Getenv("XCA_TEST_MAILPIT_URL")
	parsed, err := url.Parse(base)
	if err != nil || parsed.Scheme != "http" || parsed.Hostname() != "127.0.0.1" {
		t.Fatal("XCA_TEST_MAILPIT_URL must identify the loopback test Mailpit")
	}
	client := &http.Client{Timeout: 2 * time.Second}
	var id, code string
	poll(t, func() bool {
		response, err := client.Get(base + "/api/v1/messages?limit=100")
		if err != nil {
			return false
		}
		var list struct {
			Messages []struct {
				ID string
				To []struct{ Address string }
			}
		}
		err = json.NewDecoder(response.Body).Decode(&list)
		_ = response.Body.Close()
		if err != nil || response.StatusCode != http.StatusOK {
			return false
		}
		for _, message := range list.Messages {
			if message.ID == exceptID {
				continue
			}
			for _, to := range message.To {
				if to.Address == email {
					id = message.ID
				}
			}
			if id != "" {
				break
			}
		}
		if id == "" {
			return false
		}
		response, err = client.Get(base + "/api/v1/message/" + url.PathEscape(id))
		if err != nil {
			return false
		}
		var message struct{ Text string }
		err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&message)
		_ = response.Body.Close()
		if err != nil || response.StatusCode != http.StatusOK {
			return false
		}
		code = codePattern.FindString(message.Text)
		return code != "" && strings.Contains(message.Text, "10 分钟") && strings.Contains(message.Text, "10 minutes") && strings.Contains(message.Text, "verification code")
	})
	return id, code
}

func waitDelivered(t *testing.T, pool *pgxpool.Pool, flow string) {
	t.Helper()
	poll(t, func() bool {
		var delivered bool
		err := pool.QueryRow(context.Background(), `SELECT delivered_at IS NOT NULL FROM email_challenges WHERE flow_id = $1`, flow).Scan(&delivered)
		return err == nil && delivered
	})
}

func createInvitation(t *testing.T, env *integrationEnv, email, login string) (invitation.Invitation, string) {
	t.Helper()
	item, token, err := invitation.NewStore(env.pool).Create(context.Background(), invitation.CreateInput{Email: email, LoginName: login, DisplayName: "测试成员"})
	if err != nil {
		t.Fatal(err)
	}
	return item, token
}

func request(t *testing.T, service *Service, email, token, ip string) Challenge {
	t.Helper()
	challenge, err := service.Request(context.Background(), email, token, netip.MustParseAddr(ip))
	if err != nil {
		t.Fatal(err)
	}
	return challenge
}

func acceptVerification(_ context.Context, _ pgx.Tx, _ auth.Identity) error { return nil }

func TestMailpitInvitationAndTransactionalActivation(t *testing.T) {
	env := setupIntegration(t)
	email := testEmail(t)
	item, token := createInvitation(t, env, email, "member-one")
	flow := request(t, env.svc, email, token, "192.0.2.1")
	_, code := mailpitMessage(t, email, "")
	waitDelivered(t, env.pool, flow.FlowID)
	if delta := time.Until(flow.ExpiresAt); delta <= 9*time.Minute || delta > challengeTTL {
		t.Fatal("incorrect challenge expiry")
	}
	failed := env.svc.WithVerifiedChallenge(context.Background(), flow.FlowID, code, func(context.Context, pgx.Tx, auth.Identity) error {
		return errors.New("session transaction failed")
	})
	if !errors.Is(failed, auth.ErrUnavailable) {
		t.Fatal("session failure did not reject activation")
	}
	var users int
	var used *time.Time
	if err := env.pool.QueryRow(context.Background(), `SELECT count(*) FROM users WHERE email = $1`, email).Scan(&users); err != nil || users != 0 {
		t.Fatal("failed session operation left a user")
	}
	if err := env.pool.QueryRow(context.Background(), `SELECT used_at FROM invitations WHERE id = $1`, item.ID).Scan(&used); err != nil || used != nil {
		t.Fatal("failed session operation consumed invitation")
	}
	var identity auth.Identity
	err := env.svc.WithVerifiedChallenge(context.Background(), flow.FlowID, code, func(_ context.Context, _ pgx.Tx, got auth.Identity) error {
		identity = got
		return nil
	})
	if err != nil || identity.LoginName != "member-one" || identity.DisplayName != "测试成员" || identity.UserID == "" {
		t.Fatalf("internal activation failed: %v", err)
	}
	if err := env.svc.WithVerifiedChallenge(context.Background(), flow.FlowID, code, acceptVerification); !errors.Is(err, ErrInvalidCode) {
		t.Fatal("replayed flow accepted")
	}
	if err := invitation.NewStore(env.pool).Revoke(context.Background(), item.ID); !errors.Is(err, invitation.ErrNotRevocable) {
		t.Fatal("used invitation could be revoked")
	}
}

func TestResendInvalidatesPreviousFlow(t *testing.T) {
	env := setupIntegration(t)
	email := testEmail(t)
	_, token := createInvitation(t, env, email, "member-two")
	first := request(t, env.svc, email, token, "192.0.2.2")
	firstID, firstCode := mailpitMessage(t, email, "")
	waitDelivered(t, env.pool, first.FlowID)
	_, err := env.svc.Request(context.Background(), email, token, netip.MustParseAddr("192.0.2.2"))
	var limited *ratelimit.Error
	if !errors.As(err, &limited) || limited.RetryAfterSeconds < 1 || limited.RetryAfterSeconds > 60 {
		t.Fatal("resend cooldown not enforced")
	}
	if _, err := env.pool.Exec(context.Background(), `UPDATE auth_rate_limits SET expires_at = clock_timestamp() - interval '1 second' WHERE scope = 'email_cooldown'`); err != nil {
		t.Fatal(err)
	}
	second := request(t, env.svc, email, token, "192.0.2.2")
	_, secondCode := mailpitMessage(t, email, firstID)
	waitDelivered(t, env.pool, second.FlowID)
	if err := env.svc.WithVerifiedChallenge(context.Background(), first.FlowID, firstCode, acceptVerification); !errors.Is(err, ErrInvalidCode) {
		t.Fatal("resending did not invalidate previous flow")
	}
	if err := env.svc.WithVerifiedChallenge(context.Background(), second.FlowID, secondCode, acceptVerification); err != nil {
		t.Fatalf("new flow did not verify: %v", err)
	}
}

func TestIneligibleFlowsDoNotAuthenticateOrSend(t *testing.T) {
	env := setupIntegration(t)
	ctx := context.Background()
	disabled := testEmail(t)
	if _, err := env.pool.Exec(ctx, `INSERT INTO users (email, login_name, display_name, status) VALUES ($1, 'disabled-user', 'Disabled', 'disabled')`, disabled); err != nil {
		t.Fatal(err)
	}
	unknown := testEmail(t)
	invited := testEmail(t)
	_, _ = createInvitation(t, env, invited, "member-three")
	for index, tc := range []struct{ email, token string }{{unknown, ""}, {disabled, ""}, {invited, "invalid-token"}} {
		flow := request(t, env.svc, tc.email, tc.token, fmt.Sprintf("192.0.2.%d", 10+index))
		if !validFlow(flow.FlowID) || time.Until(flow.ExpiresAt) <= 9*time.Minute {
			t.Fatal("invalid opaque flow")
		}
		if err := env.svc.WithVerifiedChallenge(ctx, flow.FlowID, "000000", acceptVerification); !errors.Is(err, ErrInvalidCode) {
			t.Fatal("ineligible flow authenticated")
		}
		var delivered bool
		if err := env.pool.QueryRow(ctx, `SELECT delivered_at IS NOT NULL FROM email_challenges WHERE flow_id = $1`, flow.FlowID).Scan(&delivered); err != nil || delivered {
			t.Fatal("ineligible flow became deliverable")
		}
	}
	base, err := url.Parse(os.Getenv("XCA_TEST_MAILPIT_URL"))
	if err != nil || base.Scheme != "http" || base.Hostname() != "127.0.0.1" {
		t.Fatal("XCA_TEST_MAILPIT_URL must identify the loopback test Mailpit")
	}
	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Get(base.String() + "/api/v1/messages?limit=100")
	if err != nil {
		t.Fatal("cannot inspect test mail")
	}
	defer response.Body.Close()
	var list struct {
		Messages []struct {
			To []struct{ Address string }
		}
	}
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&list) != nil {
		t.Fatal("cannot inspect test mail")
	}
	for _, message := range list.Messages {
		for _, recipient := range message.To {
			if recipient.Address == unknown || recipient.Address == disabled || recipient.Address == invited {
				t.Fatal("ineligible flow sent mail")
			}
		}
	}
	if _, err := env.svc.Request(ctx, "bad email", "", netip.MustParseAddr("192.0.2.50")); !errors.Is(err, auth.ErrInvalidRequest) {
		t.Fatal("invalid address accepted")
	}
}
