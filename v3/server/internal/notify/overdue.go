// Tunggakan lewat batas (PLAN.md §10.3, §14 F8) — scanner periodik,
// BEDA dari Dispatcher (yang cuma mengirim baris yang SUDAH diantre).
// Pekerjaan di sini adalah MEMUTUSKAN siapa yang perlu diingatkan sama
// sekali: dua syarat DAN (umur ≥ tunggakan_hari, nominal ≥
// tunggakan_minimal) + jeda tunggakan_jeda_hari sejak pengingat
// terakhir. Dipanggil berkala dari cmd/api (ticker terpisah dari
// Dispatcher — jauh lebih jarang, ambang harinya kasar).
package notify

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/domain"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// clubSettingsSubset — cuma kunci yang dipakai scanner ini, sengaja tidak
// impor defaultClubSettings dari internal/http (itu bergantung ke paket
// ini lewat notify.Enqueue — impor baliknya bikin siklus). Kunci JSON
// harus PERSIS sama dengan clubs.go.
type clubSettingsSubset struct {
	TunggakanHari     int   `json:"tunggakan_hari"`
	TunggakanMinimal  int64 `json:"tunggakan_minimal"`
	TunggakanJedaHari int   `json:"tunggakan_jeda_hari"`
	PengingatWa       bool  `json:"pengingat_wa"`
}

func parseClubSettings(raw []byte) clubSettingsSubset {
	cs := clubSettingsSubset{TunggakanHari: 14, TunggakanMinimal: 50000, TunggakanJedaHari: 7}
	_ = json.Unmarshal(raw, &cs)
	return cs
}

// OverdueScanner jalan berkala mengirim "debt_overdue" ke siapa pun yang
// memenuhi DUA syarat sekaligus di klubnya masing-masing.
type OverdueScanner struct {
	store  *store.Store
	logger *slog.Logger
}

func NewOverdueScanner(s *store.Store, logger *slog.Logger) *OverdueScanner {
	return &OverdueScanner{store: s, logger: logger}
}

func (o *OverdueScanner) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := o.ScanOnce(ctx); err != nil {
				o.logger.Error("notify: scan tunggakan gagal", "err", err)
			}
		}
	}
}

func (o *OverdueScanner) ScanOnce(ctx context.Context) error {
	var clubIDs []uuid.UUID
	if err := o.store.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		var err error
		clubIDs, err = q.ListActiveClubIDs(ctx)
		return err
	}); err != nil {
		return err
	}

	now := time.Now().UTC()
	for _, clubID := range clubIDs {
		// SATU transaksi PER KLUB (bukan satu transaksi lintas semua
		// klub di atas) — game_players/games ber-RLS (§6.2), butuh
		// SET LOCAL app.club_id lewat WithClub. `clubs` dan
		// `notifications` sendiri tidak ber-RLS (00016), jadi aman ikut
		// dibaca/ditulis lewat q yang sama di dalam WithClub ini.
		if err := o.store.WithClub(ctx, clubID, func(ctx context.Context, q *gen.Queries) error {
			return o.scanClub(ctx, q, clubID, now)
		}); err != nil {
			o.logger.Error("notify: scan tunggakan klub gagal", "club_id", clubID, "err", err)
		}
	}
	return nil
}

func (o *OverdueScanner) scanClub(ctx context.Context, q *gen.Queries, clubID uuid.UUID, now time.Time) error {
	club, err := q.GetClub(ctx, clubID)
	if err != nil {
		return err
	}
	cs := parseClubSettings(club.Settings)

	debtors, err := q.ListOverdueDebtorsByClub(ctx, clubID)
	if err != nil {
		return err
	}
	for _, d := range debtors {
		if d.TotalOwed < cs.TunggakanMinimal {
			continue
		}
		ageDays := int(now.Sub(d.EarliestUnpaid.Time).Hours() / 24)
		if ageDays < cs.TunggakanHari {
			continue
		}
		last, err := q.GetLastDebtOverdueNotification(ctx, gen.GetLastDebtOverdueNotificationParams{UserID: d.PayerID, ClubID: &clubID})
		if err == nil {
			if now.Sub(last.CreatedAt.Time) < time.Duration(cs.TunggakanJedaHari)*24*time.Hour {
				continue
			}
		} else if err != pgx.ErrNoRows {
			return err
		}

		var forceChannel *domain.NotifChannel
		if !cs.PengingatWa {
			push := domain.ChannelPush
			forceChannel = &push
		}
		if err := Enqueue(ctx, q, NotifyInput{
			UserID: d.PayerID, ClubID: &clubID, ClubTimezone: club.Timezone,
			Kind: domain.NotifDebtOverdue, Now: now, ForceChannel: forceChannel,
			Title: "Sisa patungan kamu",
			Body:  fmt.Sprintf("Sisa patungan kamu di %s %s, sudah %d hari. Yuk diselesaikan.", club.Name, rupiahTextNotify(d.TotalOwed), ageDays),
		}); err != nil {
			return err
		}
	}
	return nil
}

// rupiahTextNotify — duplikat kecil internal/http.rupiahText (paket ini
// sengaja tidak impor internal/http, arah dependensinya kebalik: http
// impor notify, bukan sebaliknya).
func rupiahTextNotify(amount int64) string {
	s := fmt.Sprintf("%d", amount)
	var out []byte
	for i, c := range []byte(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, '.')
		}
		out = append(out, c)
	}
	return "Rp" + string(out)
}
