package migratev2

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Reader — sumber data v2, diabstraksi lewat interface supaya migrate.go
// bisa diuji dengan fake in-memory (migrate_test.go) TANPA butuh Postgres
// v2 sungguhan berisi data — cuma v3 (tujuan tulis) yang perlu Postgres
// asli di test (testdb, pola sama seluruh internal/http).
type Reader interface {
	Players(ctx context.Context) ([]V2Player, error)
	Carry(ctx context.Context) ([]V2Carry, error)
	KokTypes(ctx context.Context) ([]V2KokType, error)
	Games(ctx context.Context) ([]V2Game, error)
	Expenses(ctx context.Context) ([]V2Expense, error)
	Tournaments(ctx context.Context) ([]V2Tournament, error)
}

// PgReader — Reader sungguhan lewat pgxpool ke DATABASE_URL v2 (dev:
// postgresql://ryanprayoga@127.0.0.1:5432/kok_badminton — lihat
// v2/.env). Read-only: cuma SELECT, tidak pernah menulis (lihat komentar
// package types.go).
type PgReader struct{ pool *pgxpool.Pool }

func NewPgReader(pool *pgxpool.Pool) *PgReader { return &PgReader{pool: pool} }

func (r *PgReader) Players(ctx context.Context) ([]V2Player, error) {
	rows, err := r.pool.Query(ctx, `SELECT name, photo FROM players ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("migratev2: baca players: %w", err)
	}
	defer rows.Close()
	var out []V2Player
	for rows.Next() {
		var p V2Player
		if err := rows.Scan(&p.Name, &p.Photo); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *PgReader) Carry(ctx context.Context) ([]V2Carry, error) {
	rows, err := r.pool.Query(ctx, `SELECT name, carry FROM player_carry ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("migratev2: baca player_carry: %w", err)
	}
	defer rows.Close()
	var out []V2Carry
	for rows.Next() {
		var c V2Carry
		if err := rows.Scan(&c.Name, &c.Carry); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *PgReader) KokTypes(ctx context.Context) ([]V2KokType, error) {
	rows, err := r.pool.Query(ctx, `SELECT id, name, price_per_person, price_per_slop, stock, active FROM kok_types ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("migratev2: baca kok_types: %w", err)
	}
	defer rows.Close()
	var out []V2KokType
	for rows.Next() {
		var k V2KokType
		if err := rows.Scan(&k.ID, &k.Name, &k.PricePerPerson, &k.PricePerSlop, &k.Stock, &k.Active); err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

// jsonPlayer/jsonKok — bentuk mentah kolom JSON v2 (lib/domain/types.ts
// Player/Kok), field opsional sengaja pointer supaya "tidak ada di JSON"
// beda dari "ada tapi kosong".
type jsonPlayer struct {
	Name   string  `json:"name"`
	Paid   bool    `json:"paid"`
	PaidAt *string `json:"paidAt"`
	PaidBy *string `json:"paidBy"`
}

type jsonKok struct {
	TypeID         *string `json:"typeId"`
	TypeName       *string `json:"typeName"`
	PricePerPerson int64   `json:"pricePerPerson"`
}

func (r *PgReader) Games(ctx context.Context) ([]V2Game, error) {
	rows, err := r.pool.Query(ctx, `SELECT id, date, players, koks, notes, recorded_by, created_at, updated_at FROM games ORDER BY date, created_at`)
	if err != nil {
		return nil, fmt.Errorf("migratev2: baca games: %w", err)
	}
	defer rows.Close()
	var out []V2Game
	for rows.Next() {
		var (
			g          V2Game
			playersRaw []byte
			koksRaw    []byte
			notes      *string
			recordedBy *string
		)
		if err := rows.Scan(&g.ID, &g.Date, &playersRaw, &koksRaw, &notes, &recordedBy, &g.CreatedAt, &g.UpdatedAt); err != nil {
			return nil, err
		}
		g.Notes = notes
		g.RecordedBy = recordedBy

		var jp []jsonPlayer
		if err := json.Unmarshal(playersRaw, &jp); err != nil {
			return nil, fmt.Errorf("migratev2: parse players game %s: %w", g.ID, err)
		}
		for _, p := range jp {
			gp := V2GamePlayer{Name: p.Name, Paid: p.Paid, PaidBy: p.PaidBy}
			if p.PaidAt != nil {
				t, err := time.Parse(time.RFC3339, *p.PaidAt)
				if err != nil {
					return nil, fmt.Errorf("migratev2: parse paidAt game %s pemain %q: %w", g.ID, p.Name, err)
				}
				gp.PaidAt = &t
			}
			g.Players = append(g.Players, gp)
		}

		var jk []jsonKok
		if err := json.Unmarshal(koksRaw, &jk); err != nil {
			return nil, fmt.Errorf("migratev2: parse koks game %s: %w", g.ID, err)
		}
		for _, k := range jk {
			g.Koks = append(g.Koks, V2GameKok{TypeID: k.TypeID, TypeName: k.TypeName, PricePerPerson: k.PricePerPerson})
		}

		out = append(out, g)
	}
	return out, rows.Err()
}

// jsonPair/jsonMatchScore/jsonTournamentKok/jsonTournamentFee — bentuk
// mentah kolom JSON `tournaments` (lib/domain/types.ts TournamentPair/
// MatchScore/TournamentKok/TournamentFee).
type jsonPair struct {
	ID   string `json:"id"`
	Slot int    `json:"slot"`
	A    string `json:"a"`
	B    string `json:"b"`
}

type jsonMatchScore struct {
	Format   string          `json:"format"`
	Games    []jsonGameScore `json:"games"`
	PlayedAt *string         `json:"playedAt"`
}

type jsonGameScore struct {
	A int `json:"a"`
	B int `json:"b"`
}

type jsonTournamentKok struct {
	TypeID         *string `json:"typeId"`
	TypeName       *string `json:"typeName"`
	PricePerPerson int64   `json:"pricePerPerson"`
	MatchID        *string `json:"matchId"`
	Date           string  `json:"date"`
}

type jsonTournamentFee struct {
	Name   string  `json:"name"`
	Paid   bool    `json:"paid"`
	PaidAt *string `json:"paidAt"`
	PaidBy *string `json:"paidBy"`
}

func (r *PgReader) Tournaments(ctx context.Context) ([]V2Tournament, error) {
	rows, err := r.pool.Query(ctx, `SELECT id, name, date, end_date, size, format, fee, score_format, pairs, results, koks, fees, match_kok_paid, notes, recorded_by, created_at, updated_at FROM tournaments ORDER BY date, created_at`)
	if err != nil {
		return nil, fmt.Errorf("migratev2: baca tournaments: %w", err)
	}
	defer rows.Close()

	var out []V2Tournament
	for rows.Next() {
		var (
			t                                                       V2Tournament
			pairsRaw, resultsRaw, koksRaw, feesRaw, matchKokPaidRaw []byte
			endDate, notes, recordedBy                              *string
		)
		if err := rows.Scan(&t.ID, &t.Name, &t.Date, &endDate, &t.Size, &t.Format, &t.Fee, &t.ScoreFormat,
			&pairsRaw, &resultsRaw, &koksRaw, &feesRaw, &matchKokPaidRaw, &notes, &recordedBy, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		t.EndDate, t.Notes, t.RecordedBy = endDate, notes, recordedBy

		var jp []jsonPair
		if err := json.Unmarshal(pairsRaw, &jp); err != nil {
			return nil, fmt.Errorf("migratev2: parse pairs turnamen %s: %w", t.ID, err)
		}
		for _, p := range jp {
			t.Pairs = append(t.Pairs, V2Pair{ID: p.ID, Slot: p.Slot, A: p.A, B: p.B})
		}

		var jr map[string]jsonMatchScore
		if err := json.Unmarshal(resultsRaw, &jr); err != nil {
			return nil, fmt.Errorf("migratev2: parse results turnamen %s: %w", t.ID, err)
		}
		t.Results = map[string]V2MatchScore{}
		for id, sc := range jr {
			var games []V2GameScore
			for _, g := range sc.Games {
				games = append(games, V2GameScore{A: g.A, B: g.B})
			}
			t.Results[id] = V2MatchScore{Format: sc.Format, Games: games, PlayedAt: sc.PlayedAt}
		}

		var jk []jsonTournamentKok
		if err := json.Unmarshal(koksRaw, &jk); err != nil {
			return nil, fmt.Errorf("migratev2: parse koks turnamen %s: %w", t.ID, err)
		}
		for _, k := range jk {
			t.Koks = append(t.Koks, V2TournamentKok{TypeID: k.TypeID, TypeName: k.TypeName, PricePerPerson: k.PricePerPerson, MatchID: k.MatchID, Date: k.Date})
		}

		var jf []jsonTournamentFee
		if err := json.Unmarshal(feesRaw, &jf); err != nil {
			return nil, fmt.Errorf("migratev2: parse fees turnamen %s: %w", t.ID, err)
		}
		for _, f := range jf {
			t.Fees = append(t.Fees, V2TournamentFee{Name: f.Name, Paid: f.Paid, PaidAt: f.PaidAt, PaidBy: f.PaidBy})
		}

		var jmkp map[string][4]bool
		if err := json.Unmarshal(matchKokPaidRaw, &jmkp); err != nil {
			return nil, fmt.Errorf("migratev2: parse match_kok_paid turnamen %s: %w", t.ID, err)
		}
		t.MatchKokPaid = jmkp

		out = append(out, t)
	}
	return out, rows.Err()
}

func (r *PgReader) Expenses(ctx context.Context) ([]V2Expense, error) {
	rows, err := r.pool.Query(ctx, `SELECT id, type_id, type_name, slops, amount, created_at FROM expenses ORDER BY created_at`)
	if err != nil {
		return nil, fmt.Errorf("migratev2: baca expenses: %w", err)
	}
	defer rows.Close()
	var out []V2Expense
	for rows.Next() {
		var e V2Expense
		if err := rows.Scan(&e.ID, &e.TypeID, &e.TypeName, &e.Slops, &e.Amount, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
