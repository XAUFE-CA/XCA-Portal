package migrations

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	pgxmigrate "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

//go:embed *.sql
var files embed.FS

// maxFailureDetail bounds reported cause so a long SQL statement cannot flood the log.
// maxFailureDetail 限制报告的原因长度，避免长 SQL 语句淹没日志。
const maxFailureDetail = 400

// dsnCredentials matches a URL password segment that survived DSN replacement.
// dsnCredentials 匹配 DSN 替换后仍残留的 URL 密码段。
var dsnCredentials = regexp.MustCompile(`(?i)(postgres(?:ql)?://)[^@\s/]*@`)

// failure keeps the cause reachable while its message stays safe to print.
// failure 保留可判定的原因，同时保证其消息可安全输出。
type failure struct {
	msg string
	err error
}

func (f *failure) Error() string { return f.msg }
func (f *failure) Unwrap() error { return f.err }

// redact removes connection credentials so a failure can report its cause.
// redact 移除连接凭据，使失败可以报告原因。
func redact(err error, databaseURL string) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	if databaseURL != "" {
		message = strings.ReplaceAll(message, databaseURL, "<DATABASE_URL>")
		if parsed, parseErr := url.Parse(databaseURL); parseErr == nil && parsed.User != nil {
			if password, ok := parsed.User.Password(); ok && password != "" {
				message = strings.ReplaceAll(message, password, "<REDACTED>")
				message = strings.ReplaceAll(message, url.QueryEscape(password), "<REDACTED>")
			}
		}
	}
	message = dsnCredentials.ReplaceAllString(message, "$1<redacted>@")
	message = strings.Join(strings.Fields(message), " ")
	if runes := []rune(message); len(runes) > maxFailureDetail {
		message = string(runes[:maxFailureDetail]) + "…"
	}
	return message
}

func cause(prefix string, err error, databaseURL string) error {
	return &failure{msg: prefix + ": " + redact(err, databaseURL), err: err}
}

// Up applies every pending migration, serializing with other migration runners.
// Up 应用所有待执行迁移，并与其他迁移进程串行执行。
func Up(databaseURL string) error { return run(databaseURL, false) }

// Down rolls back one migration and may permanently delete data.
// Down 回滚一个迁移，可能永久删除数据。
func Down(databaseURL string) error { return run(databaseURL, true) }

func run(databaseURL string, down bool) error {
	if databaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	db, err := sql.Open("pgx/v5", databaseURL)
	if err != nil {
		return cause("cannot open migration database", err, databaseURL)
	}
	driver, err := pgxmigrate.WithInstance(db, &pgxmigrate.Config{})
	if err != nil {
		_ = db.Close()
		return cause("cannot initialize migration database", err, databaseURL)
	}
	source, err := iofs.New(files, ".")
	if err != nil {
		_ = driver.Close()
		return cause("cannot initialize migration source", err, databaseURL)
	}
	m, err := migrate.NewWithInstance("iofs", source, "postgres", driver)
	if err != nil {
		_ = source.Close()
		_ = driver.Close()
		return cause("cannot initialize migration runner", err, databaseURL)
	}
	defer m.Close()
	if down {
		err = m.Steps(-1)
	} else {
		err = m.Up()
	}
	if err == nil || errors.Is(err, migrate.ErrNoChange) || (down && err == os.ErrNotExist) {
		return nil
	}
	var dirty migrate.ErrDirty
	if errors.As(err, &dirty) {
		return &failure{msg: fmt.Sprintf("database migration is dirty at version %d; inspect and repair the schema before resetting the version", dirty.Version), err: err}
	}
	if errors.Is(err, migrate.ErrLockTimeout) {
		return cause("timed out waiting for migration lock", err, databaseURL)
	}
	return cause("migration failed; inspect database state before retrying", err, databaseURL)
}
