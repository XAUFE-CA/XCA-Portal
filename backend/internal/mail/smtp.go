package mail

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"mime"
	"net"
	stdmail "net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/config"
)

type Message struct {
	To        string
	Code      string
	ExpiresIn time.Duration
}

type Sender interface {
	Send(context.Context, Message) error
}

type SMTP struct {
	host     string
	address  string
	from     string
	username string
	password string
	mode     string
	timeout  time.Duration
	dial     func(context.Context, string, string) (net.Conn, error)
}

// NewSMTP constructs a transport that never falls back from configured TLS.
// NewSMTP 构造不会从已配置的 TLS 降级的传输器。
func NewSMTP(c config.Config) (*SMTP, error) {
	if c.SMTPHost == "" || c.SMTPPort < 1 || c.SMTPPort > 65535 ||
		(c.SMTPTLSMode != "none" && c.SMTPTLSMode != "starttls" && c.SMTPTLSMode != "implicit") ||
		(c.SMTPUsername == "") != (c.SMTPPassword == "") ||
		(c.SMTPTLSMode == "none" && (c.Environment == "production" || c.SMTPUsername != "")) {
		return nil, errors.New("invalid SMTP configuration")
	}
	from, err := stdmail.ParseAddress(c.MailFrom)
	if err != nil || from.Address != c.MailFrom {
		return nil, errors.New("invalid SMTP sender")
	}
	timeout := c.DependencyTimeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	return &SMTP{
		host: c.SMTPHost, address: net.JoinHostPort(c.SMTPHost, strconv.Itoa(c.SMTPPort)),
		from: c.MailFrom, username: c.SMTPUsername, password: c.SMTPPassword,
		mode: c.SMTPTLSMode, timeout: timeout, dial: (&net.Dialer{}).DialContext,
	}, nil
}

// Send delivers one verification code without exposing SMTP responses in errors.
// Send 发送一个验证码，且不会在错误中暴露 SMTP 响应。
func (s *SMTP) Send(ctx context.Context, message Message) error {
	to, err := stdmail.ParseAddress(message.To)
	if err != nil || to.Address != message.To || message.Code == "" || message.ExpiresIn <= 0 || strings.IndexFunc(message.Code, unicode.IsControl) >= 0 {
		return errors.New("invalid mail message")
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	conn, err := s.dial(ctx, "tcp", s.address)
	if err != nil {
		return sendError(ctx, "SMTP connection failed")
	}
	defer conn.Close()
	rawConn := conn
	stop := context.AfterFunc(ctx, func() { _ = rawConn.Close() })
	defer stop()
	deadline, _ := ctx.Deadline()
	if err = conn.SetDeadline(deadline); err != nil {
		return sendError(ctx, "SMTP connection failed")
	}
	tlsConfig := &tls.Config{ServerName: s.host, MinVersion: tls.VersionTLS12}
	if s.mode == "implicit" {
		secure := tls.Client(conn, tlsConfig)
		if err = secure.HandshakeContext(ctx); err != nil {
			return sendError(ctx, "SMTP TLS failed")
		}
		conn = secure
	}
	client, err := smtp.NewClient(conn, s.host)
	if err != nil {
		return sendError(ctx, "SMTP connection failed")
	}
	defer client.Close()
	if s.mode == "starttls" {
		if err = client.StartTLS(tlsConfig); err != nil {
			return sendError(ctx, "SMTP TLS failed")
		}
	}
	if s.username != "" {
		if err = client.Auth(smtp.PlainAuth("", s.username, s.password, s.host)); err != nil {
			return sendError(ctx, "SMTP authentication failed")
		}
	}
	if err = client.Mail(s.from); err != nil {
		return sendError(ctx, "SMTP delivery failed")
	}
	if err = client.Rcpt(message.To); err != nil {
		return sendError(ctx, "SMTP delivery failed")
	}
	writer, err := client.Data()
	if err != nil {
		return sendError(ctx, "SMTP delivery failed")
	}
	amount := message.ExpiresIn / time.Second
	chineseUnit, englishUnit := "秒", "seconds"
	if message.ExpiresIn%time.Minute == 0 {
		amount = message.ExpiresIn / time.Minute
		chineseUnit, englishUnit = "分钟", "minutes"
	}
	body := fmt.Sprintf("您的验证码：%s\r\n验证码有效期：%d %s\r\n\r\nYour verification code: %s\r\nIt expires in %d %s.\r\n", message.Code, amount, chineseUnit, message.Code, amount, englishUnit)
	content := "From: " + s.from + "\r\nTo: " + message.To + "\r\nSubject: " + mime.QEncoding.Encode("UTF-8", "XCA 验证码 / verification code") + "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" + wrapBase64(base64.StdEncoding.EncodeToString([]byte(body)))
	if _, err = writer.Write([]byte(content)); err != nil {
		return sendError(ctx, "SMTP delivery failed")
	}
	if err = writer.Close(); err != nil {
		return sendError(ctx, "SMTP delivery failed")
	}
	return nil
}

func sendError(ctx context.Context, message string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return errors.New(message)
}

func wrapBase64(s string) string {
	var b strings.Builder
	for len(s) > 76 {
		b.WriteString(s[:76])
		b.WriteString("\r\n")
		s = s[76:]
	}
	b.WriteString(s)
	b.WriteString("\r\n")
	return b.String()
}
