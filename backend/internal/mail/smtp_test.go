package mail

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/config"
)

func testConfig() config.Config {
	return config.Config{
		Environment: "test", SMTPHost: "smtp.example.com", SMTPPort: 587,
		SMTPTLSMode: "none", MailFrom: "sender@example.com", DependencyTimeout: time.Second,
	}
}

func testMessage() Message {
	return Message{To: "recipient@example.com", Code: "123456", ExpiresIn: 5 * time.Minute}
}

func pipeSMTP(t *testing.T, c config.Config, serve func(net.Conn)) *SMTP {
	t.Helper()
	s, err := NewSMTP(c)
	if err != nil {
		t.Fatal(err)
	}
	s.dial = func(context.Context, string, string) (net.Conn, error) {
		client, server := net.Pipe()
		go func() {
			defer server.Close()
			serve(server)
		}()
		return client, nil
	}
	return s
}

func TestSMTPRejectsInsecureConfiguration(t *testing.T) {
	c := testConfig()
	c.Environment = "production"
	if _, err := NewSMTP(c); err == nil {
		t.Fatal("production plaintext transport accepted")
	}
	c.Environment = "test"
	c.SMTPUsername, c.SMTPPassword = "user", "secret"
	if _, err := NewSMTP(c); err == nil {
		t.Fatal("plaintext credentials accepted")
	}
}

func TestSMTPStartTLSRequiresExtension(t *testing.T) {
	c := testConfig()
	c.SMTPTLSMode = "starttls"
	s := pipeSMTP(t, c, func(conn net.Conn) {
		fmt.Fprint(conn, "220 ready\r\n")
		r := bufio.NewReader(conn)
		_, _ = r.ReadString('\n')
		fmt.Fprint(conn, "250 server\r\n")
	})
	if err := s.Send(context.Background(), testMessage()); err == nil || err.Error() != "SMTP TLS failed" {
		t.Fatalf("expected TLS failure, got %v", err)
	}
}

func TestSMTPImplicitTLSRejectsPlaintext(t *testing.T) {
	c := testConfig()
	c.SMTPTLSMode = "implicit"
	s := pipeSMTP(t, c, func(conn net.Conn) {
		var header [5]byte
		if _, err := io.ReadFull(conn, header[:]); err != nil {
			return
		}
		if _, err := io.CopyN(io.Discard, conn, int64(binary.BigEndian.Uint16(header[3:]))); err != nil {
			return
		}
		_, _ = conn.Write([]byte("220 plaintext server\r\n"))
	})
	if err := s.Send(context.Background(), testMessage()); err == nil || err.Error() != "SMTP TLS failed" {
		t.Fatalf("expected TLS failure, got %v", err)
	}
}

func TestSMTPCancellationDuringGreeting(t *testing.T) {
	connected := make(chan struct{})
	s := pipeSMTP(t, testConfig(), func(conn net.Conn) {
		close(connected)
		var b [1]byte
		_, _ = conn.Read(b[:])
	})
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() { result <- s.Send(ctx, testMessage()) }()
	<-connected
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("expected cancellation, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("cancellation did not interrupt SMTP")
	}
}

func TestSMTPCancellationDuringDial(t *testing.T) {
	s, err := NewSMTP(testConfig())
	if err != nil {
		t.Fatal(err)
	}
	s.dial = func(ctx context.Context, _, _ string) (net.Conn, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := s.Send(ctx, testMessage()); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation, got %v", err)
	}
}

func TestSMTPSanitizesServerError(t *testing.T) {
	s := pipeSMTP(t, testConfig(), func(conn net.Conn) {
		fmt.Fprint(conn, "220 ready\r\n")
		r := bufio.NewReader(conn)
		_, _ = r.ReadString('\n')
		fmt.Fprint(conn, "250 server\r\n")
		_, _ = r.ReadString('\n')
		fmt.Fprint(conn, "550 secret 123456 recipient@example.com\r\n")
	})
	err := s.Send(context.Background(), testMessage())
	if err == nil || err.Error() != "SMTP delivery failed" || strings.Contains(err.Error(), "123456") {
		t.Fatal("SMTP failure was not sanitized")
	}
}

func TestSMTPRejectsUntrustedCertificate(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1), DNSNames: []string{"smtp.example.com"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	c := testConfig()
	c.SMTPTLSMode = "implicit"
	s := pipeSMTP(t, c, func(conn net.Conn) {
		server := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}, MinVersion: tls.VersionTLS12})
		_ = server.Handshake()
	})
	if err := s.Send(context.Background(), testMessage()); err == nil || err.Error() != "SMTP TLS failed" {
		t.Fatalf("expected certificate rejection, got %v", err)
	}
}

func TestSMTPDeliversBilingualCode(t *testing.T) {
	data := make(chan string, 1)
	s := pipeSMTP(t, testConfig(), func(conn net.Conn) {
		fmt.Fprint(conn, "220 ready\r\n")
		r := bufio.NewReader(conn)
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				return
			}
			switch {
			case strings.HasPrefix(line, "EHLO "):
				fmt.Fprint(conn, "250 server\r\n")
			case strings.HasPrefix(line, "MAIL FROM:"), strings.HasPrefix(line, "RCPT TO:"):
				fmt.Fprint(conn, "250 ok\r\n")
			case line == "DATA\r\n":
				fmt.Fprint(conn, "354 continue\r\n")
				var content strings.Builder
				for {
					line, err = r.ReadString('\n')
					if err != nil {
						return
					}
					if line == ".\r\n" {
						break
					}
					content.WriteString(line)
				}
				data <- content.String()
				fmt.Fprint(conn, "250 accepted\r\n")
				return
			default:
				return
			}
		}
	})
	if err := s.Send(context.Background(), testMessage()); err != nil {
		t.Fatal(err)
	}
	content := <-data
	parts := strings.SplitN(content, "\r\n\r\n", 2)
	if len(parts) != 2 {
		t.Fatal("missing mail body")
	}
	body, err := io.ReadAll(base64.NewDecoder(base64.StdEncoding, strings.NewReader(parts[1])))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"验证码", "verification code", "123456", "5 分钟", "5 minutes"} {
		if !strings.Contains(string(body), want) {
			t.Fatal("mail body missing required content")
		}
	}
}
