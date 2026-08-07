package domain

import (
	"regexp"
	"time"
)

var isoDateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

const dateLayout = "2006-01-02"

// mustParseDate parsa YYYY-MM-DD sebagai UTC. Dipanggil cuma dari path yang
// sudah divalidasi isoDateRe di pemanggilnya (TournamentDays) — tanggal yang
// tidak valid balik ke zero time, bukan panic.
func mustParseDate(s string) time.Time {
	t, err := time.Parse(dateLayout, s)
	if err != nil {
		return time.Time{}
	}
	return t
}

func formatDate(t time.Time) string {
	return t.Format(dateLayout)
}
