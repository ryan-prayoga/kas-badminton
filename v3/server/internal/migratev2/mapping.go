package migratev2

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
)

// NameMapping — keputusan MANUSIA (§14 F10 "manusia yang memutuskan mana
// yang digabung — bukan tebakan otomatis"), disimpan sebagai berkas JSON
// yang IKUT REPO deployment (bukan repo publik ini — berkasnya berisi
// nama anggota klub sungguhan, tempatnya di ops/deploy milik operator
// masing-masing, sama semangat .env). Key = nama v2 SETELAH
// NormalizeName, value = nama kanonik yang dipakai jadi display_name di
// v3. Nama yang tidak digabung tetap wajib ada di sini (key == value) —
// itulah yang menegakkan "tidak ada nama yang gagal dipetakan".
type NameMapping map[string]string

func LoadMapping(path string) (NameMapping, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("migratev2: baca berkas pemetaan %s: %w", path, err)
	}
	var m NameMapping
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("migratev2: parse berkas pemetaan %s: %w", path, err)
	}
	return m, nil
}

func SaveMapping(path string, m NameMapping) error {
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')
	return os.WriteFile(path, b, 0o644)
}

// TemplateMapping — pemetaan identitas (tiap nama ke dirinya sendiri)
// buat titik awal `migrate-v2 dedupe --write-template`. Operator lihat
// laporan cluster di stdout LALU edit berkas ini manual: nama-nama yang
// sungguh orang yang sama diubah value-nya jadi sama satu sama lain.
func TemplateMapping(names []string) NameMapping {
	m := NameMapping{}
	for _, n := range names {
		norm := NormalizeName(n)
		if norm == "" {
			continue
		}
		m[norm] = norm
	}
	return m
}

// Resolve — nama kanonik buat satu nama v2 mentah, atau error kalau
// tidak ada di berkas pemetaan sama sekali (F10 "tidak ada nama yang
// gagal dipetakan"). Nama kosong ("" — slot game yang tidak terisi
// penuh) BUKAN tanggung jawab Resolve, itu ditolak lebih awal di
// migrate.go dengan pesan yang lebih spesifik ("game bukan 4 orang").
func (m NameMapping) Resolve(rawName string) (string, error) {
	norm := NormalizeName(rawName)
	canonical, ok := m[norm]
	if !ok {
		return "", fmt.Errorf("nama %q belum ada di berkas pemetaan", norm)
	}
	return canonical, nil
}

// MissingNames — nama-nama (sudah dinormalisasi, unik, urut) di `names`
// yang BELUM ada sebagai key di mapping. Dipanggil migrate.go sebelum
// menulis apa pun — kosong berarti aman lanjut, tidak kosong migrasi
// ditolak SEBELUM transaksi dibuka sama sekali.
func (m NameMapping) MissingNames(names []string) []string {
	seen := map[string]bool{}
	var missing []string
	for _, n := range names {
		norm := NormalizeName(n)
		if norm == "" || seen[norm] {
			continue
		}
		seen[norm] = true
		if _, ok := m[norm]; !ok {
			missing = append(missing, norm)
		}
	}
	sort.Strings(missing)
	return missing
}
