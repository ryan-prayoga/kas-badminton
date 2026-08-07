package config

import "testing"

func TestLoad_WajibDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	if _, err := Load(); err == nil {
		t.Fatal("Load() harusnya galat kalau DATABASE_URL kosong")
	}
}

func TestLoad_Default(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://x/kok_v3")
	t.Setenv("PORT", "")
	t.Setenv("ENV", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() galat: %v", err)
	}
	if cfg.Port != 8300 {
		t.Errorf("Port default = %d, mau 8300", cfg.Port)
	}
	if !cfg.IsDev() {
		t.Errorf("IsDev() = false, mau true saat ENV kosong")
	}
}

func TestLoad_ProdBukanDev(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://x/kok_v3")
	t.Setenv("ENV", "prod")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() galat: %v", err)
	}
	if cfg.IsDev() {
		t.Errorf("IsDev() = true, mau false saat ENV=prod")
	}
}
