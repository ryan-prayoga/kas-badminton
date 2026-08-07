// Package logging menyediakan structured logger (slog) — bagian dari
// observability yang wajib ada sejak awal (PLAN.md §12): superadmin sengaja
// tidak boleh melihat isi data klub, jadi log terstruktur adalah alat
// diagnosa utama, bukan pelengkap.
package logging

import (
	"log/slog"
	"os"
)

// New membuat root logger. Dev: teks berwarna-ramah-mata di terminal. Prod:
// JSON satu baris per event, siap di-tail/di-parse tooling log.
func New(env, level string) *slog.Logger {
	opts := &slog.HandlerOptions{Level: parseLevel(level)}

	var handler slog.Handler
	if env == "prod" {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		handler = slog.NewTextHandler(os.Stdout, opts)
	}

	logger := slog.New(handler)
	slog.SetDefault(logger)
	return logger
}

func parseLevel(level string) slog.Level {
	switch level {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
