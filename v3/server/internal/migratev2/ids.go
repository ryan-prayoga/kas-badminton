package migratev2

import (
	"fmt"

	"github.com/google/uuid"
)

// namespace — UUID tetap khusus migrate-v2, dasar SEMUA id deterministik
// di bawah. "Tetap" itu intinya: kalau ini berubah, migrasi ulang bikin
// id v3 yang BEDA dari sebelumnya dan idempotensi (§14 F10) rusak.
// Diturunkan dari string yang jelas asalnya (bukan literal acak) supaya
// siapa pun yang baca kode ini paham ini bukan angka sembarangan.
var namespace = uuid.NewSHA1(uuid.NameSpaceDNS, []byte("migrate-v2.kaskok.my.id"))

// deriveID — SATU fungsi dipakai semua id*() di bawah supaya polanya
// konsisten: uuid.NewSHA1 murni fungsi id → id (input sama = output
// sama, selamanya) — itulah properti yang bikin ON CONFLICT (id) DO
// NOTHING/UPDATE di queries/migrate_v2.sql cukup buat "aman diulang"
// tanpa tabel penanda migrasi terpisah.
func deriveID(parts ...string) uuid.UUID {
	s := ""
	for i, p := range parts {
		if i > 0 {
			s += "\x1f" // unit separator — pemisah yang mustahil muncul di nama/id asli
		}
		s += p
	}
	return uuid.NewSHA1(namespace, []byte(s))
}

func clubID(slug string) uuid.UUID                { return deriveID("club", slug) }
func userID(slug, canonicalName string) uuid.UUID { return deriveID("user", slug, canonicalName) }
func kokTypeID(slug, v2ID string) uuid.UUID       { return deriveID("kokType", slug, v2ID) }
func gameID(slug, v2ID string) uuid.UUID          { return deriveID("game", slug, v2ID) }
func gameKokID(slug, v2GameID, v2KokID string) uuid.UUID {
	return deriveID("gameKok", slug, v2GameID, v2KokID)
}
func gamePlayerID(slug, v2GameID string, slot int) uuid.UUID {
	return deriveID("gamePlayer", slug, v2GameID, fmt.Sprintf("%d", slot))
}
func expenseID(slug, v2ID string) uuid.UUID { return deriveID("expense", slug, v2ID) }
func walletEntryID(slug, canonicalName string) uuid.UUID {
	return deriveID("walletEntry", slug, "carry", canonicalName)
}
