// Package config memuat konfigurasi dari environment variable. Tidak ada
// file config selain env — cocok untuk deploy satu binary + docker compose.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
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

	// Konfigurasi Relying Party WebAuthn (PLAN.md §7.2, §4.4 go-webauthn).
	// WAJIB beda antara dev/test/prod — RPID & origin bukan angka bisnis
	// seperti TTL OTP, tapi fakta lingkungan, jadi taruhnya di sini (bukan
	// const di internal/auth). Bawaan dev: localhost, cocok jalan tanpa
	// disetel apa pun.
	WebAuthnRPID          string
	WebAuthnRPDisplayName string
	WebAuthnRPOrigins     []string

	// Web Push / VAPID (PLAN.md §4.4, §10.2, §14 F8). Kosong di dev =
	// internal/push.Fake dipakai (sama semangat notify.Fake — "lingkungan
	// dev tanpa WA" §12, di sini dev tanpa push sungguhan juga boleh).
	// VAPIDSubject wajib "mailto:..." per spec kalau VAPIDPublicKey diisi.
	VAPIDPublicKey  string
	VAPIDPrivateKey string
	VAPIDSubject    string
}

// Load membaca env var dan memvalidasi yang wajib. Tidak membaca file .env —
// itu tanggung jawab pemanggil proses (docker compose, shell lokal, dsb),
// sama seperti v1/v2 di repo ini.
func Load() (Config, error) {
	cfg := Config{
		Port:     envInt("PORT", 8300),
		Env:      envString("ENV", "dev"),
		LogLevel: envString("LOG_LEVEL", "info"),

		WebAuthnRPID:          envString("WEBAUTHN_RP_ID", "localhost"),
		WebAuthnRPDisplayName: envString("WEBAUTHN_RP_DISPLAY_NAME", "Kok Badminton"),
		WebAuthnRPOrigins:     envList("WEBAUTHN_RP_ORIGINS", []string{"http://localhost:8300"}),

		VAPIDPublicKey:  envString("VAPID_PUBLIC_KEY", ""),
		VAPIDPrivateKey: envString("VAPID_PRIVATE_KEY", ""),
		VAPIDSubject:    envString("VAPID_SUBJECT", "mailto:admin@kaskok.my.id"),
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

// envList — dipisah koma, mis. "https://app.kaskok.my.id,https://kaskok.my.id".
func envList(key string, fallback []string) []string {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return fallback
	}
	return out
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
