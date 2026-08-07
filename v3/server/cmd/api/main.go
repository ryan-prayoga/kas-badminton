// cmd/api adalah HTTP server utama v3 — satu binary yang menyajikan API
// (mulai F2) dan SPA statis yang di-embed (PLAN.md §4).
package main

import (
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/config"
	httpapi "github.com/ryan-prayoga/kas-badminton/v3/server/internal/http"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/logging"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/notify"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/realtime"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/webassets"
)

func main() {
	if err := run(); err != nil {
		slog.Error("server berhenti dengan galat", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger := logging.New(cfg.Env, cfg.LogLevel)
	logger.Info("konfigurasi dimuat", "env", cfg.Env, "port", cfg.Port)

	// F0: notifier cuma dipakai buat bukti Notifier interface sudah bisa
	// dipasang di server; F4 memanggilnya sungguhan dari alur OTP.
	var notifier notify.Notifier = notify.NewFake(logger)
	_ = notifier

	// Graceful shutdown: SIGINT (Ctrl-C lokal) dan SIGTERM (docker stop /
	// systemd) berhenti menerima koneksi baru, tunggu request berjalan
	// selesai, baru keluar. ctx yang sama menghentikan goroutine LISTEN
	// realtime.Bus.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return err
	}
	logger.Info("koneksi database ok")

	s := store.New(pool)
	bus := realtime.NewBus(ctx, cfg.DatabaseURL, logger)

	router, err := newRouter(logger, s, bus, cfg.IsDev())
	if err != nil {
		return err
	}

	srv := &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.Port),
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("server jalan", "addr", srv.Addr)
		serveErr <- srv.ListenAndServe()
	}()

	select {
	case err := <-serveErr:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		logger.Info("sinyal berhenti diterima, mematikan server dengan halus")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return err
		}
	}

	logger.Info("server berhenti bersih")
	return nil
}

func newRouter(logger *slog.Logger, s *store.Store, bus *realtime.Bus, isDev bool) (http.Handler, error) {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(slogRequestLogger(logger))
	r.Use(middleware.Recoverer)

	r.Get("/healthz", healthHandler)
	httpapi.Mount(r, s, bus, isDev)

	spa, err := spaHandler()
	if err != nil {
		return nil, err
	}
	r.NotFound(spa.ServeHTTP)
	r.Handle("/*", spa)

	return r, nil
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}

// spaHandler menyajikan SPA statis yang di-embed. NotFound jatuh ke
// index.html supaya routing client-side SvelteKit (adapter-static, fallback
// mode) bisa menangani path yang tidak match berkas fisik.
func spaHandler() (http.Handler, error) {
	root, err := fs.Sub(webassets.Dist, webassets.DistDir)
	if err != nil {
		return nil, err
	}
	fileServer := http.FileServer(http.FS(root))

	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if _, err := fs.Stat(root, trimLeadingSlash(req.URL.Path)); err != nil {
			// Berkas tidak ada apa adanya — serahkan ke index.html (SPA
			// fallback), bukan 404 dari file server.
			req = cloneWithPath(req, "/")
		}
		fileServer.ServeHTTP(w, req)
	}), nil
}

func trimLeadingSlash(p string) string {
	if p == "" || p == "/" {
		return "."
	}
	if p[0] == '/' {
		return p[1:]
	}
	return p
}

func cloneWithPath(r *http.Request, path string) *http.Request {
	r2 := r.Clone(r.Context())
	r2.URL.Path = path
	return r2
}

// slogRequestLogger loggat tiap request lewat slog (bukan log/std chi
// default) supaya format ikut konsisten dengan seluruh app: teks di dev,
// JSON di prod (internal/logging), dengan request ID dari middleware.RequestID.
func slogRequestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

			next.ServeHTTP(ww, r)

			logger.Info("request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", ww.Status(),
				"bytes", ww.BytesWritten(),
				"duration_ms", time.Since(start).Milliseconds(),
				"request_id", middleware.GetReqID(r.Context()),
			)
		})
	}
}
