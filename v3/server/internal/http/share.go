// Share teks WhatsApp (PLAN.md §5.9, §14 F8, API.md §6). Cuma TEKS di
// sub-fase ini — kartu PNG (v2/lib/share.ts, 1352 baris, sebagai acuan
// fungsional) menyusul di sub-fase F8 berikutnya; lihat catatan di commit.
// Teks sendiri sudah bernilai: itu yang paling sering benar-benar dipakai
// buat nge-tag orang di grup WA nagih, bukan kartunya.
package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/perm"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

type shareTextDTO struct {
	Text string `json:"text"`
}

// handleShareBill — POST /clubs/{clubId}/share/bill/{userId}. HAK
// PEMAIN atas tagihannya sendiri (sama semangat payments/claim) ATAU
// bendahara (ManageMoney) yang mau nagih orang lain — dicek manual,
// bukan RequirePerm tetap.
func handleShareBill(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, _ := userIDFromContext(r.Context())
		clubID, _ := clubIDFromContext(r.Context())
		granted, _ := permFromContext(r.Context())
		targetID, err := uuid.Parse(chi.URLParam(r, "userId"))
		if err != nil {
			writeError(w, CodeNotFound, "Orang tidak ditemukan.", nil)
			return
		}
		if targetID != callerID && !granted[perm.ManageMoney] {
			writeError(w, CodeInsufficientPermission, "Cuma tagihan sendiri atau bendahara yang bisa membagikan tagihan orang lain.", nil)
			return
		}

		var text string
		var notFound bool
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			club, err := q.GetClub(ctx, clubID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					notFound = true
					return nil
				}
				return err
			}
			user, err := q.GetUser(ctx, targetID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					notFound = true
					return nil
				}
				return err
			}
			total, err := q.SumUnpaidByPayer(ctx, gen.SumUnpaidByPayerParams{ClubID: clubID, PayerID: targetID})
			if err != nil {
				return err
			}
			rows, err := q.ListUnpaidGamePlayersByPayer(ctx, gen.ListUnpaidGamePlayersByPayerParams{ClubID: clubID, PayerID: targetID})
			if err != nil {
				return err
			}
			text = billShareText(club.Name, user.DisplayName, total, rows)
			return nil
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal menyusun teks tagihan.", nil)
			return
		}
		if notFound {
			writeError(w, CodeNotFound, "Klub atau orang tidak ditemukan.", nil)
			return
		}
		writeJSON(w, http.StatusOK, shareTextDTO{Text: text})
	}
}

func billShareText(clubName, name string, total int64, rows []gen.ListUnpaidGamePlayersByPayerRow) string {
	var b strings.Builder
	if total <= 0 {
		fmt.Fprintf(&b, "Tagihan %s di %s: LUNAS ✅ Gak ada yang perlu dibayar.", name, clubName)
		return b.String()
	}
	fmt.Fprintf(&b, "Tagihan %s di %s:\n", name, clubName)
	for _, row := range rows {
		if row.DisputedAt.Valid || row.PaymentID != nil {
			continue // disanggah atau sedang dicek — jangan ikut ditagih ulang
		}
		fmt.Fprintf(&b, "- %s: %s\n", dateString(row.PlayedOn), rupiahText(row.Amount))
	}
	fmt.Fprintf(&b, "\nTotal: *%s*", rupiahText(total))
	return b.String()
}

// handleShareTournament — POST /clubs/{clubId}/share/tournament/{id}.
// Terbuka buat anggota mana pun (sama pola GET detail turnamen) — bukan
// data uang perorangan yang perlu digerbang.
func handleShareTournament(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Turnamen tidak ditemukan.", nil)
			return
		}
		dto, err := loadTournamentDTO(r.Context(), s, clubID, id)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				writeError(w, CodeNotFound, "Turnamen tidak ditemukan.", nil)
				return
			}
			writeError(w, CodeValidationFailed, "Gagal menyusun teks turnamen.", nil)
			return
		}
		writeJSON(w, http.StatusOK, shareTextDTO{Text: tournamentShareText(dto)})
	}
}

func tournamentShareText(t tournamentDTO) string {
	var b strings.Builder
	fmt.Fprintf(&b, "🏸 %s (%s)\n", t.Name, tanggalID(t.StartsOn))
	switch {
	case t.Finished && t.Champion != nil:
		fmt.Fprintf(&b, "Juara: *%s* 🏆\n", pairLabelText(t.Champion))
	case t.Finished:
		b.WriteString("Selesai.\n")
	default:
		fmt.Fprintf(&b, "%d/%d partai sudah main.\n", t.PlayedCount, t.TotalCount)
	}
	if len(t.Standings) > 0 {
		b.WriteString("\nKlasemen:\n")
		for i, row := range t.Standings {
			if i >= 5 {
				break // ringkas — bukan dump seluruh klasemen ke grup WA
			}
			fmt.Fprintf(&b, "%d. %s (%dM %dK)\n", i+1, pairLabelText(&row.Pair), row.Won, row.Lost)
		}
	}
	return strings.TrimSpace(b.String())
}

func pairLabelText(p *tournamentPairDTO) string {
	if p == nil {
		return "-"
	}
	var names []string
	if p.A != nil && p.A.Name != "" {
		names = append(names, p.A.Name)
	}
	if p.B != nil && p.B.Name != "" {
		names = append(names, p.B.Name)
	}
	return strings.Join(names, " / ")
}

// tanggalID — "8 Agustus 2026", cukup buat teks share (bukan format
// lengkap lib/format.ts di klien, yang formatnya lebih kaya).
func tanggalID(iso string) string {
	d, err := parseDate(iso)
	if err != nil || !d.Valid {
		return iso
	}
	bulan := [...]string{"Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"}
	t := d.Time
	return fmt.Sprintf("%d %s %d", t.Day(), bulan[t.Month()-1], t.Year())
}
