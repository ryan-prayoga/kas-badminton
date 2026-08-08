// Pemicu notifikasi F8 dari catat main (PLAN.md §10.1: "kamu dicatat
// ikut main" → Push, dan §8.2 "penanggung dapat notifikasi ... yang
// ditanggung dapat ..."). Dipisah dari games.go biar handleCreateGame
// tidak makin panjang — dipanggil di dalam transaksi yang sama, sama
// pola realtime.Publish(ctx, q, event).
package httpapi

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/domain"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/notify"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

func notifyGamePlayers(ctx context.Context, q *gen.Queries, clubID uuid.UUID, players []gen.GamePlayer, playedOn string) error {
	club, err := q.GetClub(ctx, clubID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()

	// Nama ditampilkan di teks notifikasi — kumpulkan sekali, dedup.
	names, err := namesFor(ctx, q, gamePlayerUserIDs(players))
	if err != nil {
		return err
	}

	for _, p := range players {
		if err := notify.Enqueue(ctx, q, notify.NotifyInput{
			UserID: p.UserID, ClubID: &clubID, ClubTimezone: club.Timezone,
			Kind: domain.NotifGameRecorded, Now: now,
			Title: "Kamu dicatat ikut main",
			Body:  fmt.Sprintf("Main %s di %s — cek tagihanmu.", playedOn, club.Name),
		}); err != nil {
			return err
		}
		if p.PayerID == p.UserID {
			continue
		}
		if err := notify.Enqueue(ctx, q, notify.NotifyInput{
			UserID: p.PayerID, ClubID: &clubID, ClubTimezone: club.Timezone,
			Kind: domain.NotifBillPayerChanged, Now: now,
			Title: "Kamu nanggung tagihan orang lain",
			Body:  fmt.Sprintf("Kamu nanggung tagihan %s buat main %s di %s.", names[p.UserID], playedOn, club.Name),
		}); err != nil {
			return err
		}
		if err := notify.Enqueue(ctx, q, notify.NotifyInput{
			UserID: p.UserID, ClubID: &clubID, ClubTimezone: club.Timezone,
			Kind: domain.NotifBillPayerChanged, Now: now,
			Title: "Tagihanmu dibayarin orang lain",
			Body:  fmt.Sprintf("Tagihanmu buat main %s di %s dibayarin %s.", playedOn, club.Name, names[p.PayerID]),
		}); err != nil {
			return err
		}
	}
	return nil
}

func gamePlayerUserIDs(players []gen.GamePlayer) []uuid.UUID {
	seen := map[uuid.UUID]bool{}
	var ids []uuid.UUID
	for _, p := range players {
		for _, id := range [2]uuid.UUID{p.UserID, p.PayerID} {
			if !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
	}
	return ids
}

// namesFor — display_name buat sekumpulan user_id, dipakai nyusun teks
// notifikasi manusiawi ("kamu nanggung tagihan Rian", bukan cuma id).
func namesFor(ctx context.Context, q *gen.Queries, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	names := map[uuid.UUID]string{}
	if len(ids) == 0 {
		return names, nil
	}
	users, err := q.ListUsersByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, u := range users {
		names[u.ID] = u.DisplayName
	}
	return names, nil
}
