-- name: ListScoredGamePlayersForLeaderboard :many
-- Papan peringkat klub (PLAN.md §8.3, §14 F7) — cuma main yang SUDAH
-- dinilai (winner_side terisi) yang ikut kehitung; main tanpa skor
-- dilewati begitu saja di domain.LeaderboardOf. Diurutkan per tanggal
-- naik supaya rentetan kemenangan (streak) terhitung benar di lapisan Go.
SELECT gp.user_id, g.played_on, gp.side, g.winner_side
FROM games g
JOIN game_players gp ON gp.game_id = g.id
WHERE g.club_id = $1 AND g.deleted_at IS NULL AND g.winner_side IS NOT NULL
  AND (sqlc.narg(season_start)::date IS NULL OR g.played_on >= sqlc.narg(season_start))
  AND (sqlc.narg(season_end)::date IS NULL OR g.played_on <= sqlc.narg(season_end))
ORDER BY g.played_on, g.id;
