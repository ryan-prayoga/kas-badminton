package httpapi

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// Kuota per klub (PLAN.md §12.1, F9/3). "Melindungi sumber daya bersama,
// bukan membatasi pemakaian wajar" — makanya cek di sini SELALU longgar
// (<=0 di quotas berarti tak terbatas, bukan nol) dan pesan galatnya
// mengarahkan ke admin, bukan menyalahkan pemakai.

// errQuotaExceeded — sentinel dibungkus pesan siap-tampil, dicek lewat
// errors.As SETELAH WithClub/WithUser kembali (pola sama notFound/conflict
// bool di handler lain, tapi di sini butuh pesan berbeda per kuota jadi
// dibungkus tipe, bukan cuma bool).
type quotaExceededError struct{ message string }

func (e *quotaExceededError) Error() string { return e.message }

func errQuota(message string) error { return &quotaExceededError{message: message} }

func asQuotaExceeded(err error) (string, bool) {
	var qe *quotaExceededError
	if errors.As(err, &qe) {
		return qe.message, true
	}
	return "", false
}

func clubQuotasOf(c gen.Club) defaultClubQuotas {
	q := defaultClubQuotas{FotoMaxMB: 8, AnggotaPerKlub: 500, PosterAktif: 10, WaPesanPerHari: 50}
	if len(c.Quotas) > 0 {
		_ = json.Unmarshal(c.Quotas, &q)
	}
	return q
}

// checkMemberQuota — dipanggil SEBELUM tiap CreateMembership/
// CreateTournamentGuestMembership (klaim disetujui, pemain tamu, peserta
// turnamen dari luar klub — tiga jalur berbeda yang semuanya menambah
// baris memberships). club HARUS hasil query TERBARU dalam transaksi yang
// sama (bukan yang dimuat sebelum request ini) supaya hitungannya tidak
// basi kalau ada permintaan lain nyelip.
func checkMemberQuota(ctx context.Context, q *gen.Queries, club gen.Club) error {
	limit := clubQuotasOf(club).AnggotaPerKlub
	if limit <= 0 {
		return nil // tak terbatas
	}
	count, err := q.CountMembers(ctx, club.ID)
	if err != nil {
		return err
	}
	if count >= int64(limit) {
		return errQuota("Klub ini sudah di batas jumlah anggota. Hubungi admin platform kalau butuh lebih.")
	}
	return nil
}

// checkPosterQuota — dipanggil sebelum CreateClubLink DENGAN purpose
// "poster" (§6.4, §12.1 "Poster QR aktif per klub"). Tautan purpose
// "join" (undangan biasa) TIDAK ikut dihitung — kuota ini soal poster
// FISIK yang beredar di tembok GOR, bukan tautan digital yang bisa dibuat
// bebas.
func checkPosterQuota(ctx context.Context, q *gen.Queries, club gen.Club) error {
	limit := clubQuotasOf(club).PosterAktif
	if limit <= 0 {
		return nil
	}
	active, err := q.ListActiveClubLinks(ctx, club.ID)
	if err != nil {
		return err
	}
	posters := 0
	for _, l := range active {
		if l.Purpose == gen.LinkPurposePoster {
			posters++
		}
	}
	if posters >= limit {
		return errQuota("Sudah di batas jumlah poster QR aktif. Cabut yang lama dulu, atau minta admin platform menaikkan batasnya.")
	}
	return nil
}

// platformMaxClubsPerUser — §12.1 "Klub per orang: 20, bisa dinaikkan
// superadmin". BEDA dari kuota di clubs.quotas: ini per PENGGUNA lintas
// klub, bukan per klub, dan skema saat ini (DDL.sql) tidak punya tabel
// override per-user — jadi konstanta platform, bukan yang bisa digeser
// lewat panel admin. Menaikkannya (kalau pernah dibutuhkan) berarti
// redeploy, bukan panggilan API — batasan yang sengaja diterima F9/3
// supaya tidak perlu migrasi skema baru cuma buat satu angka jarang
// dipakai (lihat catatan di PR/commit F9/3 kalau kelak ini genuinely
// dibutuhkan per-user).
const platformMaxClubsPerUser = 20

// checkClubsPerUserQuota — dipanggil sebelum seseorang jadi anggota klub
// BARU lewat aksi mereka SENDIRI (bikin klub, klaim disetujui) — BUKAN
// buat pemain tamu/peserta turnamen yang ditambahkan orang lain (mereka
// tidak "memilih" ikut klub itu, jadi tidak adil menghitungnya ke kuota
// pribadi orang itu).
func checkClubsPerUserQuota(ctx context.Context, s *store.Store, userID uuid.UUID) error {
	var count int
	err := s.WithUser(ctx, userID, func(ctx context.Context, q *gen.Queries) error {
		rows, err := q.ListMembershipsWithClubByUser(ctx, userID)
		count = len(rows)
		return err
	})
	if err != nil {
		return err
	}
	if count >= platformMaxClubsPerUser {
		return errQuota("Akun ini sudah ikut terlalu banyak klub. Keluar dari salah satu dulu, atau hubungi admin platform.")
	}
	return nil
}
