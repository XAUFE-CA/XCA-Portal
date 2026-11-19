package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/XAUFE-CA/XCA-Portal/backend/internal/auth"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/config"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/httpapi"
	"github.com/XAUFE-CA/XCA-Portal/backend/internal/mail"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	if err := run(logger); err != nil {
		logger.Error("API stopped", "reason", err.Error())
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := config.Load(os.LookupEnv)
	if err != nil {
		return err
	}
	pool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		return errors.New("invalid database connection configuration")
	}
	defer pool.Close()

	sender, err := mail.NewSMTP(cfg)
	if err != nil {
		return err
	}
	service, err := auth.New(context.Background(), pool, cfg, sender, logger, 64)
	if err != nil {
		return err
	}
	defer service.Close()

	readHeaderTimeout := min(cfg.ReadTimeout, 5*time.Second)
	server := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           httpapi.NewAuthHandler(pool, service, cfg),
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
		IdleTimeout:       cfg.IdleTimeout,
		MaxHeaderBytes:    1 << 20,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelError),
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	listener, err := net.Listen("tcp", cfg.ListenAddr)
	if err != nil {
		return errors.New("HTTP listener failed")
	}
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()
	logger.Info("API listening")
	select {
	case err := <-served:
		if !errors.Is(err, http.ErrServerClosed) {
			return errors.New("HTTP listener failed")
		}
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			_ = server.Close()
			return errors.New("HTTP shutdown timed out")
		}
		if err := <-served; err != nil && !errors.Is(err, http.ErrServerClosed) {
			return errors.New("HTTP listener failed")
		}
	}
	logger.Info("API stopped")
	return nil
}
