package migrations

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"os"

	"github.com/golang-migrate/migrate/v4"
	pgxmigrate "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

//go:embed *.sql
var files embed.FS

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
		return errors.New("cannot open migration database")
	}
	driver, err := pgxmigrate.WithInstance(db, &pgxmigrate.Config{})
	if err != nil {
		_ = db.Close()
		return errors.New("cannot initialize migration database")
	}
	source, err := iofs.New(files, ".")
	if err != nil {
		_ = driver.Close()
		return errors.New("cannot initialize migration source")
	}
	m, err := migrate.NewWithInstance("iofs", source, "postgres", driver)
	if err != nil {
		_ = source.Close()
		_ = driver.Close()
		return errors.New("cannot initialize migration runner")
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
		return fmt.Errorf("database migration is dirty at version %d; inspect and repair the schema before resetting the version", dirty.Version)
	}
	if errors.Is(err, migrate.ErrLockTimeout) {
		return errors.New("timed out waiting for migration lock")
	}
	return errors.New("migration failed; inspect database state before retrying")
}
