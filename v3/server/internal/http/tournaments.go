// F7 (PLAN.md §14, API.md §5) — turnamen: bagan/klasemen, skor, kok
// per-partai & kok umum (menutup lubang kok lepas v2), iuran.
//
// Bagan & klasemen TIDAK disimpan — dihitung ulang tiap request lewat
// internal/domain (BuildBracket/BuildRoundRobin, F1), persis pola v2. DB
// cuma menyimpan input mentah: pairs, skor per partai, kok, iuran. Beda
// dari domain.go yang aslinya diport dari v2 (pasangan direpresentasikan
// sebagai NAMA), skema v3 (tournament_pairs.player_a/b) menunjuk ke
// users.id — jadi loadTournament di bawah menerjemahkan id → nama dulu
// sebelum masuk ke domain, dan menyimpan pemetaan sebaliknya (pairsByID)
// buat menagih kok/iuran ke akun yang benar.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/domain"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/realtime"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

var validTournamentFormats = map[string]bool{"knockout": true, "round_robin": true}

// Tournament pakai subset domain.ScoreFormat (single/bo3) — rally42 §8.3
// khusus main harian, v2 tidak pernah punya bagan rally42 dan domain.go
// (F1) sengaja tidak mem-portnya buat turnamen.
var validTournamentScoreFormats = map[string]bool{"single": true, "bo3": true}

// --- pemetaan id partai domain (string "r0-0"/"rr1-2") <-> round/idx DB ---
//
// matches.round/idx BUKAN mengikuti arti "babak ke-n" untuk round robin
// (yang tidak punya babak) — di situ round selalu 0 dan idx = i*100+j
// (slot pasangan i<j, aman sampai MaxPairs=32). Knockout pakai round/idx
// apa adanya dari domain.MatchID.

func matchDBCoords(format gen.TournamentFormat, id string) (round, idx int32, err error) {
	if format == gen.TournamentFormatRoundRobin {
		var i, j int
		if _, e := fmt.Sscanf(id, "rr%d-%d", &i, &j); e != nil {
			return 0, 0, fmt.Errorf("id partai tidak valid")
		}
		if i > j {
			i, j = j, i
		}
		return 0, int32(i*100 + j), nil
	}
	var r, ix int
	if _, e := fmt.Sscanf(id, "r%d-%d", &r, &ix); e != nil {
		return 0, 0, fmt.Errorf("id partai tidak valid")
	}
	return int32(r), int32(ix), nil
}

func matchDomainID(format gen.TournamentFormat, round, idx int32) string {
	if format == gen.TournamentFormatRoundRobin {
		return domain.RRMatchID(int(idx/100), int(idx%100))
	}
	return domain.MatchID(int(round), int(idx))
}

// --- muat turnamen dari DB ke bentuk domain ---

type pairMeta struct {
	ID      uuid.UUID
	Slot    int
	AUserID *uuid.UUID
	BUserID *uuid.UUID
}

type tournamentLoad struct {
	Tournament    gen.Tournament
	Stored        domain.StoredTournament
	Enriched      domain.EnrichedTournament
	PairsByID     map[string]pairMeta
	MatchDomainID map[uuid.UUID]string // matches.id -> id string domain
	Koks          []gen.MatchKok
	Charges       []gen.MatchKokCharge
	Fees          []gen.TournamentFee
	Names         map[uuid.UUID]string
}

func loadTournament(ctx context.Context, q *gen.Queries, clubID, id uuid.UUID) (*tournamentLoad, error) {
	t, err := q.GetTournament(ctx, gen.GetTournamentParams{ID: id, ClubID: clubID})
	if err != nil {
		return nil, err
	}

	pairRows, err := q.ListTournamentPairsByTournament(ctx, id)
	if err != nil {
		return nil, err
	}
	matchRows, err := q.ListMatchesByTournament(ctx, id)
	if err != nil {
		return nil, err
	}
	gameRows, err := q.ListMatchGamesByTournament(ctx, id)
	if err != nil {
		return nil, err
	}
	kokRows, err := q.ListMatchKoksByTournament(ctx, id)
	if err != nil {
		return nil, err
	}
	chargeRows, err := q.ListMatchKokChargesByTournament(ctx, id)
	if err != nil {
		return nil, err
	}
	feeRows, err := q.ListTournamentFeesByTournament(ctx, id)
	if err != nil {
		return nil, err
	}

	matchDomainIDByDBID := make(map[uuid.UUID]string, len(matchRows))
	for _, m := range matchRows {
		matchDomainIDByDBID[m.ID] = matchDomainID(t.Format, m.Round, m.Idx)
	}

	// Nama buat label bagan (domain.TournamentPair.A/B) — kumpulkan semua
	// user_id yang muncul (pairs, iuran, tagihan kok) sekali, satu query.
	userIDSet := map[uuid.UUID]bool{}
	for _, p := range pairRows {
		if p.PlayerA != nil {
			userIDSet[*p.PlayerA] = true
		}
		if p.PlayerB != nil {
			userIDSet[*p.PlayerB] = true
		}
	}
	for _, f := range feeRows {
		userIDSet[f.UserID] = true
	}
	for _, c := range chargeRows {
		userIDSet[c.UserID] = true
	}
	userIDs := make([]uuid.UUID, 0, len(userIDSet))
	for id := range userIDSet {
		userIDs = append(userIDs, id)
	}
	names := map[uuid.UUID]string{}
	if len(userIDs) > 0 {
		users, err := q.ListUsersByIDs(ctx, userIDs)
		if err != nil {
			return nil, err
		}
		for _, u := range users {
			names[u.ID] = u.DisplayName
		}
	}

	size := int(t.Size)
	pairsBySlot := make(map[int]gen.TournamentPair, len(pairRows))
	for _, p := range pairRows {
		pairsBySlot[int(p.Slot)] = p
	}
	domainPairs := make([]domain.TournamentPair, size)
	pairsByID := make(map[string]pairMeta, len(pairRows))
	for slot := 0; slot < size; slot++ {
		p, ok := pairsBySlot[slot]
		if !ok {
			// Slot tanpa pasangan = BYE (domain.IsPairEmpty via nama
			// kosong) — id placeholder tidak pernah dipakai buat apa pun
			// (bukan uuid asli, tidak akan cocok di pairsByID).
			domainPairs[slot] = domain.TournamentPair{ID: fmt.Sprintf("empty-slot-%d", slot), Slot: slot}
			continue
		}
		aName, bName := "", ""
		if p.PlayerA != nil {
			aName = names[*p.PlayerA]
		}
		if p.PlayerB != nil {
			bName = names[*p.PlayerB]
		}
		domainPairs[slot] = domain.TournamentPair{ID: p.ID.String(), Slot: slot, A: aName, B: bName}
		pairsByID[p.ID.String()] = pairMeta{ID: p.ID, Slot: slot, AUserID: p.PlayerA, BUserID: p.PlayerB}
	}

	// Skor per partai: gabung baris match_games per id domain, lalu
	// dinormalisasi ulang (buang game 0-0, potong lebih dari format) —
	// sama fungsi yang dipakai saat menyimpan, jadi baca & tulis konsisten.
	type acc struct {
		games    []domain.GameScore
		playedAt string
	}
	accs := map[string]*acc{}
	for _, row := range gameRows {
		mid := matchDomainID(t.Format, row.Round, row.Idx)
		a, ok := accs[mid]
		if !ok {
			played := ""
			if row.PlayedOn.Valid {
				played = dateString(row.PlayedOn)
			}
			a = &acc{playedAt: played}
			accs[mid] = a
		}
		a.games = append(a.games, domain.GameScore{A: int(row.ScoreA), B: int(row.ScoreB)})
	}
	scoreFormat := domain.NormalizeScoreFormat(domain.ScoreFormat(t.ScoreFormat))
	results := map[string]domain.MatchScore{}
	for mid, a := range accs {
		ms := domain.NormalizeMatchScore(domain.MatchScore{Format: scoreFormat, Games: a.games, PlayedAt: a.playedAt})
		if ms != nil {
			results[mid] = *ms
		}
	}

	domainKoks := make([]domain.TournamentKok, len(kokRows))
	for i, k := range kokRows {
		mid := ""
		if k.MatchID != nil {
			mid = matchDomainIDByDBID[*k.MatchID]
		}
		used := ""
		if k.UsedOn.Valid {
			used = dateString(k.UsedOn)
		}
		domainKoks[i] = domain.TournamentKok{
			Kok:     domain.Kok{Price: k.PricePerPerson * int64(k.Qty)},
			MatchID: mid,
			Date:    used,
		}
	}

	domainFees := make([]domain.TournamentFee, len(feeRows))
	for i, f := range feeRows {
		domainFees[i] = domain.TournamentFee{Name: names[f.UserID], Paid: f.PaidAt.Valid}
	}

	endDate := ""
	if t.EndsOn.Valid {
		endDate = dateString(t.EndsOn)
	}
	stored := domain.StoredTournament{
		ID:          t.ID.String(),
		Name:        t.Name,
		Date:        dateString(t.StartsOn),
		EndDate:     endDate,
		Format:      domain.TournamentFormat(t.Format),
		Size:        size,
		Fee:         t.Fee,
		ScoreFormat: scoreFormat,
		Pairs:       domainPairs,
		Results:     results,
		Koks:        domainKoks,
		Fees:        domainFees,
		Notes:       t.Notes.String,
	}

	// Charges pun perlu dipetakan per posisi slot [Aa,Ab,Ba,Bb] buat tiap
	// partai (domain.MatchKokPaid) — itu butuh tahu SIAPA main di partai
	// mana, yang baru diketahui setelah bagan pertama kali dihitung (siapa
	// lolos dari babak sebelumnya). Makanya EnrichTournament dipanggil DUA
	// KALI: sekali buat dapat pemetaan partai→pasangan, sekali lagi setelah
	// MatchKokPaid terisi supaya KokPaid di respons akurat.
	enrich1 := domain.EnrichTournament(stored)
	chargedPaid := map[string]bool{} // key: matchDomainID(atau "" buat kok umum) + "|" + userID
	for _, c := range chargeRows {
		mid := ""
		if c.MatchID != nil {
			mid = matchDomainIDByDBID[*c.MatchID]
		}
		if c.PaidAt.Valid {
			chargedPaid[mid+"|"+c.UserID.String()] = true
		}
	}
	matchKokPaid := map[string][4]bool{}
	for _, m := range enrich1.Matches {
		ids := matchParticipantUserIDs(m, pairsByID)
		var paid [4]bool
		for i, uid := range ids {
			if uid != nil && chargedPaid[m.ID+"|"+uid.String()] {
				paid[i] = true
			}
		}
		matchKokPaid[m.ID] = paid
	}
	stored.MatchKokPaid = matchKokPaid
	enriched := domain.EnrichTournament(stored)

	return &tournamentLoad{
		Tournament:    t,
		Stored:        stored,
		Enriched:      enriched,
		PairsByID:     pairsByID,
		MatchDomainID: matchDomainIDByDBID,
		Koks:          kokRows,
		Charges:       chargeRows,
		Fees:          feeRows,
		Names:         names,
	}, nil
}

// matchParticipantUserIDs — 4 user_id partai ini, urutan
// [sisiA.a, sisiA.b, sisiB.a, sisiB.b] (sama urutan domain.MatchParticipants).
// nil kalau slotnya BYE/kosong atau pasangannya bukan dari klub ini.
func matchParticipantUserIDs(m domain.BracketMatch, pairsByID map[string]pairMeta) [4]*uuid.UUID {
	var out [4]*uuid.UUID
	if m.A.Pair != nil {
		if pm, ok := pairsByID[m.A.Pair.ID]; ok {
			out[0], out[1] = pm.AUserID, pm.BUserID
		}
	}
	if m.B.Pair != nil {
		if pm, ok := pairsByID[m.B.Pair.ID]; ok {
			out[2], out[3] = pm.AUserID, pm.BUserID
		}
	}
	return out
}

// --- DTO ---

type tournamentParticipantDTO struct {
	UserID uuid.UUID `json:"user_id,omitempty"`
	Name   string    `json:"name"`
}

type tournamentPairDTO struct {
	ID   uuid.UUID                 `json:"id,omitempty"`
	Slot int                       `json:"slot"`
	A    *tournamentParticipantDTO `json:"a,omitempty"`
	B    *tournamentParticipantDTO `json:"b,omitempty"`
}

func sidePairDTO(p *domain.TournamentPair, meta map[string]pairMeta) *tournamentPairDTO {
	if p == nil || domain.IsPairEmpty(p) {
		return nil
	}
	dto := &tournamentPairDTO{Slot: p.Slot}
	if m, ok := meta[p.ID]; ok {
		dto.ID = m.ID
		if p.A != "" {
			dto.A = &tournamentParticipantDTO{Name: p.A}
			if m.AUserID != nil {
				dto.A.UserID = *m.AUserID
			}
		}
		if p.B != "" {
			dto.B = &tournamentParticipantDTO{Name: p.B}
			if m.BUserID != nil {
				dto.B.UserID = *m.BUserID
			}
		}
	}
	return dto
}

type bracketSideDTO struct {
	Pair *tournamentPairDTO `json:"pair,omitempty"`
	Bye  bool               `json:"bye"`
}

type matchGameDTO struct {
	A int `json:"a"`
	B int `json:"b"`
}

type matchScoreDTO struct {
	Format   string         `json:"format"`
	Games    []matchGameDTO `json:"games"`
	PlayedAt string         `json:"played_at,omitempty"`
}

type bracketMatchDTO struct {
	ID        string         `json:"id"`
	Title     string         `json:"title"`
	Round     int            `json:"round"`
	Index     int            `json:"index"`
	A         bracketSideDTO `json:"a"`
	B         bracketSideDTO `json:"b"`
	Score     *matchScoreDTO `json:"score,omitempty"`
	GamesWonA int            `json:"games_won_a"`
	GamesWonB int            `json:"games_won_b"`
	Winner    string         `json:"winner,omitempty"`
	AutoWin   bool           `json:"auto_win"`
	KokTotal  int64          `json:"kok_total"`
	PlayedOn  string         `json:"played_on,omitempty"`
}

func newMatchDTO(t domain.StoredTournament, m domain.BracketMatch, meta map[string]pairMeta) bracketMatchDTO {
	dto := bracketMatchDTO{
		ID:        m.ID,
		Title:     domain.MatchTitle(t.Format, t.Size, m.Round, m.Index),
		Round:     m.Round,
		Index:     m.Index,
		A:         bracketSideDTO{Pair: sidePairDTO(m.A.Pair, meta), Bye: m.A.Bye},
		B:         bracketSideDTO{Pair: sidePairDTO(m.B.Pair, meta), Bye: m.B.Bye},
		GamesWonA: m.GamesWon.A,
		GamesWonB: m.GamesWon.B,
		Winner:    string(m.Winner),
		AutoWin:   m.AutoWin,
		KokTotal:  m.KokTotal,
	}
	if m.Score != nil {
		dto.PlayedOn = domain.MatchPlayedDate(t, m)
		games := make([]matchGameDTO, len(m.Score.Games))
		for i, g := range m.Score.Games {
			games[i] = matchGameDTO{A: g.A, B: g.B}
		}
		dto.Score = &matchScoreDTO{Format: string(m.Score.Format), Games: games, PlayedAt: m.Score.PlayedAt}
	}
	return dto
}

type standingRowDTO struct {
	Pair          tournamentPairDTO `json:"pair"`
	Played        int               `json:"played"`
	Won           int               `json:"won"`
	Lost          int               `json:"lost"`
	GamesFor      int               `json:"games_for"`
	GamesAgainst  int               `json:"games_against"`
	PointsFor     int               `json:"points_for"`
	PointsAgainst int               `json:"points_against"`
	Diff          int               `json:"diff"`
}

type tournamentCostDTO struct {
	KokCount     int   `json:"kok_count"`
	KokTotal     int64 `json:"kok_total"`
	KokPaid      int64 `json:"kok_paid"`
	Participants int   `json:"participants"`
	FeeTotal     int64 `json:"fee_total"`
	FeePaid      int64 `json:"fee_paid"`
	FeeUnpaid    int64 `json:"fee_unpaid"`
	PaidCount    int   `json:"paid_count"`
	UnpaidCount  int   `json:"unpaid_count"`
}

type tournamentKokDTO struct {
	ID             uuid.UUID `json:"id"`
	MatchID        string    `json:"match_id,omitempty"` // kosong = kok umum
	KokTypeID      *string   `json:"kok_type_id,omitempty"`
	TypeName       *string   `json:"type_name,omitempty"`
	PricePerPerson int64     `json:"price_per_person"`
	Qty            int32     `json:"qty"`
	UsedOn         string    `json:"used_on,omitempty"`
}

type tournamentKokChargeDTO struct {
	ID         uuid.UUID  `json:"id"`
	MatchID    string     `json:"match_id,omitempty"`
	UserID     uuid.UUID  `json:"user_id"`
	Name       string     `json:"name"`
	Amount     int64      `json:"amount"`
	PaidAt     *time.Time `json:"paid_at,omitempty"`
	DisputedAt *time.Time `json:"disputed_at,omitempty"`
	ChargedOn  string     `json:"charged_on,omitempty"`
}

type tournamentFeeDTO struct {
	UserID uuid.UUID  `json:"user_id"`
	Name   string     `json:"name"`
	Amount int64      `json:"amount"`
	PaidAt *time.Time `json:"paid_at,omitempty"`
}

type tournamentDTO struct {
	ID          uuid.UUID                `json:"id"`
	ClubID      uuid.UUID                `json:"club_id"`
	Name        string                   `json:"name"`
	StartsOn    string                   `json:"starts_on"`
	EndsOn      string                   `json:"ends_on,omitempty"`
	Format      string                   `json:"format"`
	Size        int                      `json:"size"`
	Fee         int64                    `json:"fee"`
	ScoreFormat string                   `json:"score_format"`
	Notes       *string                  `json:"notes,omitempty"`
	Status      string                   `json:"status"`
	CreatedAt   time.Time                `json:"created_at"`
	UpdatedAt   time.Time                `json:"updated_at"`
	Version     int64                    `json:"version"`
	Pairs       []tournamentPairDTO      `json:"pairs"`
	Rounds      []bracketRoundDTO        `json:"rounds,omitempty"`
	Matches     []bracketMatchDTO        `json:"matches,omitempty"`
	Standings   []standingRowDTO         `json:"standings,omitempty"`
	Champion    *tournamentPairDTO       `json:"champion,omitempty"`
	PlayedCount int                      `json:"played_count"`
	TotalCount  int                      `json:"total_count"`
	Finished    bool                     `json:"finished"`
	Cost        tournamentCostDTO        `json:"cost"`
	Koks        []tournamentKokDTO       `json:"koks,omitempty"`
	KokCharges  []tournamentKokChargeDTO `json:"kok_charges,omitempty"`
	Fees        []tournamentFeeDTO       `json:"fees,omitempty"`
}

type bracketRoundDTO struct {
	Round   int               `json:"round"`
	Label   string            `json:"label"`
	Matches []bracketMatchDTO `json:"matches"`
}

// sumChargesPaid — total rupiah kok yang sudah lunas, langsung dari
// match_kok_charges (sumber kebenaran). BEDA dari domain.TournamentCost.
// KokPaid (F1, tetap dipakai buat lain-lain di atas) yang cuma menghitung
// kok PER-PARTAI (domain.MatchKokPaid map, 4 slot) — kok UMUM tidak pernah
// tertaut ke satu BracketMatch mana pun jadi selalu absen dari situ. Ini
// bug tersembunyi kalau dibiarkan: baru ditemukan lewat
// TestTournament_KokUmum_ChargesAllParticipants (kok_paid tetap 0 padahal
// semua charge sudah ditandai lunas).
func sumChargesPaid(charges []gen.MatchKokCharge) int64 {
	var total int64
	for _, c := range charges {
		if c.PaidAt.Valid {
			total += c.Amount
		}
	}
	return total
}

func newTournamentDTO(load *tournamentLoad) tournamentDTO {
	t, e := load.Tournament, load.Enriched
	today := time.Now().UTC().Format(dateLayout)
	dto := tournamentDTO{
		ID:          t.ID,
		ClubID:      t.ClubID,
		Name:        t.Name,
		StartsOn:    dateString(t.StartsOn),
		Format:      string(t.Format),
		Size:        int(t.Size),
		Fee:         t.Fee,
		ScoreFormat: string(t.ScoreFormat),
		Notes:       textOrNil(t.Notes),
		Status:      string(domain.TournamentStatus(dateString(t.StartsOn), e.Finished, today)),
		CreatedAt:   tsOrZero(t.CreatedAt),
		UpdatedAt:   tsOrZero(t.UpdatedAt),
		Version:     t.Version,
		Pairs:       make([]tournamentPairDTO, 0, len(e.Pairs)),
		PlayedCount: e.PlayedCount,
		TotalCount:  e.TotalCount,
		Finished:    e.Finished,
		Champion:    sidePairDTO(e.Champion, load.PairsByID),
		Cost: tournamentCostDTO{
			KokCount: e.Cost.KokCount, KokTotal: e.Cost.KokTotal, KokPaid: sumChargesPaid(load.Charges),
			Participants: e.Cost.Participants, FeeTotal: e.Cost.FeeTotal, FeePaid: e.Cost.FeePaid,
			FeeUnpaid: e.Cost.FeeUnpaid, PaidCount: e.Cost.PaidCount, UnpaidCount: e.Cost.UnpaidCount,
		},
	}
	if t.EndsOn.Valid {
		dto.EndsOn = dateString(t.EndsOn)
	}
	for _, p := range e.Pairs {
		if pd := sidePairDTO(&p, load.PairsByID); pd != nil {
			dto.Pairs = append(dto.Pairs, *pd)
		} else {
			dto.Pairs = append(dto.Pairs, tournamentPairDTO{Slot: p.Slot})
		}
	}
	if e.Bracket != nil {
		rounds := make([]bracketRoundDTO, len(e.Bracket.Rounds))
		for i, r := range e.Bracket.Rounds {
			ms := make([]bracketMatchDTO, len(r.Matches))
			for j, m := range r.Matches {
				ms[j] = newMatchDTO(e.StoredTournament, m, load.PairsByID)
			}
			rounds[i] = bracketRoundDTO{Round: r.Round, Label: r.Label, Matches: ms}
		}
		dto.Rounds = rounds
	}
	if e.RoundRobin != nil {
		ms := make([]bracketMatchDTO, len(e.RoundRobin.Matches))
		for i, m := range e.RoundRobin.Matches {
			ms[i] = newMatchDTO(e.StoredTournament, m, load.PairsByID)
		}
		dto.Matches = ms
		standings := make([]standingRowDTO, len(e.RoundRobin.Standings))
		for i, row := range e.RoundRobin.Standings {
			pd := tournamentPairDTO{Slot: row.Pair.Slot}
			if p := sidePairDTO(&row.Pair, load.PairsByID); p != nil {
				pd = *p
			}
			standings[i] = standingRowDTO{
				Pair: pd, Played: row.Played, Won: row.Won, Lost: row.Lost,
				GamesFor: row.GamesFor, GamesAgainst: row.GamesAgainst,
				PointsFor: row.PointsFor, PointsAgainst: row.PointsAgainst, Diff: row.Diff,
			}
		}
		dto.Standings = standings
	}
	for _, k := range load.Koks {
		mid := ""
		if k.MatchID != nil {
			mid = load.MatchDomainID[*k.MatchID]
		}
		used := ""
		if k.UsedOn.Valid {
			used = dateString(k.UsedOn)
		}
		var kokTypeID *string
		if k.KokTypeID != nil {
			s := k.KokTypeID.String()
			kokTypeID = &s
		}
		dto.Koks = append(dto.Koks, tournamentKokDTO{
			ID: k.ID, MatchID: mid, KokTypeID: kokTypeID, TypeName: textOrNil(k.TypeName),
			PricePerPerson: k.PricePerPerson, Qty: k.Qty, UsedOn: used,
		})
	}
	for _, c := range load.Charges {
		mid := ""
		if c.MatchID != nil {
			mid = load.MatchDomainID[*c.MatchID]
		}
		charged := ""
		if c.ChargedOn.Valid {
			charged = dateString(c.ChargedOn)
		}
		item := tournamentKokChargeDTO{
			ID: c.ID, MatchID: mid, UserID: c.UserID, Name: load.Names[c.UserID],
			Amount: c.Amount, ChargedOn: charged,
		}
		if c.PaidAt.Valid {
			v := c.PaidAt.Time
			item.PaidAt = &v
		}
		if c.DisputedAt.Valid {
			v := c.DisputedAt.Time
			item.DisputedAt = &v
		}
		dto.KokCharges = append(dto.KokCharges, item)
	}
	for _, f := range load.Fees {
		item := tournamentFeeDTO{UserID: f.UserID, Name: load.Names[f.UserID], Amount: f.Amount}
		if f.PaidAt.Valid {
			v := f.PaidAt.Time
			item.PaidAt = &v
		}
		dto.Fees = append(dto.Fees, item)
	}
	return dto
}

func loadTournamentDTO(ctx context.Context, s *store.Store, clubID, id uuid.UUID) (tournamentDTO, error) {
	var dto tournamentDTO
	err := s.WithClub(ctx, clubID, func(ctx context.Context, q *gen.Queries) error {
		load, err := loadTournament(ctx, q, clubID, id)
		if err != nil {
			return err
		}
		dto = newTournamentDTO(load)
		return nil
	})
	return dto, err
}

func publishTournamentUpdated(ctx context.Context, q *gen.Queries, clubID uuid.UUID, dto tournamentDTO) error {
	return realtime.Publish(ctx, q, realtime.NewEvent(realtime.KindTournamentUpdated, clubID, dto))
}

// --- handlers ---

type createTournamentPairRequest struct {
	Slot int     `json:"slot"`
	A    *string `json:"a"`
	B    *string `json:"b"`
}

type createTournamentRequest struct {
	Name        string                        `json:"name"`
	StartsOn    string                        `json:"starts_on"`
	EndsOn      string                        `json:"ends_on"`
	Format      string                        `json:"format"`
	Size        int                           `json:"size"`
	Fee         int64                         `json:"fee"`
	ScoreFormat string                        `json:"score_format"`
	Notes       string                        `json:"notes"`
	Pairs       []createTournamentPairRequest `json:"pairs"`
}

// handleCreateTournament — POST /clubs/{clubId}/tournaments (API.md §5).
// pairs[] boleh menyebut user_id yang belum jadi anggota klub ini —
// otomatis dijadikan anggota `is_tournament_guest` (§8.1), bukan gagal.
func handleCreateTournament(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())
		clubID, _ := clubIDFromContext(r.Context())

		var req createTournamentRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		name := domain.NormalizeNameType80(req.Name)
		if name == "" {
			name = "Turnamen"
		}
		startsOn, err := parseDate(req.StartsOn)
		if err != nil {
			writeError(w, CodeValidationFailed, "Tanggal mulai belum diisi atau formatnya salah (YYYY-MM-DD).", nil)
			return
		}
		endsOn, hasEnd := pgTypeDateOrNil(req.EndsOn)
		if hasEnd && endsOn.Time.Before(startsOn.Time) {
			writeError(w, CodeValidationFailed, "Tanggal selesai tidak boleh sebelum tanggal mulai.", nil)
			return
		}
		if req.Format == "" {
			req.Format = "knockout"
		}
		if !validTournamentFormats[req.Format] {
			writeError(w, CodeValidationFailed, "format harus knockout atau round_robin.", nil)
			return
		}
		if req.ScoreFormat == "" {
			req.ScoreFormat = "single"
		}
		if !validTournamentScoreFormats[req.ScoreFormat] {
			writeError(w, CodeValidationFailed, "score_format harus single atau bo3.", nil)
			return
		}
		size := req.Size
		if size <= 0 {
			size = len(req.Pairs)
		}
		size = domain.NormalizeSize(size)
		fee := req.Fee
		if fee < 0 {
			fee = 0
		}

		type resolvedPair struct {
			slot int
			a, b *uuid.UUID
		}
		seenSlot := map[int]bool{}
		pairs := make([]resolvedPair, 0, len(req.Pairs))
		userSet := map[uuid.UUID]bool{}
		var userOrder []uuid.UUID
		for _, p := range req.Pairs {
			if p.Slot < 0 || p.Slot >= size {
				writeError(w, CodeValidationFailed, "slot pasangan di luar jangkauan ukuran turnamen.", nil)
				return
			}
			if seenSlot[p.Slot] {
				writeError(w, CodeValidationFailed, "dua pasangan tidak boleh menempati slot yang sama.", nil)
				return
			}
			seenSlot[p.Slot] = true
			rp := resolvedPair{slot: p.Slot}
			if p.A != nil && *p.A != "" {
				id, err := uuid.Parse(*p.A)
				if err != nil {
					writeError(w, CodeValidationFailed, "user_id pasangan (a) tidak valid.", nil)
					return
				}
				rp.a = &id
				if !userSet[id] {
					userSet[id] = true
					userOrder = append(userOrder, id)
				}
			}
			if p.B != nil && *p.B != "" {
				id, err := uuid.Parse(*p.B)
				if err != nil {
					writeError(w, CodeValidationFailed, "user_id pasangan (b) tidak valid.", nil)
					return
				}
				rp.b = &id
				if !userSet[id] {
					userSet[id] = true
					userOrder = append(userOrder, id)
				}
			}
			pairs = append(pairs, rp)
		}

		var tournamentID uuid.UUID
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			if len(userOrder) > 0 {
				users, err := q.ListUsersByIDs(ctx, userOrder)
				if err != nil {
					return err
				}
				if len(users) != len(userOrder) {
					return errValidation("Ada user_id di pairs yang tidak ditemukan.")
				}
			}

			created, err := q.CreateTournament(ctx, gen.CreateTournamentParams{
				ClubID: clubID, Name: name, StartsOn: startsOn, EndsOn: endsOn,
				Format: gen.TournamentFormat(req.Format), Size: int32(size), Fee: fee,
				ScoreFormat: gen.ScoreFormat(req.ScoreFormat), Notes: textOf(req.Notes), RecordedBy: &userID,
			})
			if err != nil {
				return err
			}
			tournamentID = created.ID

			for _, p := range pairs {
				if p.a == nil && p.b == nil {
					continue
				}
				if _, err := q.CreateTournamentPair(ctx, gen.CreateTournamentPairParams{
					TournamentID: created.ID, ClubID: clubID, Slot: int32(p.slot), PlayerA: p.a, PlayerB: p.b,
				}); err != nil {
					return err
				}
			}

			// Peserta dari luar klub jadi anggota is_tournament_guest
			// (§8.1) — supaya kena tagihan iuran/kok & muncul di daftar
			// anggota bertanda "Tamu turnamen", bukan pengguna hantu.
			for _, uid := range userOrder {
				_, err := q.GetMembership(ctx, gen.GetMembershipParams{ClubID: clubID, UserID: uid})
				if err == nil {
					continue
				}
				if !errors.Is(err, pgx.ErrNoRows) {
					return err
				}
				if _, err := q.CreateTournamentGuestMembership(ctx, gen.CreateTournamentGuestMembershipParams{
					ClubID: clubID, UserID: uid,
				}); err != nil {
					return err
				}
			}

			// Iuran (§9 "iuran") — satu baris tetap per peserta, dibuat
			// SEKALI di sini. Tournament belum punya alur "tambah peserta
			// belakangan" di F7/1, jadi tidak butuh sinkronisasi ulang.
			for _, uid := range userOrder {
				if _, err := q.CreateTournamentFee(ctx, gen.CreateTournamentFeeParams{
					TournamentID: created.ID, ClubID: clubID, UserID: uid, Amount: fee,
				}); err != nil {
					return err
				}
			}

			load, err := loadTournament(ctx, q, clubID, created.ID)
			if err != nil {
				return err
			}
			return publishTournamentUpdated(ctx, q, clubID, newTournamentDTO(load))
		})
		if err != nil {
			var ve *validationErr
			if errors.As(err, &ve) {
				writeError(w, CodeValidationFailed, ve.msg, nil)
				return
			}
			writeError(w, CodeValidationFailed, "Gagal membuat turnamen.", nil)
			return
		}

		dto, err := loadTournamentDTO(r.Context(), s, clubID, tournamentID)
		if err != nil {
			writeError(w, CodeValidationFailed, "Turnamen dibuat tapi gagal dimuat ulang.", nil)
			return
		}
		writeJSON(w, http.StatusCreated, dto)
	}
}

func pgTypeDateOrNil(s string) (pgtype.Date, bool) {
	if s == "" {
		return pgtype.Date{}, false
	}
	d, err := parseDate(s)
	if err != nil {
		return pgtype.Date{}, false
	}
	return d, true
}

const defaultTournamentsLimit = 20

// handleListTournaments — GET /clubs/{clubId}/tournaments.
func handleListTournaments(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		limit := defaultTournamentsLimit
		var before pgtype.Date
		if v := r.URL.Query().Get("before"); v != "" {
			d, err := parseDate(v)
			if err != nil {
				writeError(w, CodeValidationFailed, "Parameter before harus YYYY-MM-DD.", nil)
				return
			}
			before = d
		}

		var rows []gen.Tournament
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			rows, err = q.ListTournamentsByClub(ctx, gen.ListTournamentsByClubParams{ClubID: clubID, Limit: int32(limit), Before: before})
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil daftar turnamen.", nil)
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
		resp := map[string]any{"items": items}
		if len(rows) == limit {
			resp["next_cursor"] = dateString(rows[len(rows)-1].StartsOn)
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

// handleGetTournament — GET /clubs/{clubId}/tournaments/{id}.
func handleGetTournament(s *store.Store) http.HandlerFunc {
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
			writeError(w, CodeValidationFailed, "Gagal mengambil data turnamen.", nil)
			return
		}
		writeJSON(w, http.StatusOK, dto)
	}
}

type patchTournamentRequest struct {
	Fee   *int64  `json:"fee"`
	Notes *string `json:"notes"`
}

// handlePatchTournament — PATCH /clubs/{clubId}/tournaments/{id} (API.md
// §5: cuma fee & catatan). If-Match wajib (invarian §3.4).
func handlePatchTournament(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Turnamen tidak ditemukan.", nil)
			return
		}
		version, ok := requireIfMatch(r)
		if !ok {
			writeError(w, CodeValidationFailed, "Header If-Match: <version> wajib diisi.", nil)
			return
		}
		var req patchTournamentRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}

		conflict := false
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			current, err := q.GetTournament(ctx, gen.GetTournamentParams{ID: id, ClubID: clubID})
			if err != nil {
				return err
			}
			fee := current.Fee
			if req.Fee != nil {
				fee = *req.Fee
				if fee < 0 {
					fee = 0
				}
			}
			notes := current.Notes
			if req.Notes != nil {
				notes = textOf(*req.Notes)
			}
			_, err = q.UpdateTournament(ctx, gen.UpdateTournamentParams{ID: id, ClubID: clubID, Fee: fee, Notes: notes, Version: version})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					conflict = true
					return nil
				}
				return err
			}
			load, err := loadTournament(ctx, q, clubID, id)
			if err != nil {
				return err
			}
			return publishTournamentUpdated(ctx, q, clubID, newTournamentDTO(load))
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				writeError(w, CodeNotFound, "Turnamen tidak ditemukan.", nil)
				return
			}
			writeError(w, CodeValidationFailed, "Gagal mengubah turnamen.", nil)
			return
		}
		dto, err := loadTournamentDTO(r.Context(), s, clubID, id)
		if err != nil {
			writeError(w, CodeNotFound, "Turnamen tidak ditemukan.", nil)
			return
		}
		if conflict {
			writeError(w, CodeVersionConflict, "Turnamen ini sudah diubah orang lain. Cek versi terbaru dulu.", dto)
			return
		}
		writeJSON(w, http.StatusOK, dto)
	}
}

type scoreMatchRequest struct {
	Format   string                 `json:"format"`
	Games    []createGameSetRequest `json:"games"`
	PlayedAt string                 `json:"played_at"`
}

// handleScoreMatch — POST .../tournaments/{id}/matches/{matchId}/score
// (API.md §5). matchId adalah id LOGIS bagan ("r0-0"/"rr1-2", dari respons
// GET detail), bukan uuid — baris `matches` fisik baru dibuat di sini kalau
// belum ada (EnsureMatch, lazy — lihat komentar berkas).
func handleScoreMatch(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Turnamen tidak ditemukan.", nil)
			return
		}
		matchID := chi.URLParam(r, "matchId")

		var req scoreMatchRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		if !validTournamentScoreFormats[req.Format] {
			writeError(w, CodeValidationFailed, "format skor harus single atau bo3.", nil)
			return
		}
		sets := make([]domain.GameSetScore, 0, len(req.Games))
		for _, g := range req.Games {
			sets = append(sets, domain.GameSetScore{A: int(g.A), B: int(g.B)})
		}

		var notFound, invalidMatch bool
		var dto tournamentDTO
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			current, err := q.GetTournament(ctx, gen.GetTournamentParams{ID: id, ClubID: clubID})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					notFound = true
					return nil
				}
				return err
			}
			if !domain.MatchIDSet(domain.TournamentFormat(current.Format), int(current.Size))[matchID] {
				invalidMatch = true
				return nil
			}
			round, idx, err := matchDBCoords(current.Format, matchID)
			if err != nil {
				invalidMatch = true
				return nil
			}
			match, err := q.EnsureMatch(ctx, gen.EnsureMatchParams{TournamentID: id, ClubID: clubID, Round: round, Idx: idx})
			if err != nil {
				return err
			}
			if err := q.DeleteMatchGames(ctx, match.ID); err != nil {
				return err
			}
			for i, g := range req.Games {
				if _, err := q.CreateMatchGame(ctx, gen.CreateMatchGameParams{
					MatchID: match.ID, GameNo: int16(i + 1), ScoreA: g.A, ScoreB: g.B,
				}); err != nil {
					return err
				}
			}

			load, err := loadTournament(ctx, q, clubID, id)
			if err != nil {
				return err
			}
			playedAt := domain.ClampToTournament(req.PlayedAt, load.Stored.Date, load.Stored.EndDate)
			playedOn, _ := parseDate(playedAt)

			var winner gen.NullGameSide
			var autoWin bool
			var scoreFormat gen.NullScoreFormat
			for _, m := range load.Enriched.Matches {
				if m.ID == matchID {
					if m.Winner != domain.SideNil {
						winner = gen.NullGameSide{GameSide: gen.GameSide(m.Winner), Valid: true}
					}
					autoWin = m.AutoWin
					if m.Score != nil {
						scoreFormat = gen.NullScoreFormat{ScoreFormat: gen.ScoreFormat(m.Score.Format), Valid: true}
					}
					break
				}
			}
			if _, err := q.UpdateMatchResult(ctx, gen.UpdateMatchResultParams{
				ID: match.ID, ClubID: clubID, WinnerSide: winner, AutoWin: autoWin,
				ScoreFormat: scoreFormat, PlayedOn: playedOn,
			}); err != nil {
				return err
			}

			dto = newTournamentDTO(load)
			return publishTournamentUpdated(ctx, q, clubID, dto)
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal menyimpan skor.", nil)
			return
		}
		if notFound {
			writeError(w, CodeNotFound, "Turnamen tidak ditemukan.", nil)
			return
		}
		if invalidMatch {
			writeError(w, CodeNotFound, "Partai tidak ditemukan di turnamen ini.", nil)
			return
		}
		writeJSON(w, http.StatusOK, dto)
	}
}

type addKokRequest struct {
	KokTypeID      *string `json:"kok_type_id"`
	TypeName       *string `json:"type_name"`
	PricePerPerson *int64  `json:"price_per_person"`
	Qty            int32   `json:"qty"`
	UsedOn         string  `json:"used_on"`
}

// handleAddMatchKok — POST .../matches/{matchId}/koks (API.md §5, kok
// partai). Dibagi 4 (ukuran ganda tetap, domain.MatchKokPerPerson) ke
// pemain partai itu — partai BYE ditolak, tidak ada 4 orang buat dibagi.
func handleAddMatchKok(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())
		clubID, _ := clubIDFromContext(r.Context())
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Turnamen tidak ditemukan.", nil)
			return
		}
		matchID := chi.URLParam(r, "matchId")
		dto, code, msg := addTournamentKok(r.Context(), s, clubID, id, userID, &matchID, r.Body)
		if msg != "" {
			writeError(w, code, msg, nil)
			return
		}
		writeJSON(w, http.StatusOK, dto)
	}
}

// handleAddTournamentKok — POST .../tournaments/{id}/koks (API.md §5, kok
// umum). Dibagi rata ke SEMUA peserta turnamen saat ini — inilah yang
// menutup lubang "kok lepas" v2 (§9 F7): tidak ada kok tanpa penanggung.
func handleAddTournamentKok(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())
		clubID, _ := clubIDFromContext(r.Context())
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Turnamen tidak ditemukan.", nil)
			return
		}
		dto, code, msg := addTournamentKok(r.Context(), s, clubID, id, userID, nil, r.Body)
		if msg != "" {
			writeError(w, code, msg, nil)
			return
		}
		writeJSON(w, http.StatusOK, dto)
	}
}

func addTournamentKok(ctx context.Context, s *store.Store, clubID, tournamentID, userID uuid.UUID, matchDomainIDArg *string, body io.Reader) (tournamentDTO, ErrorCode, string) {
	var req addKokRequest
	if err := json.NewDecoder(body).Decode(&req); err != nil {
		return tournamentDTO{}, CodeValidationFailed, "Body permintaan tidak valid."
	}
	if req.Qty <= 0 {
		req.Qty = 1
	}

	var dto tournamentDTO
	var problemCode ErrorCode
	var problemMsg string
	err := s.WithClub(ctx, clubID, func(ctx context.Context, q *gen.Queries) error {
		current, err := q.GetTournament(ctx, gen.GetTournamentParams{ID: tournamentID, ClubID: clubID})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				problemCode, problemMsg = CodeNotFound, "Turnamen tidak ditemukan."
				return nil
			}
			return err
		}

		var kokTypeID *uuid.UUID
		typeName := ""
		pricePerPerson := int64(0)
		if req.KokTypeID != nil && *req.KokTypeID != "" {
			ktID, err := uuid.Parse(*req.KokTypeID)
			if err != nil {
				problemCode, problemMsg = CodeValidationFailed, "kok_type_id tidak valid."
				return nil
			}
			kt, err := q.GetKokType(ctx, gen.GetKokTypeParams{ID: ktID, ClubID: clubID})
			if err != nil {
				problemCode, problemMsg = CodeValidationFailed, "Jenis kok tidak ditemukan di klub ini."
				return nil
			}
			kokTypeID = &ktID
			typeName = kt.Name
			pricePerPerson = kt.PricePerPerson
		} else {
			if req.TypeName == nil || req.PricePerPerson == nil {
				problemCode, problemMsg = CodeValidationFailed, "Kok tanpa kok_type_id wajib mengisi type_name dan price_per_person."
				return nil
			}
			typeName = *req.TypeName
			pricePerPerson = *req.PricePerPerson
		}
		total := pricePerPerson * int64(req.Qty)

		load, err := loadTournament(ctx, q, clubID, tournamentID)
		if err != nil {
			return err
		}
		usedOn := domain.ClampToTournament(req.UsedOn, load.Stored.Date, load.Stored.EndDate)
		usedOnDate, _ := parseDate(usedOn)

		var matchDBID *uuid.UUID
		var recipients []uuid.UUID
		var perPerson int64
		if matchDomainIDArg != nil {
			mid := *matchDomainIDArg
			if !domain.MatchIDSet(domain.TournamentFormat(current.Format), int(current.Size))[mid] {
				problemCode, problemMsg = CodeNotFound, "Partai tidak ditemukan di turnamen ini."
				return nil
			}
			var found *domain.BracketMatch
			for i := range load.Enriched.Matches {
				if load.Enriched.Matches[i].ID == mid {
					found = &load.Enriched.Matches[i]
					break
				}
			}
			if found == nil || found.A.Bye || found.B.Bye {
				problemCode, problemMsg = CodeValidationFailed, "Partai ini belum ada lawannya (BYE) — belum bisa ditambah kok."
				return nil
			}
			round, idx, err := matchDBCoords(current.Format, mid)
			if err != nil {
				problemCode, problemMsg = CodeNotFound, "Partai tidak ditemukan."
				return nil
			}
			m, err := q.EnsureMatch(ctx, gen.EnsureMatchParams{TournamentID: tournamentID, ClubID: clubID, Round: round, Idx: idx})
			if err != nil {
				return err
			}
			matchDBID = &m.ID
			for _, uid := range matchParticipantUserIDs(*found, load.PairsByID) {
				if uid != nil {
					recipients = append(recipients, *uid)
				}
			}
			perPerson = domain.MatchKokPerPerson(*found)
		} else {
			seen := map[uuid.UUID]bool{}
			for _, p := range load.PairsByID {
				if p.AUserID != nil && !seen[*p.AUserID] {
					seen[*p.AUserID] = true
					recipients = append(recipients, *p.AUserID)
				}
				if p.BUserID != nil && !seen[*p.BUserID] {
					seen[*p.BUserID] = true
					recipients = append(recipients, *p.BUserID)
				}
			}
			if len(recipients) == 0 {
				problemCode, problemMsg = CodeValidationFailed, "Turnamen ini belum ada pesertanya."
				return nil
			}
			perPerson = domain.PerPersonCost(total, len(recipients))
		}

		if _, err := q.CreateMatchKok(ctx, gen.CreateMatchKokParams{
			ClubID: clubID, TournamentID: tournamentID, MatchID: matchDBID, KokTypeID: kokTypeID,
			TypeName: textOf(typeName), PricePerPerson: pricePerPerson, Qty: req.Qty, UsedOn: usedOnDate,
		}); err != nil {
			return err
		}
		for _, uid := range recipients {
			if _, err := q.CreateMatchKokCharge(ctx, gen.CreateMatchKokChargeParams{
				ClubID: clubID, TournamentID: tournamentID, MatchID: matchDBID, UserID: uid,
				Amount: perPerson, ChargedOn: usedOnDate,
			}); err != nil {
				return err
			}
		}
		// Kelebihan pembulatan masuk kas (§9.5 aturan A), sama pola POST
		// games — dicatat eksplisit, bukan menyatu diam-diam.
		n := len(recipients)
		if matchDomainIDArg != nil {
			n = 4
		}
		if rounding := domain.Rounding(perPerson, n, total); rounding > 0 {
			if _, err := q.CreateExpense(ctx, gen.CreateExpenseParams{
				ClubID: clubID, Amount: -rounding, Note: textOf("pembulatan kok turnamen"), RecordedBy: &userID,
			}); err != nil {
				return err
			}
		}

		fresh, err := loadTournament(ctx, q, clubID, tournamentID)
		if err != nil {
			return err
		}
		dto = newTournamentDTO(fresh)
		return publishTournamentUpdated(ctx, q, clubID, dto)
	})
	if err != nil {
		return tournamentDTO{}, CodeValidationFailed, "Gagal menambah kok."
	}
	if problemMsg != "" {
		return tournamentDTO{}, problemCode, problemMsg
	}
	return dto, "", ""
}

// handleListTournamentFees — GET .../tournaments/{id}/fees (API.md §5).
func handleListTournamentFees(s *store.Store) http.HandlerFunc {
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
			writeError(w, CodeValidationFailed, "Gagal mengambil status iuran.", nil)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": dto.Fees})
	}
}

// handleMarkTournamentFeePaid — POST .../fees/{userId}/mark-paid (API.md §5).
func handleMarkTournamentFeePaid(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())
		clubID, _ := clubIDFromContext(r.Context())
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Turnamen tidak ditemukan.", nil)
			return
		}
		targetUserID, err := uuid.Parse(chi.URLParam(r, "userId"))
		if err != nil {
			writeError(w, CodeNotFound, "Peserta tidak ditemukan.", nil)
			return
		}

		notFound := false
		var dto tournamentDTO
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			_, err := q.MarkTournamentFeePaid(ctx, gen.MarkTournamentFeePaidParams{
				TournamentID: id, ClubID: clubID, UserID: targetUserID, PaidBy: &userID,
			})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					notFound = true
					return nil
				}
				return err
			}
			load, err := loadTournament(ctx, q, clubID, id)
			if err != nil {
				return err
			}
			dto = newTournamentDTO(load)
			return publishTournamentUpdated(ctx, q, clubID, dto)
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal menandai iuran lunas.", nil)
			return
		}
		if notFound {
			writeError(w, CodeNotFound, "Iuran peserta ini tidak ditemukan atau sudah lunas.", nil)
			return
		}
		writeJSON(w, http.StatusOK, dto)
	}
}

type markKokChargesPaidRequest struct {
	IDs []string `json:"ids"`
}

// handleMarkKokChargesPaid — POST .../tournaments/{id}/kok-charges/mark-paid.
// TIDAK didaftar eksplisit di API.md §5 versi awal (cuma menyebut alur
// fees) — ditambah di sini + API.md commit yang sama, sesuai aturan §0
// "kalau bentuknya ternyata tidak cocok saat implementasi, perbarui
// API.md". Tanpa endpoint ini, tagihan kok per-partai/umum (match_kok_
// charges) tidak pernah bisa ditandai lunas dari mana pun.
func handleMarkKokChargesPaid(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())
		clubID, _ := clubIDFromContext(r.Context())
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Turnamen tidak ditemukan.", nil)
			return
		}
		var req markKokChargesPaidRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		if len(req.IDs) == 0 {
			writeError(w, CodeValidationFailed, "ids kosong.", nil)
			return
		}
		parsed := make([]*uuid.UUID, len(req.IDs))
		ids := make([]uuid.UUID, 0, len(req.IDs))
		for i, raw := range req.IDs {
			pid, err := uuid.Parse(raw)
			if err != nil {
				continue
			}
			parsed[i] = &pid
			ids = append(ids, pid)
		}

		var okIDs map[uuid.UUID]bool
		var dto tournamentDTO
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			if len(ids) > 0 {
				marked, err := q.MarkMatchKokChargesPaid(ctx, gen.MarkMatchKokChargesPaidParams{ClubID: clubID, PaidBy: &userID, Ids: ids})
				if err != nil {
					return err
				}
				okIDs = make(map[uuid.UUID]bool, len(marked))
				for _, mid := range marked {
					okIDs[mid] = true
				}
			}
			load, err := loadTournament(ctx, q, clubID, id)
			if err != nil {
				return err
			}
			dto = newTournamentDTO(load)
			return publishTournamentUpdated(ctx, q, clubID, dto)
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				writeError(w, CodeNotFound, "Turnamen tidak ditemukan.", nil)
				return
			}
			writeError(w, CodeValidationFailed, "Gagal menandai kok lunas.", nil)
			return
		}

		results := make([]markPaidResultItem, len(req.IDs))
		for i, raw := range req.IDs {
			if parsed[i] == nil {
				results[i] = markPaidResultItem{ID: raw, OK: false, Error: "id tidak valid"}
				continue
			}
			if okIDs[*parsed[i]] {
				results[i] = markPaidResultItem{ID: raw, OK: true}
			} else {
				results[i] = markPaidResultItem{ID: raw, OK: false, Error: "sudah lunas, disanggah, atau tidak ditemukan"}
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"results": results, "tournament": dto})
	}
}
