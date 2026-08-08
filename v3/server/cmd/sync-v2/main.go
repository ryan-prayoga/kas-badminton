// cmd/sync-v2 — proses TERPISAH & TERUS-MENERUS yang menjaga v3 sebagai
// cermin hidup dari v2 selama keduanya jalan bersamaan (Ryan minta ini
// eksplisit — bukan rencana F10 asli "freeze v2 lalu migrasi sekali",
// lihat catatan PLAN.md §14 F10 "sync hidup"). v2 tetap SATU-SATUNYA
// tempat input buat domain klasik (main harian, pembayaran, pengeluaran,
// stok kok, pemain, turnamen) — proses ini cuma MEMBACA v2 dan MENULIS
// v3, tidak pernah sebaliknya (internal/migratev2 read-only ke v2, sama
// seperti cmd/migrate-v2).
//
// Fitur v3-only (dompet/deposit, main jumlah pemain bebas, taruhan
// barang, alokasi bayar sebagian) SENGAJA tidak disentuh proses ini —
// tidak ada representasinya di skema v2, jadi tidak mungkin bentrok
// dengan sync ini.
//
// Beda dari `migrate-v2 run` (satu jalan, verified-rollback): proses ini
// memanggil migratev2.SyncOnce berulang tiap --interval, aman diulang
// (idempoten by design — lihat komentar package migratev2/sync.go), dan
// TIDAK PERNAH rollback — data yang sudah kepakai orang tidak bisa
// ditarik balik cuma karena satu putaran ketemu nama belum dipetakan.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/migratev2"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
)

func main() {
	if err := run(); err != nil {
		slog.Error("sync-v2 berhenti dengan galat", "err", err)
		os.Exit(1)
	}
}

func run() error {
	fs := flag.NewFlagSet("sync-v2", flag.ExitOnError)
	v2dsn := fs.String("v2-dsn", os.Getenv("V2_DATABASE_URL"), "DSN Postgres v2 (baca-saja), atau env V2_DATABASE_URL")
	v3dsn := fs.String("v3-dsn", os.Getenv("DATABASE_URL"), "DSN Postgres v3 (role kok_app), atau env DATABASE_URL")
	slug := fs.String("slug", os.Getenv("SYNC_V2_CLUB_SLUG"), "slug klub tujuan (harus sudah ada, atau dibuat sync pertama kali), atau env SYNC_V2_CLUB_SLUG")
	name := fs.String("name", os.Getenv("SYNC_V2_CLUB_NAME"), "nama klub (dipakai cuma kalau klub belum ada)")
	timezone := fs.String("timezone", envOr("SYNC_V2_TIMEZONE", "Asia/Jakarta"), "zona waktu klub")
	mappingPath := fs.String("mapping", os.Getenv("SYNC_V2_MAPPING"), "path berkas pemetaan nama (migrate-v2 dedupe --write-template, sudah diedit manual), atau env SYNC_V2_MAPPING")
	admin := fs.String("admin", os.Getenv("SYNC_V2_ADMIN"), "nama kanonik admin klub (dipakai cuma kalau klub belum ada)")
	interval := fs.Duration("interval", envDurationOr("SYNC_V2_INTERVAL", 60*time.Second), "jeda antar putaran sync, atau env SYNC_V2_INTERVAL (mis. 60s, 2m)")
	if err := fs.Parse(os.Args[1:]); err != nil {
		return err
	}
	for flagName, v := range map[string]string{"v2-dsn": *v2dsn, "v3-dsn": *v3dsn, "slug": *slug, "mapping": *mappingPath} {
		if v == "" {
			return fmt.Errorf("--%s wajib diisi (lihat -h)", flagName)
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	v2pool, err := pgxpool.New(ctx, *v2dsn)
	if err != nil {
		return fmt.Errorf("konek v2: %w", err)
	}
	defer v2pool.Close()

	v3pool, err := pgxpool.New(ctx, *v3dsn)
	if err != nil {
		return fmt.Errorf("konek v3: %w", err)
	}
	defer v3pool.Close()

	s := store.New(v3pool)
	r := migratev2.NewPgReader(v2pool)
	opts := migratev2.Options{ClubSlug: *slug, ClubName: *name, Timezone: *timezone, AdminName: *admin}

	slog.Info("sync-v2 mulai", "slug", *slug, "interval", interval.String())

	// Putaran pertama SEGERA (jangan tunggu satu interval penuh cuma buat
	// tahu proses ini hidup), lalu ikuti ticker.
	syncOnceLogged(ctx, r, s, *mappingPath, opts)

	ticker := time.NewTicker(*interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			slog.Info("sinyal berhenti diterima, sync-v2 keluar")
			return nil
		case <-ticker.C:
			syncOnceLogged(ctx, r, s, *mappingPath, opts)
		}
	}
}

// syncOnceLogged — muat ULANG berkas pemetaan tiap putaran (operator bisa
// mengedit mapping.json sambil proses jalan, tanpa restart, buat
// menyelesaikan nama yang ke-skip putaran sebelumnya) lalu jalankan satu
// putaran SyncOnce. Galat di sini TIDAK menghentikan proses — dicatat,
// putaran berikutnya coba lagi (sesuai semangat "sistem hidup", bukan
// one-shot yang boleh berhenti di galat pertama).
func syncOnceLogged(ctx context.Context, r migratev2.Reader, s *store.Store, mappingPath string, opts migratev2.Options) {
	mapping, err := migratev2.LoadMapping(mappingPath)
	if err != nil {
		slog.Error("sync-v2: gagal baca berkas pemetaan, putaran ini dilewati", "err", err)
		return
	}

	start := time.Now()
	result, err := migratev2.SyncOnce(ctx, r, s, mapping, opts)
	if err != nil {
		slog.Error("sync-v2: putaran gagal", "err", err, "durasi", time.Since(start).String())
		return
	}

	logger := slog.With(
		"durasi", time.Since(start).String(),
		"game_baru", result.GamesInserted, "game_update", result.GamesUpdated, "game_tetap", result.GamesUnchanged,
		"pengeluaran_diproses", result.ExpensesProcessed, "dompet_delta", result.WalletTopups,
		"turnamen_sync", result.TournamentsSynced,
	)
	logger.Info("sync-v2: putaran selesai")

	if len(result.SkippedForMapping) > 0 {
		slog.Warn("sync-v2: ada nama v2 belum dipetakan, baris terkait dilewati — update berkas pemetaan", "nama", result.SkippedForMapping)
	}
	if len(result.SkippedInvalidGames) > 0 {
		slog.Warn("sync-v2: ada game v2 bukan ganda 4 orang, dilewati", "game_id", result.SkippedInvalidGames)
	}
	if len(result.SkippedTournaments) > 0 {
		slog.Warn("sync-v2: ada turnamen gagal sync", "detail", result.SkippedTournaments)
	}
	if len(result.SkippedCarryDecreases) > 0 {
		slog.Warn("sync-v2: carry v2 turun buat sebagian orang — ledger v3 append-only tidak bisa menariknya otomatis, perlu tindakan manual", "detail", result.SkippedCarryDecreases)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envDurationOr(key string, fallback time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		slog.Warn("sync-v2: SYNC_V2_INTERVAL tidak valid, pakai bawaan", "value", v, "err", err, "bawaan", fallback.String())
		return fallback
	}
	return d
}
