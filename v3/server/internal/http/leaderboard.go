// Papan peringkat klub (PLAN.md §8.3, §14 F7, API.md §5 "GET .../leaderboard
// ?season= — 404 kalau saklar mati"). Klasemen dihitung MURNI di
// internal/domain (LeaderboardOf) dari baris main-yang-sudah-berskor — HTTP
// layer di sini cuma query + terjemahkan uuid→nama, sama pembagian tanggung
// jawab dengan tournaments.go.
package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/domain"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// papanPeringkatEnabled — saklar clubs.settings.papan_peringkat, default
// true. Pola identik transparansiKas (treasury.go): field hilang di JSON
// lama (klub dibuat sebelum saklar ini ada) tetap dianggap nyala.
func papanPeringkatEnabled(c gen.Club) bool {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(c.Settings, &raw); err != nil {
		return true
	}
	v, ok := raw["papan_peringkat"]
	if !ok {
		return true
	}
	var b bool
	if err := json.Unmarshal(v, &b); err != nil {
		return true
	}
	return b
}

type leaderboardRowDTO struct {
	UserID           uuid.UUID `json:"user_id"`
	Name             string    `json:"name"`
	Played           int       `json:"played"`
	Won              int       `json:"won"`
	Lost             int       `json:"lost"`
	WinRatePermil    int       `json:"win_rate_permil"`
	CurrentStreak    int       `json:"current_streak"`
	LongestWinStreak int       `json:"longest_win_streak"`
}

type leaderboardDTO struct {
	Season string              `json:"season"`
	Rows   []leaderboardRowDTO `json:"rows"`
}

// handleGetLeaderboard — GET /clubs/{clubId}/leaderboard?season=YYYY.
// "season" belum didefinisikan presisi di PLAN.md di luar "papan peringkat
// klub" — diperlakukan sebagai TAHUN kalender (default tahun berjalan di
// zona server), pola paling sederhana yang tetap berarti buat pengurus
// klub ("musim 2026"). Kosongkan season lewat ?season=all buat semua waktu.
func handleGetLeaderboard(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())

		season := r.URL.Query().Get("season")
		if season == "" {
			season = strconv.Itoa(time.Now().UTC().Year())
		}
		var start, end pgtype.Date
		if season != "all" {
			year, err := strconv.Atoi(season)
			if err != nil || year < 2000 || year > 3000 {
				writeError(w, CodeValidationFailed, "Parameter season harus tahun (mis. 2026) atau \"all\".", nil)
				return
			}
			start = pgtype.Date{Time: time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC), Valid: true}
			end = pgtype.Date{Time: time.Date(year, 12, 31, 0, 0, 0, 0, time.UTC), Valid: true}
		}

		var enabled bool
		var rows []gen.ListScoredGamePlayersForLeaderboardRow
		var names map[uuid.UUID]string
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			club, err := q.GetClub(ctx, clubID)
			if err != nil {
				return err
			}
			enabled = papanPeringkatEnabled(club)
			if !enabled {
				return nil
			}
			rows, err = q.ListScoredGamePlayersForLeaderboard(ctx, gen.ListScoredGamePlayersForLeaderboardParams{
				ClubID: clubID, SeasonStart: start, SeasonEnd: end,
			})
			if err != nil {
				return err
			}
			userIDSet := map[uuid.UUID]bool{}
			for _, row := range rows {
				userIDSet[row.UserID] = true
			}
			ids := make([]uuid.UUID, 0, len(userIDSet))
			for id := range userIDSet {
				ids = append(ids, id)
			}
			names = map[uuid.UUID]string{}
			if len(ids) > 0 {
				users, err := q.ListUsersByIDs(ctx, ids)
				if err != nil {
					return err
				}
				for _, u := range users {
					names[u.ID] = u.DisplayName
				}
			}
			return nil
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil papan peringkat.", nil)
			return
		}
		if !enabled {
			writeError(w, CodeNotFound, "Papan peringkat dimatikan di klub ini.", nil)
			return
		}

		results := make([]domain.PlayerGameResult, len(rows))
		for i, row := range rows {
			winner := domain.SideNil
			if row.WinnerSide.Valid {
				winner = domain.Side(row.WinnerSide.GameSide)
			}
			results[i] = domain.PlayerGameResult{
				UserID: row.UserID.String(), PlayedOn: dateString(row.PlayedOn),
				Side: domain.Side(row.Side), WinnerSide: winner,
			}
		}
		computed := domain.LeaderboardOf(results)

		out := make([]leaderboardRowDTO, len(computed))
		for i, r := range computed {
			uid := uuid.MustParse(r.UserID)
			out[i] = leaderboardRowDTO{
				UserID: uid, Name: names[uid], Played: r.Played, Won: r.Won, Lost: r.Lost,
				WinRatePermil: r.WinRatePermil(), CurrentStreak: r.CurrentStreak, LongestWinStreak: r.LongestWinStreak,
			}
		}
		writeJSON(w, http.StatusOK, leaderboardDTO{Season: season, Rows: out})
	}
}
