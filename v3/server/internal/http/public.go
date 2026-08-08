package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/perm"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// Halaman publik klub (PLAN.md §6.3, F9). Rute DAN query di berkas ini
// terpisah total dari yang dipakai anggota — bukan endpoint biasa yang
// disaring belakangan. Kalau sebuah field ragu boleh publik atau tidak,
// JANGAN ditambahkan (lihat komentar queries/public.sql). Tidak pernah:
// nomor telepon, saldo deposit perorangan, riwayat pembayaran perorangan,
// jurnal audit, pengaturan klub mentah.

// halamanPublikEnabled baca saklar clubs.settings.halaman_publik, default
// MATI (beda dari transparansiKas yang defaultnya nyala — treasury.go).
// Unmarshal ke defaultClubSettings utuh aman: field hilang di JSON lama
// kebagian zero value Go, dan zero value bool memang false = mati, sudah
// pas dengan bawaan yang diinginkan (clubs.go defaultSettingsJSON).
func halamanPublikEnabled(c gen.Club) bool {
	var s defaultClubSettings
	_ = json.Unmarshal(c.Settings, &s)
	return s.HalamanPublik
}

// RequirePublicClub — satu-satunya pintu masuk seluruh rute
// /api/v1/public/clubs/{slug}/*. TANPA auth (publik sungguhan): resolve
// slug → club_id lewat GetClubBySlug (tabel clubs lintas klub, tidak
// ber-RLS — §6.2 "tabel lintas klub"), tolak 404 kalau klub tidak ada ATAU
// saklar halaman_publik mati. Sengaja 404 di kedua kasus (bukan 403 untuk
// yang mati) — supaya orang luar tidak bisa membedakan "klub tidak ada"
// dari "klub ada tapi menutup halaman publiknya", sama alasan RequireClub
// balas 404 buat bukan-anggota (middleware_tenant.go).
func RequirePublicClub(s *store.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			slug := chi.URLParam(r, "slug")

			var club gen.Club
			err := s.WithinTx(r.Context(), func(ctx context.Context, q *gen.Queries) error {
				var err error
				club, err = q.GetClubBySlug(ctx, slug)
				return err
			})
			if err != nil {
				if !errors.Is(err, pgx.ErrNoRows) {
					writeError(w, CodeValidationFailed, "Gagal memeriksa klub.", nil)
					return
				}
				writeError(w, CodeNotFound, "Halaman klub ini tidak ditemukan.", nil)
				return
			}
			if !halamanPublikEnabled(club) {
				writeError(w, CodeNotFound, "Halaman klub ini tidak ditemukan.", nil)
				return
			}

			// Role/perm kosong sengaja — rute publik tidak pernah memanggil
			// RequirePerm, cuma butuh clubID buat s.WithClub di handler
			// (pola sama RequireClubExists, middleware_tenant.go).
			next.ServeHTTP(w, r.WithContext(withClub(r.Context(), club.ID, gen.ClubRoleMember, map[perm.Permission]bool{})))
		})
	}
}

type publicClubDTO struct {
	Slug            string `json:"slug"`
	Name            string `json:"name"`
	Timezone        string `json:"timezone"`
	TransparansiKas bool   `json:"transparansi_kas"`
	PapanPeringkat  bool   `json:"papan_peringkat"`
	MemberCount     int64  `json:"member_count"`
	GameCount       int64  `json:"game_count"`
	TournamentCount int64  `json:"tournament_count"`
}

// handleGetPublicClub — GET /public/clubs/{slug} (§6.3 "tampil ... dan
// statistik klub"). Dibangun manual field-per-field, BUKAN newClubDTO —
// clubDTO menyertakan settings mentah utuh (dto.go), dan settings memuat
// hal yang tidak boleh publik (ambang tunggakan, siapa_boleh_catat, dst,
// §6.3 "tidak pernah tampil ... pengaturan").
func handleGetPublicClub(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())

		var club gen.Club
		var stats gen.GetPublicClubStatsRow
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			club, err = q.GetClub(ctx, clubID)
			if err != nil {
				return err
			}
			stats, err = q.GetPublicClubStats(ctx, clubID)
			return err
		})
		if err != nil {
			writeError(w, CodeNotFound, "Halaman klub ini tidak ditemukan.", nil)
			return
		}

		var settings defaultClubSettings
		_ = json.Unmarshal(club.Settings, &settings)

		writeJSON(w, http.StatusOK, publicClubDTO{
			Slug: club.Slug, Name: club.Name, Timezone: club.Timezone,
			TransparansiKas: settings.TransparansiKas, PapanPeringkat: settings.PapanPeringkat,
			MemberCount: stats.MemberCount, GameCount: stats.GameCount, TournamentCount: stats.TournamentCount,
		})
	}
}

type publicTreasuryDTO = treasuryDTO

// handleGetPublicTreasury — GET /public/clubs/{slug}/treasury. Angkanya
// PERSIS query yang sama dipakai handleGetTreasury (treasury.go) — kas
// klub cuma satu sumber kebenaran, bukan dihitung ulang beda cara di sini.
// Bedanya cuma gerbangnya: kalau saklar transparansi_kas mati, publik
// TIDAK PERNAH boleh lihat sama sekali (beda dari anggota yang masih bisa
// lewat ManageMoney) — 404, bukan pesan "hubungi bendahara".
func handleGetPublicTreasury(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())

		var dto publicTreasuryDTO
		var club gen.Club
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			club, err = q.GetClub(ctx, clubID)
			if err != nil {
				return err
			}
			income, err := q.SumPaidKokIncome(ctx, clubID)
			if err != nil {
				return err
			}
			expenses, err := q.SumExpenses(ctx, clubID)
			if err != nil {
				return err
			}
			wallets, err := q.SumClubWalletTotal(ctx, clubID)
			if err != nil {
				return err
			}
			fees, err := q.SumTournamentFeesPaid(ctx, clubID)
			if err != nil {
				return err
			}
			dto = publicTreasuryDTO{KasKlub: income - expenses, TitipanPemain: wallets, IuranTurnamen: fees}
			return nil
		})
		if err != nil {
			writeError(w, CodeNotFound, "Halaman klub ini tidak ditemukan.", nil)
			return
		}
		if !transparansiKas(club) {
			writeError(w, CodeNotFound, "Kas klub ini tidak dibuka ke publik.", nil)
			return
		}
		writeJSON(w, http.StatusOK, dto)
	}
}

type publicBillItemDTO struct {
	UserID      uuid.UUID `json:"user_id"`
	DisplayName string    `json:"display_name"`
	TotalOwed   int64     `json:"total_owed"`
}

// handleListPublicBills — GET /public/clubs/{slug}/bills (§6.3 "rekap
// tagihan per nama"). SATU angka per orang lewat ListPublicUnpaidTotals
// (queries/public.sql) — bukan daftar item seperti /me/bill atau /bills
// bendahara, yang keduanya menyertakan detail per main dan tautan
// pembayaran yang bukan urusan orang lewat.
func handleListPublicBills(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())

		var rows []gen.ListPublicUnpaidTotalsRow
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			rows, err = q.ListPublicUnpaidTotals(ctx, clubID)
			return err
		})
		if err != nil {
			writeError(w, CodeNotFound, "Halaman klub ini tidak ditemukan.", nil)
			return
		}

		items := make([]publicBillItemDTO, 0, len(rows))
		for _, row := range rows {
			items = append(items, publicBillItemDTO{UserID: row.UserID, DisplayName: row.DisplayName, TotalOwed: row.TotalOwed})
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

// handleGetPublicLeaderboard — GET /public/clubs/{slug}/leaderboard (§6.3
// "statistik klub"). handleGetLeaderboard (leaderboard.go) cuma bergantung
// pada clubIDFromContext, tanpa userID/perm — jadi dipakai ulang APA
// ADANYA, gerbang papan_peringkat (mati → 404) ikut terbawa gratis.
func handleGetPublicLeaderboard(s *store.Store) http.HandlerFunc {
	return handleGetLeaderboard(s)
}

// handleListPublicTournaments / handleGetPublicTournament — bagan &
// klasemen (§6.3) ADALAH publik by design begitu halaman_publik nyala:
// skor partai dan siapa vs siapa bukan data uang perorangan, jadi dipakai
// ULANG loadTournamentDTO (tournaments.go) apa adanya alih-alih menyalin
// query — satu-satunya risiko privasi di turnamen ada di iuran per orang,
// dan itu SUDAH bentuknya "siapa sudah bayar" publik-aman sama seperti
// rekap tagihan di atas (bukan riwayat pembayaran/nomor telepon).
func handleListPublicTournaments(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())

		var rows []gen.Tournament
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			rows, err = q.ListTournamentsByClub(ctx, gen.ListTournamentsByClubParams{ClubID: clubID, Limit: int32(defaultTournamentsLimit)})
			return err
		})
		if err != nil {
			writeError(w, CodeNotFound, "Halaman klub ini tidak ditemukan.", nil)
			return
		}

		items := make([]tournamentDTO, 0, len(rows))
		for _, t := range rows {
			dto, err := loadTournamentDTO(r.Context(), s, clubID, t.ID)
			if err != nil {
				continue
			}
			items = append(items, dto)
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

func handleGetPublicTournament(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Turnamen tidak ditemukan.", nil)
			return
		}
		dto, err := loadTournamentDTO(r.Context(), s, clubID, id)
		if err != nil {
			writeError(w, CodeNotFound, "Turnamen tidak ditemukan.", nil)
			return
		}
		writeJSON(w, http.StatusOK, dto)
	}
}
