// Package config memuat konfigurasi dari environment variable. Tidak ada
// file config selain env — cocok untuk deploy satu binary + docker compose.
package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	// Wajib. postgresql://user:pass@host:port/kok_v3 — database TERPISAH
	// dari v2 di instans Postgres yang sama (PLAN.md §2).
	DatabaseURL string

	// Port HTTP server. Beda dari v2 (8200) supaya bisa jalan berdampingan.
	Port int

	// "dev" | "prod". Menentukan Notifier mana yang dipakai (lihat
	// internal/notify) dan format log (teks vs JSON).
	Env string

	// debug | info | warn | error
	LogLevel string
}

// Load membaca env var dan memvalidasi yang wajib. Tidak membaca file .env —
// itu tanggung jawab pemanggil proses (docker compose, shell lokal, dsb),
// sama seperti v1/v2 di repo ini.
func Load() (Config, error) {
	cfg := Config{
		Port:     envInt("PORT", 8300),
		Env:      envString("ENV", "dev"),
		LogLevel: envString("LOG_LEVEL", "info"),
	}

	cfg.DatabaseURL = os.Getenv("DATABASE_URL")
	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL wajib diisi")
	}

	return cfg, nil
}

func (c Config) IsDev() bool {
	return c.Env != "prod"
}

func envString(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}
