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
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/auth"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/config"
	httpapi "github.com/ryan-prayoga/kas-badminton/v3/server/internal/http"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/logging"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/metrics"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/notify"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/push"
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

	wa, err := auth.NewWebAuthn(cfg)
	if err != nil {
		return err
	}
	challenges := auth.NewChallengeStore()

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

	// dev/CI: Fake, cuma menulis log — tidak ada yang perlu memakai nomor
	// WA produksi buat mengembangkan fitur (§12 "Lingkungan dev tanpa WA").
	// prod: Outbox, titip ke wa_outbox buat cmd/waworker (proses TERPISAH,
	// satu-satunya pemegang koneksi whatsmeow — §12 "Bridge WA satu
	// proses", F4 bagian 6).
	var notifier notify.Notifier
	if cfg.IsDev() {
		notifier = notify.NewFake(logger)
	} else {
		notifier = notify.NewOutbox(s)
	}

	// Web Push (§10.2, F8) — VAPID kosong (dev/CI bawaan) → Fake, sama
	// alasan notifier di atas. Dispatcher jalan sebagai goroutine di
	// PROSES INI (bukan proses terpisah seperti waworker) — tidak ada
	// koneksi eksternal stateful yang perlu dijaga tunggal di sini,
	// beda dari whatsmeow (§12 "Bridge WA satu proses").
	var pushSender push.Sender
	vapidPublicKey := cfg.VAPIDPublicKey
	if cfg.VAPIDPublicKey != "" && cfg.VAPIDPrivateKey != "" {
		pushSender = &push.VAPID{PublicKey: cfg.VAPIDPublicKey, PrivateKey: cfg.VAPIDPrivateKey, Subject: cfg.VAPIDSubject}
	} else {
		pushSender = push.NewFake(logger)
		// dev/CI: kunci publik SUNGGUHAN (biar PushManager.subscribe() di
		// browser tetap bisa dites) tapi Sender tetap Fake (tidak pernah
		// kontak jaringan push sungguhan) — lihat komentar GenerateDevKeys.
		if cfg.IsDev() {
			if pub, _, err := push.GenerateDevKeys(); err == nil {
				vapidPublicKey = pub
			} else {
				logger.Warn("gagal generate VAPID key dev — push subscribe akan gagal di klien", "err", err)
			}
		}
	}
	dispatcher := notify.NewDispatcher(s, pushSender, notifier, logger)
	go dispatcher.Run(ctx, 30*time.Second)

	// Tunggakan lewat batas (§10.3, F8) — ambangnya harian, jadi jauh
	// lebih jarang dari Dispatcher; sejam sekali cukup, tidak perlu
	// segera seperti antrean push/WA.
	overdueScanner := notify.NewOverdueScanner(s, logger)
	go overdueScanner.Run(ctx, time.Hour)

	router, err := newRouter(logger, pool, s, bus, notifier, wa, challenges, vapidPublicKey)
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

func newRouter(logger *slog.Logger, pool *pgxpool.Pool, s *store.Store, bus *realtime.Bus, notifier notify.Notifier, wa *webauthn.WebAuthn, challenges *auth.ChallengeStore, vapidPublicKey string) (http.Handler, error) {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(slogRequestLogger(logger))
	r.Use(middleware.Recoverer)

	// /healthz: proses hidup, tidak cek dependensi (dipakai orkestrator
	// buat "restart apa tidak"). /readyz: proses SIAP menerima trafik,
	// cek DB (dipakai load balancer/reverse proxy buat "alirkan trafik
	// apa tidak") — beda tujuan, PLAN.md §12 "endpoint health/readiness"
	// sebut keduanya secara eksplisit sebagai dua hal.
	r.Get("/healthz", healthHandler)
	r.Get("/readyz", readyzHandler(pool))
	r.Get("/metrics", metricsHandler)

	httpapi.Mount(r, s, bus, notifier, wa, challenges, vapidPublicKey)

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

// readyzHandler — ping DB dengan timeout pendek. Timeout sengaja singkat
// (2s): kalau DB butuh lebih lama dari itu buat menjawab ping kosong,
// instance ini memang belum layak menerima trafik baru.
func readyzHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		w.Header().Set("Content-Type", "application/json")
		if err := pool.Ping(ctx); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"status":"not_ready"}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ready"}`))
	}
}

// metricsHandler — teks exposition Prometheus (internal/metrics, F9/3).
// TIDAK dipasang di belakang auth apa pun — di produksi ini harus
// ditutup di level reverse proxy (Caddy/nginx, jaringan internal saja),
// sama seperti /healthz; mengunci lewat kode di sini cuma menambah
// friksi buat scraper tanpa manfaat, jaringan yang jadi batasnya.
func metricsHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	metrics.WriteText(w)
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
//
// Level naik dengan status (F9/3, PLAN.md §12 "pelacakan galat" — tanpa
// APM eksternal di skala ~10 klub, §4.2, log terstruktur yang bisa
// disaring per level INI alat diagnosanya, superadmin sengaja tidak boleh
// intip isi klub jadi ini juga satu-satunya jendela buat operator):
// 5xx = Error (server yang salah), 4xx = Warn (klien/pemakaian, bukan
// selalu bug tapi layak diperhatikan polanya), selain itu Info biasa.
// metrics.Observe (internal/metrics) dipanggil di sini juga — SATU
// tempat yang tahu status akhir tiap request, dipakai dua alat sekaligus
// (log buat "apa yang terjadi", metrik buat "berapa banyak").
func slogRequestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

			metrics.InFlightStart()
			next.ServeHTTP(ww, r)
			metrics.InFlightEnd()

			status := ww.Status()
			metrics.Observe(status)

			args := []any{
				"method", r.Method,
				"path", r.URL.Path,
				"status", status,
				"bytes", ww.BytesWritten(),
				"duration_ms", time.Since(start).Milliseconds(),
				"request_id", middleware.GetReqID(r.Context()),
			}
			switch {
			case status >= 500:
				logger.Error("request", args...)
			case status >= 400:
				logger.Warn("request", args...)
			default:
				logger.Info("request", args...)
			}
		})
	}
}
