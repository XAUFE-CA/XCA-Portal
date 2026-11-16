//go:build integration

package testdb

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// New creates a dedicated database and registers cleanup on the test.
// New 创建独立数据库并为测试注册清理操作。
func New(t *testing.T) string {
	t.Helper()
	raw := os.Getenv("XCA_TEST_DATABASE_URL")
	u, err := url.Parse(raw)
	if err != nil || u == nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Host == "" || u.Path != "/xca_test_admin" || u.Query().Has("dbname") || u.Query().Has("database") || u.Query().Has("service") {
		t.Fatal("XCA_TEST_DATABASE_URL must be a PostgreSQL URL targeting xca_test_admin")
	}
	config, err := pgx.ParseConfig(raw)
	if err != nil || config.Database != "xca_test_admin" {
		t.Fatal("XCA_TEST_DATABASE_URL must target xca_test_admin")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	admin, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		t.Fatal("cannot connect to test admin database")
	}
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		_ = admin.Close(ctx)
		t.Fatal("cannot generate test database name")
	}
	name := "xca_test_" + hex.EncodeToString(random[:])
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{name}.Sanitize()); err != nil {
		_ = admin.Close(ctx)
		t.Fatal("cannot create isolated test database")
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		defer admin.Close(cleanupCtx)
		if _, err := admin.Exec(cleanupCtx, "DROP DATABASE "+pgx.Identifier{name}.Sanitize()+" WITH (FORCE)"); err != nil {
			t.Error("cannot drop isolated test database")
		}
	})
	u.Path = "/" + name
	dsn := u.String()
	isolated, err := pgx.ParseConfig(dsn)
	if err != nil || isolated.Database != name {
		t.Fatal("cannot construct isolated test database URL")
	}
	return dsn
}
