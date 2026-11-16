package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/config"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/invitation"
	"github.com/jackc/pgx/v5/pgxpool"
)

type options struct {
	action          string
	email           string
	login           string
	display         string
	id              string
	ttl             time.Duration
	allowProduction bool
}

func parseArgs(args []string) (options, error) {
	var opts options
	if len(args) == 0 || (args[0] != "create" && args[0] != "show" && args[0] != "revoke") {
		return opts, errors.New("usage: xcactl create|show|revoke [options]")
	}
	opts.action = args[0]
	flags := flag.NewFlagSet(opts.action, flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.BoolVar(&opts.allowProduction, "allow-production", false, "allow operation in production")
	if opts.action == "create" {
		flags.StringVar(&opts.email, "email", "", "invitation email")
		flags.StringVar(&opts.login, "login", "", "stable login name")
		flags.StringVar(&opts.display, "display-name", "", "display name")
		flags.DurationVar(&opts.ttl, "ttl", invitation.DefaultTTL, "invitation validity duration")
	} else {
		flags.StringVar(&opts.id, "id", "", "invitation UUID")
	}
	if err := flags.Parse(args[1:]); err != nil || flags.NArg() != 0 {
		return options{}, errors.New("invalid command options")
	}
	if (opts.action == "create" && (opts.email == "" || opts.login == "" || opts.display == "")) ||
		(opts.action != "create" && opts.id == "") {
		return options{}, errors.New("required command options are missing")
	}
	if opts.action == "create" && (opts.ttl < invitation.MinTTL || opts.ttl > invitation.MaxTTL || opts.ttl%time.Microsecond != 0) {
		return options{}, errors.New("invitation TTL must be between 1us and 8760h with microsecond precision")
	}
	return opts, nil
}

func main() {
	if err := run(context.Background(), os.Args[1:], os.LookupEnv, os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, lookup func(string) (string, bool), out, diagnostics io.Writer) error {
	opts, err := parseArgs(args)
	if err != nil {
		return err
	}
	cfg, err := config.Load(lookup)
	if err != nil {
		return err
	}
	if _, err = fmt.Fprintf(diagnostics, "APP_ENV=%s\n", cfg.Environment); err != nil {
		return errors.New("cannot write diagnostics")
	}
	if cfg.Environment == "production" && !opts.allowProduction {
		return errors.New("production requires --allow-production")
	}
	ctx, cancel := context.WithTimeout(ctx, cfg.DependencyTimeout)
	defer cancel()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return errors.New("database operation failed")
	}
	defer pool.Close()
	store := invitation.NewStore(pool)
	switch opts.action {
	case "create":
		created, token, err := store.Create(ctx, invitation.CreateInput{
			Email: opts.email, LoginName: opts.login, DisplayName: opts.display, TTL: opts.ttl,
		})
		if err != nil {
			return safeError(err)
		}
		if _, err := fmt.Fprintf(out, "id: %s\nemail: %s\nlogin: %s\ndisplay-name: %s\nexpires-at: %s\ntoken (shown once): %s\n",
			created.ID, created.Email, created.LoginName, created.DisplayName, created.ExpiresAt.UTC().Format(time.RFC3339), token); err != nil {
			return errors.New("cannot write invitation; token cannot be recovered")
		}
	case "show":
		item, err := store.Get(ctx, opts.id)
		if err != nil {
			return safeError(err)
		}
		if _, err := fmt.Fprintf(out, "id: %s\nemail: %s\nlogin: %s\ndisplay-name: %s\nstatus: %s\ncreated-at: %s\nexpires-at: %s\n",
			item.ID, item.Email, item.LoginName, item.DisplayName, item.Status,
			item.CreatedAt.UTC().Format(time.RFC3339), item.ExpiresAt.UTC().Format(time.RFC3339)); err != nil {
			return errors.New("cannot write invitation")
		}
	case "revoke":
		if err := store.Revoke(ctx, opts.id); err != nil {
			return safeError(err)
		}
		if _, err := fmt.Fprintln(out, "invitation revoked"); err != nil {
			return errors.New("cannot write result")
		}
	}
	return nil
}

func safeError(err error) error {
	switch {
	case errors.Is(err, invitation.ErrInvalidInput), errors.Is(err, invitation.ErrConflict),
		errors.Is(err, invitation.ErrNotFound), errors.Is(err, invitation.ErrNotRevocable):
		return err
	default:
		return errors.New("database operation failed")
	}
}
