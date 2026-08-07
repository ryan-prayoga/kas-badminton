// Port dari v2/lib/domain/tournament.ts — bagan knockout & klasemen round
// robin. Fungsi murni; bentuknya sengaja mirip game.go biar konsisten: harga
// kok di-snapshot di dalam turnamen, status patungan per peserta.
//
// Pasangan turnamen tetap 2 orang (a+b) seperti v2 — beda dari main harian
// (game.go) yang jumlah pemainnya bebas (PLAN.md §8). Kok per-partai dibagi
// 4 (ukuran ganda tetap), pakai rumus pembulatan yang sama (§9.5 A).
package domain

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

const (
	MinPairs = 2
	MaxPairs = 32
)

type TournamentFormat string

const (
	FormatKnockout   TournamentFormat = "knockout"
	FormatRoundRobin TournamentFormat = "round_robin"
)

type ScoreFormat string

const (
	ScoreSingle ScoreFormat = "single"
	ScoreBo3    ScoreFormat = "bo3"
)

type Side string

const (
	SideA   Side = "a"
	SideB   Side = "b"
	SideNil Side = ""
)

type TournamentPair struct {
	ID   string
	Slot int
	A, B string
}

type TournamentFee struct {
	Name   string
	Paid   bool
	PaidAt string
	PaidBy string
}

type GameScore struct{ A, B int }

type MatchScore struct {
	Format ScoreFormat
	Games  []GameScore
	// Tanggal partai dimainkan (YYYY-MM-DD); kosong = jatuh ke tanggal mulai
	// turnamen (lihat MatchPlayedDate).
	PlayedAt string
}

// TournamentKok — sama seperti Kok, plus MatchID (kok umum kalau kosong) dan
// tanggal pemakaian.
type TournamentKok struct {
	Kok
	MatchID string
	Date    string
}

type BracketSide struct {
	Pair *TournamentPair
	Bye  bool
	From string
}

type GamesWonCount struct{ A, B int }

type BracketMatch struct {
	ID       string
	Round    int
	Index    int
	A, B     BracketSide
	Score    *MatchScore
	GamesWon GamesWonCount
	Winner   Side
	AutoWin  bool
	Koks     []TournamentKok
	KokTotal int64
	// [sisiA.a, sisiA.b, sisiB.a, sisiB.b]
	KokPaid [4]bool
}

type BracketRound struct {
	Round   int
	Label   string
	Matches []BracketMatch
}

type Bracket struct {
	Rounds   []BracketRound
	Champion *TournamentPair
}

type StandingRow struct {
	Pair                     TournamentPair
	Played, Won, Lost        int
	GamesFor, GamesAgainst   int
	PointsFor, PointsAgainst int
	Diff                     int
}

type RoundRobin struct {
	Matches                 []BracketMatch
	Standings               []StandingRow
	Champion                *TournamentPair
	PlayedCount, TotalCount int
}

type StoredTournament struct {
	ID          string
	Name        string
	Date        string
	EndDate     string // kosong = turnamen sehari
	Format      TournamentFormat
	Size        int
	Fee         int64
	ScoreFormat ScoreFormat
	Pairs       []TournamentPair
	Results     map[string]MatchScore
	Koks        []TournamentKok
	Fees        []TournamentFee
	// matchId -> [4]bool, urutan [sisiA.a, sisiA.b, sisiB.a, sisiB.b].
	MatchKokPaid map[string][4]bool
	Notes        string
	RecordedBy   string
	CreatedAt    string
	UpdatedAt    string
}

type TournamentCost struct {
	KokCount     int
	KokTotal     int64
	LooseKoks    []TournamentKok
	Participants int
	FeeTotal     int64
	FeePaid      int64
	FeeUnpaid    int64
	PaidCount    int
	UnpaidCount  int
	// Rupiah kok per-partai yang statusnya udah lunas — beda tagihan dari fee.
	KokPaid int64
}

type EnrichedTournament struct {
	StoredTournament
	Bracket                 *Bracket    // terisi kalau format knockout
	RoundRobin              *RoundRobin // terisi kalau format round_robin
	Matches                 []BracketMatch
	Champion                *TournamentPair
	PlayedCount, TotalCount int
	Finished                bool
	Cost                    TournamentCost
}

// --- Normalisasi ukuran & format ---

func NormalizeFormat(v TournamentFormat) TournamentFormat {
	if v == FormatRoundRobin {
		return FormatRoundRobin
	}
	return FormatKnockout
}

// NormalizeSize menjepit jumlah pasangan ke 2..32. Beda dari v2: di sana
// input tak-terhingga (JSON hilang/ngawur) jatuh ke bawaan 8 — di Go, "tidak
// diisi" sudah ditangani lapisan HTTP (F2, lewat *int atau bawaan request),
// jadi fungsi murni ini cukup menjepit angka yang sudah ada, termasuk 0.
func NormalizeSize(n int) int {
	if n < MinPairs {
		return MinPairs
	}
	if n > MaxPairs {
		return MaxPairs
	}
	return n
}

// BracketSize — pangkat 2 terdekat ke atas dari jumlah pasangan. 14 → 16,
// dua slot sisanya jadi BYE.
func BracketSize(size int) int {
	if size < MinPairs {
		size = MinPairs
	}
	return 1 << int(math.Ceil(math.Log2(float64(size))))
}

// RoundRobinMatchCount — tiap pasangan ketemu semua pasangan lain sekali.
func RoundRobinMatchCount(size int) int {
	return size * (size - 1) / 2
}

func NormalizeScoreFormat(v ScoreFormat) ScoreFormat {
	if v == ScoreBo3 {
		return ScoreBo3
	}
	return ScoreSingle
}

// MaxGames — jumlah game maksimal per format skor.
func MaxGames(format ScoreFormat) int {
	if format == ScoreBo3 {
		return 3
	}
	return 1
}

func gamesToWin(format ScoreFormat) int {
	if format == ScoreBo3 {
		return 2
	}
	return 1
}

// --- Normalisasi turnamen tersimpan ---

// TournamentDraft adalah input mentah (belum divalidasi/dijepit) buat
// NormalizeStoredTournament — analog "unknown shape" di v2, tapi tetap
// bertipe: kelonggaran JSON-parsing sudah ditangani lapisan HTTP (F2).
type TournamentDraft struct {
	ID, Name, Date, EndDate string
	Format                  TournamentFormat
	Size                    int
	Fee                     int64
	ScoreFormat             ScoreFormat
	Pairs                   []TournamentPair
	Results                 map[string]MatchScore
	Koks                    []TournamentKok
	Fees                    []TournamentFee
	MatchKokPaid            map[string][4]bool
	Notes, RecordedBy       string
	CreatedAt, UpdatedAt    string
}

// NormalizeStoredTournament menjepit input ke bentuk kanonik: selalu `size`
// slot pasangan, id partai di luar bagan dibuang, tanggal kok dijepit ke
// rentang turnamen, iuran disamakan dengan peserta yang benar-benar ada.
func NormalizeStoredTournament(d TournamentDraft, genID func() string) StoredTournament {
	size := NormalizeSize(d.Size)
	format := NormalizeFormat(d.Format)
	pairs := normalizePairs(d.Pairs, size, genID)

	date := d.Date
	endDate := ""
	if d.EndDate != "" && d.EndDate > date {
		endDate = d.EndDate
	}

	validIDs := MatchIDSet(format, size)

	name := NormalizeNameType80(d.Name)
	if name == "" {
		name = "Turnamen"
	}

	fee := d.Fee
	if fee < 0 {
		fee = 0
	}

	return StoredTournament{
		ID:           d.ID,
		Name:         name,
		Date:         date,
		EndDate:      endDate,
		Format:       format,
		Size:         size,
		Fee:          fee,
		ScoreFormat:  NormalizeScoreFormat(d.ScoreFormat),
		Pairs:        pairs,
		Results:      normalizeResults(d.Results, validIDs),
		Koks:         normalizeKoks(d.Koks, validIDs, date, endDate),
		Fees:         SyncFees(pairs, d.Fees),
		MatchKokPaid: normalizeMatchKokPaid(d.MatchKokPaid, validIDs),
		Notes:        d.Notes,
		RecordedBy:   d.RecordedBy,
		CreatedAt:    d.CreatedAt,
		UpdatedAt:    d.UpdatedAt,
	}
}

func NormalizeNameType80(name string) string {
	n := NormalizeName(name)
	if len(n) > 80 {
		return n[:80]
	}
	return n
}

// normalizePairs menempatkan pasangan ke slotnya (0..size-1); slot di luar
// jangkauan atau dobel diabaikan (yang pertama menang). Slot yang tidak
// terisi jadi pasangan kosong.
func normalizePairs(raw []TournamentPair, size int, genID func() string) []TournamentPair {
	bySlot := map[int]TournamentPair{}
	for i, p := range raw {
		slot := p.Slot
		if slot < 0 {
			slot = i
		}
		if slot < 0 || slot >= size {
			continue
		}
		if _, exists := bySlot[slot]; exists {
			continue
		}
		id := p.ID
		if id == "" {
			id = nextID(genID, slot)
		}
		bySlot[slot] = TournamentPair{ID: id, Slot: slot, A: NormalizeNameType(p.A), B: NormalizeNameType(p.B)}
	}
	out := make([]TournamentPair, size)
	for slot := 0; slot < size; slot++ {
		if p, ok := bySlot[slot]; ok {
			out[slot] = p
			continue
		}
		out[slot] = TournamentPair{ID: nextID(genID, slot), Slot: slot}
	}
	return out
}

func nextID(genID func() string, slot int) string {
	if genID != nil {
		return genID()
	}
	return fmt.Sprintf("slot-%d", slot)
}

func normalizeResults(raw map[string]MatchScore, validIDs map[string]bool) map[string]MatchScore {
	out := map[string]MatchScore{}
	for id, v := range raw {
		if !validIDs[id] {
			continue
		}
		if score := NormalizeMatchScore(v); score != nil {
			out[id] = *score
		}
	}
	return out
}

// normalizeKoks: matchId yang tidak dikenal dianggap kok umum, biar kok
// tidak hilang dari total.
func normalizeKoks(raw []TournamentKok, validIDs map[string]bool, date, endDate string) []TournamentKok {
	out := make([]TournamentKok, len(raw))
	for i, k := range raw {
		matchID := k.MatchID
		if !validIDs[matchID] {
			matchID = ""
		}
		out[i] = k
		out[i].MatchID = matchID
		out[i].Date = ClampToTournament(k.Date, date, endDate)
	}
	return out
}

// normalizeMatchKokPaid: matchId yang tidak dikenal dibuang — partai itu
// sudah tidak ada lagi di bagan.
func normalizeMatchKokPaid(raw map[string][4]bool, validIDs map[string]bool) map[string][4]bool {
	out := map[string][4]bool{}
	for id, v := range raw {
		if validIDs[id] {
			out[id] = v
		}
	}
	return out
}

// --- Nama pasangan & peserta ---

// PairLabel — "Fahri / Alan", "Fahri" kalau cuma satu, "" kalau kosong.
func PairLabel(pair *TournamentPair) string {
	if pair == nil {
		return ""
	}
	var names []string
	for _, n := range []string{pair.A, pair.B} {
		if v := NormalizeName(n); v != "" {
			names = append(names, v)
		}
	}
	return strings.Join(names, " / ")
}

func IsPairEmpty(pair *TournamentPair) bool {
	return PairLabel(pair) == ""
}

// ParticipantNames — nama peserta unik, urut slot, case-insensitive.
func ParticipantNames(pairs []TournamentPair) []string {
	seen := map[string]bool{}
	var out []string
	for _, p := range pairs {
		for _, raw := range []string{p.A, p.B} {
			name := NormalizeName(raw)
			key := strings.ToLower(name)
			if name == "" || seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, name)
		}
	}
	return out
}

// SyncFees menyamakan daftar iuran dengan pemain yang benar-benar ada di
// bagan: nama baru masuk belum bayar, nama yang hilang dari bagan ikut
// hilang, status lunas nama yang tetap ada dipertahankan.
func SyncFees(pairs []TournamentPair, existing []TournamentFee) []TournamentFee {
	prev := map[string]TournamentFee{}
	for _, f := range existing {
		prev[strings.ToLower(f.Name)] = f
	}
	names := ParticipantNames(pairs)
	out := make([]TournamentFee, len(names))
	for i, name := range names {
		old, ok := prev[strings.ToLower(name)]
		if !ok {
			out[i] = TournamentFee{Name: name}
			continue
		}
		fee := TournamentFee{Name: name, Paid: old.Paid}
		if fee.Paid {
			fee.PaidAt = old.PaidAt
			fee.PaidBy = old.PaidBy
		}
		out[i] = fee
	}
	return out
}

// --- Id partai ---

func MatchID(round, index int) string { return fmt.Sprintf("r%d-%d", round, index) }

func RRMatchID(i, j int) string {
	if i > j {
		i, j = j, i
	}
	return fmt.Sprintf("rr%d-%d", i, j)
}

// MatchIDSet — semua id partai yang sah untuk satu turnamen, dipakai buat
// memvalidasi skor & kok (id di luar sini dianggap kok umum / dibuang).
func MatchIDSet(format TournamentFormat, size int) map[string]bool {
	ids := map[string]bool{}
	if NormalizeFormat(format) == FormatRoundRobin {
		for i := 0; i < size; i++ {
			for j := i + 1; j < size; j++ {
				ids[RRMatchID(i, j)] = true
			}
		}
		return ids
	}
	slots := BracketSize(size)
	rounds := RoundCount(slots)
	for round := 0; round < rounds; round++ {
		count := slots / (1 << (round + 1))
		for index := 0; index < count; index++ {
			ids[MatchID(round, index)] = true
		}
	}
	return ids
}

// --- Tanggal ---

// TournamentDays — daftar tanggal turnamen dari mulai sampai selesai.
// Dijepit 60 hari — lebih dari itu hampir pasti salah input.
func TournamentDays(date, endDate string) []string {
	if date == "" {
		return nil
	}
	if endDate == "" || endDate <= date {
		return []string{date}
	}
	var days []string
	cur := mustParseDate(date)
	end := mustParseDate(endDate)
	for !cur.After(end) && len(days) < 60 {
		days = append(days, formatDate(cur))
		cur = cur.AddDate(0, 0, 1)
	}
	return days
}

// ClampToTournament menjepit tanggal ke dalam rentang turnamen; input tidak
// valid atau di luar rentang jatuh ke tanggal mulai/selesai.
func ClampToTournament(value, date, endDate string) string {
	if !isoDateRe.MatchString(value) {
		return date
	}
	last := date
	if endDate != "" && endDate > date {
		last = endDate
	}
	if value < date {
		return date
	}
	if value > last {
		return last
	}
	return value
}

// --- Skor ---

func normalizeGameScore(a, b int) (GameScore, bool) {
	if a < 0 {
		a = 0
	}
	if a > 99 {
		a = 99
	}
	if b < 0 {
		b = 0
	}
	if b > 99 {
		b = 99
	}
	if a == 0 && b == 0 {
		return GameScore{}, false // 0-0 = belum dimainkan
	}
	return GameScore{A: a, B: b}, true
}

// NormalizeMatchScore memotong game melebihi format dan membuang game 0-0.
// Balik nil kalau tidak ada game valid tersisa.
func NormalizeMatchScore(raw MatchScore) *MatchScore {
	format := NormalizeScoreFormat(raw.Format)
	max := MaxGames(format)
	var games []GameScore
	for _, g := range raw.Games {
		if len(games) >= max {
			break
		}
		if ng, ok := normalizeGameScore(g.A, g.B); ok {
			games = append(games, ng)
		}
	}
	if len(games) == 0 {
		return nil
	}
	out := &MatchScore{Format: format, Games: games}
	if isoDateRe.MatchString(raw.PlayedAt) {
		out.PlayedAt = raw.PlayedAt
	}
	return out
}

// GamesWon — berapa game dimenangkan tiap sisi. Game seri tidak dihitung.
func GamesWon(score *MatchScore) GamesWonCount {
	var out GamesWonCount
	if score == nil {
		return out
	}
	for _, g := range score.Games {
		if g.A > g.B {
			out.A++
		} else if g.B > g.A {
			out.B++
		}
	}
	return out
}

// ScoreLine — "21-18 · 19-21 · 21-15", dipakai buat share/ringkasan teks.
func ScoreLine(score *MatchScore) string {
	if score == nil || len(score.Games) == 0 {
		return ""
	}
	parts := make([]string, len(score.Games))
	for i, g := range score.Games {
		parts[i] = fmt.Sprintf("%d-%d", g.A, g.B)
	}
	return strings.Join(parts, " · ")
}

// --- Bagan knockout ---

// RoundCount — jumlah babak dari ukuran bagan: 4 slot → 2 babak, 8 → 3, 16 → 4.
func RoundCount(slots int) int {
	if slots < MinPairs {
		slots = MinPairs
	}
	return int(math.Round(math.Log2(float64(slots))))
}

// RoundLabel dihitung dari sisa babak menuju final.
func RoundLabel(round, total int) string {
	remaining := total - round
	switch {
	case remaining <= 1:
		return "Final"
	case remaining == 2:
		return "Semifinal"
	case remaining == 3:
		return "Perempat Final"
	default:
		return fmt.Sprintf("Babak %d Besar", 1<<remaining)
	}
}

func bracketSideOf(pair *TournamentPair, from string) BracketSide {
	return BracketSide{Pair: pair, Bye: IsPairEmpty(pair), From: from}
}

// resolveWinner: sisi BYE lolos otomatis; kalau dua-duanya berisi, butuh
// cukup game menang (single: 1, bo3: 2) dan tidak seri.
func resolveWinner(a, b BracketSide, score *MatchScore) (winner Side, autoWin bool) {
	if a.Bye && b.Bye {
		return SideNil, false
	}
	if a.Bye {
		if b.Pair != nil {
			return SideB, true
		}
		return SideNil, false
	}
	if b.Bye {
		if a.Pair != nil {
			return SideA, true
		}
		return SideNil, false
	}
	if a.Pair == nil || b.Pair == nil || score == nil {
		return SideNil, false
	}
	need := gamesToWin(score.Format)
	won := GamesWon(score)
	if won.A >= need && won.A > won.B {
		return SideA, false
	}
	if won.B >= need && won.B > won.A {
		return SideB, false
	}
	return SideNil, false
}

func winnerPair(m BracketMatch) *TournamentPair {
	switch m.Winner {
	case SideA:
		return m.A.Pair
	case SideB:
		return m.B.Pair
	default:
		return nil
	}
}

// KoksTotal — jumlah harga total semua kok (§9.5 A: harga per kok sudah
// mencakup semua orang, dibagi belakangan lewat PerPersonCost).
func KoksTotal(koks []TournamentKok) int64 {
	var total int64
	for _, k := range koks {
		total += k.Price
	}
	return total
}

// KoksByMatch mengelompokkan kok per partai; kunci "" = kok umum turnamen.
func KoksByMatch(koks []TournamentKok) map[string][]TournamentKok {
	out := map[string][]TournamentKok{}
	for _, k := range koks {
		out[k.MatchID] = append(out[k.MatchID], k)
	}
	return out
}

type KoksByDateGroup struct {
	Date string
	Koks []TournamentKok
}

// KoksByDate mengelompokkan kok per tanggal pemakaian, urut tanggal.
func KoksByDate(koks []TournamentKok) []KoksByDateGroup {
	byDate := map[string][]TournamentKok{}
	for _, k := range koks {
		byDate[k.Date] = append(byDate[k.Date], k)
	}
	dates := make([]string, 0, len(byDate))
	for d := range byDate {
		dates = append(dates, d)
	}
	sort.Strings(dates)
	out := make([]KoksByDateGroup, len(dates))
	for i, d := range dates {
		out[i] = KoksByDateGroup{Date: d, Koks: byDate[d]}
	}
	return out
}

// SeedSlots menempatkan pasangan ke slot bagan. Jumlah yang bukan pangkat 2
// disisipi BYE, disebar satu per partai (bukan menumpuk di ujung) — kalau
// menumpuk, ada partai yang dua sisinya kosong dan cabangnya jadi mubazir.
func SeedSlots(pairs []TournamentPair, size int) []*TournamentPair {
	slots := BracketSize(size)
	matches := slots / 2
	byes := slots - size
	firstByeMatch := matches - byes

	get := func(i int) *TournamentPair {
		if i < 0 || i >= len(pairs) {
			return nil
		}
		p := pairs[i]
		return &p
	}

	out := make([]*TournamentPair, 0, slots)
	next := 0
	for m := 0; m < matches; m++ {
		out = append(out, get(next))
		next++
		if m >= firstByeMatch {
			out = append(out, nil)
		} else {
			out = append(out, get(next))
			next++
		}
	}
	return out
}

func BuildBracket(t StoredTournament) Bracket {
	size := NormalizeSize(t.Size)
	slots := BracketSize(size)
	total := RoundCount(slots)
	pairs := SeedSlots(t.Pairs, size)
	byMatch := KoksByMatch(t.Koks)
	kokPaidMap := t.MatchKokPaid

	var rounds []BracketRound
	var prev []BracketMatch

	for round := 0; round < total; round++ {
		count := slots / (1 << (round + 1))
		matches := make([]BracketMatch, 0, count)
		for index := 0; index < count; index++ {
			id := MatchID(round, index)
			var a, b BracketSide
			if round == 0 {
				a = bracketSideOf(pairs[index*2], "")
				b = bracketSideOf(pairs[index*2+1], "")
			} else {
				srcA := prev[index*2]
				srcB := prev[index*2+1]
				a = BracketSide{Pair: winnerPair(srcA), Bye: srcA.A.Bye && srcA.B.Bye, From: srcA.ID}
				b = BracketSide{Pair: winnerPair(srcB), Bye: srcB.A.Bye && srcB.B.Bye, From: srcB.ID}
			}
			var score *MatchScore
			if s, ok := t.Results[id]; ok {
				score = &s
			}
			winner, autoWin := resolveWinner(a, b, score)
			koks := byMatch[id]
			match := BracketMatch{
				ID:       id,
				Round:    round,
				Index:    index,
				A:        a,
				B:        b,
				Score:    score,
				GamesWon: GamesWon(score),
				Winner:   winner,
				AutoWin:  autoWin,
				Koks:     koks,
				KokTotal: KoksTotal(koks),
				KokPaid:  kokPaidMap[id],
			}
			matches = append(matches, match)
		}
		rounds = append(rounds, BracketRound{Round: round, Label: RoundLabel(round, total), Matches: matches})
		prev = matches
	}

	var champion *TournamentPair
	if len(prev) > 0 {
		champion = winnerPair(prev[0])
	}
	return Bracket{Rounds: rounds, Champion: champion}
}

// --- Round robin ---

func pointsOf(score *MatchScore) (a, b int) {
	if score == nil {
		return 0, 0
	}
	for _, g := range score.Games {
		a += g.A
		b += g.B
	}
	return a, b
}

// BuildRoundRobin — semua lawan semua, sekali putaran. Klasemen diurutkan:
// menang terbanyak, lalu selisih poin, lalu poin dibuat, terakhir nama.
func BuildRoundRobin(t StoredTournament) RoundRobin {
	size := NormalizeSize(t.Size)
	byMatch := KoksByMatch(t.Koks)
	kokPaidMap := t.MatchKokPaid

	rows := map[string]*StandingRow{}
	order := []string{}
	rowFor := func(pair TournamentPair) *StandingRow {
		if r, ok := rows[pair.ID]; ok {
			return r
		}
		r := &StandingRow{Pair: pair}
		rows[pair.ID] = r
		order = append(order, pair.ID)
		return r
	}
	// Pasangan kosong tidak ikut klasemen — di round robin tidak ada BYE.
	for _, p := range t.Pairs {
		if !IsPairEmpty(&p) {
			rowFor(p)
		}
	}

	var matches []BracketMatch
	index := 0
	for i := 0; i < size; i++ {
		for j := i + 1; j < size; j++ {
			var pairA, pairB *TournamentPair
			if i < len(t.Pairs) {
				pairA = &t.Pairs[i]
			}
			if j < len(t.Pairs) {
				pairB = &t.Pairs[j]
			}
			id := RRMatchID(i, j)
			a := bracketSideOf(pairA, "")
			b := bracketSideOf(pairB, "")
			var score *MatchScore
			if s, ok := t.Results[id]; ok {
				score = &s
			}
			// Tidak ada BYE di round robin: slot kosong berarti partainya
			// tidak ada, bukan lawannya menang otomatis.
			var winner Side
			if !a.Bye && !b.Bye {
				winner, _ = resolveWinner(a, b, score)
			}
			koks := byMatch[id]
			match := BracketMatch{
				ID:       id,
				Round:    0,
				Index:    index,
				A:        a,
				B:        b,
				Score:    score,
				GamesWon: GamesWon(score),
				Winner:   winner,
				Koks:     koks,
				KokTotal: KoksTotal(koks),
				KokPaid:  kokPaidMap[id],
			}
			index++
			matches = append(matches, match)

			if winner == SideNil || pairA == nil || pairB == nil {
				continue
			}
			won := GamesWon(score)
			ptsA, ptsB := pointsOf(score)
			rowA := rowFor(*pairA)
			rowB := rowFor(*pairB)
			rowA.Played++
			rowB.Played++
			rowA.GamesFor += won.A
			rowA.GamesAgainst += won.B
			rowB.GamesFor += won.B
			rowB.GamesAgainst += won.A
			rowA.PointsFor += ptsA
			rowA.PointsAgainst += ptsB
			rowB.PointsFor += ptsB
			rowB.PointsAgainst += ptsA
			if winner == SideA {
				rowA.Won++
				rowB.Lost++
			} else {
				rowB.Won++
				rowA.Lost++
			}
		}
	}

	standings := make([]StandingRow, 0, len(order))
	for _, id := range order {
		r := rows[id]
		r.Diff = r.PointsFor - r.PointsAgainst
		standings = append(standings, *r)
	}
	sort.SliceStable(standings, func(i, j int) bool {
		x, y := standings[i], standings[j]
		if x.Won != y.Won {
			return x.Won > y.Won
		}
		if x.Diff != y.Diff {
			return x.Diff > y.Diff
		}
		if x.PointsFor != y.PointsFor {
			return x.PointsFor > y.PointsFor
		}
		return PairLabel(&x.Pair) < PairLabel(&y.Pair)
	})

	// Partai yang dua sisinya kosong tidak mungkin dimainkan — jangan dihitung.
	var playable []BracketMatch
	for _, m := range matches {
		if m.A.Pair != nil && m.B.Pair != nil && !m.A.Bye && !m.B.Bye {
			playable = append(playable, m)
		}
	}
	played := 0
	for _, m := range playable {
		if m.Winner != SideNil {
			played++
		}
	}
	done := len(playable) > 0 && played == len(playable)
	var champion *TournamentPair
	// Juara cuma sah kalau semua partai sudah main dan peringkat 1 tidak
	// seri menang-nya.
	if done && len(standings) > 0 {
		top := standings[0]
		if len(standings) == 1 || top.Won > standings[1].Won {
			champion = &top.Pair
		}
	}

	return RoundRobin{
		Matches:     matches,
		Standings:   standings,
		Champion:    champion,
		PlayedCount: played,
		TotalCount:  len(playable),
	}
}

// --- Biaya & iuran ---

func TournamentCostOf(t StoredTournament) TournamentCost {
	fee := t.Fee
	if fee < 0 {
		fee = 0
	}
	paidCount := 0
	for _, f := range t.Fees {
		if f.Paid {
			paidCount++
		}
	}
	var loose []TournamentKok
	for _, k := range t.Koks {
		if k.MatchID == "" {
			loose = append(loose, k)
		}
	}
	participants := len(t.Fees)
	return TournamentCost{
		KokCount:     len(t.Koks),
		KokTotal:     KoksTotal(t.Koks),
		LooseKoks:    loose,
		Participants: participants,
		FeeTotal:     fee * int64(participants),
		FeePaid:      fee * int64(paidCount),
		FeeUnpaid:    fee * int64(participants-paidCount),
		PaidCount:    paidCount,
		UnpaidCount:  participants - paidCount,
	}
}

// matchesKokPaid — rupiah kok per-partai yang udah lunas, dijumlah lintas
// partai. Butuh matches yang udah di-resolve (kokPaid per slot).
func matchesKokPaid(matches []BracketMatch) int64 {
	var total int64
	for _, m := range matches {
		if m.KokTotal <= 0 {
			continue
		}
		perPerson := MatchKokPerPerson(m)
		if perPerson <= 0 {
			continue
		}
		names := MatchParticipants(m)
		for i, name := range names {
			if name != "" && m.KokPaid[i] {
				total += perPerson
			}
		}
	}
	return total
}

func EnrichTournament(t StoredTournament) EnrichedTournament {
	baseCost := TournamentCostOf(t)

	if NormalizeFormat(t.Format) == FormatRoundRobin {
		rr := BuildRoundRobin(t)
		cost := baseCost
		cost.KokPaid = matchesKokPaid(rr.Matches)
		return EnrichedTournament{
			StoredTournament: t,
			RoundRobin:       &rr,
			Matches:          rr.Matches,
			Champion:         rr.Champion,
			PlayedCount:      rr.PlayedCount,
			TotalCount:       rr.TotalCount,
			Finished:         rr.TotalCount > 0 && rr.PlayedCount == rr.TotalCount,
			Cost:             cost,
		}
	}

	bracket := BuildBracket(t)
	var matches []BracketMatch
	for _, r := range bracket.Rounds {
		matches = append(matches, r.Matches...)
	}
	// Partai yang salah satu sisinya BYE lolos otomatis — bukan partai yang dimainkan.
	var playable []BracketMatch
	for _, m := range matches {
		if !m.A.Bye && !m.B.Bye {
			playable = append(playable, m)
		}
	}
	played := 0
	for _, m := range playable {
		if m.Winner != SideNil {
			played++
		}
	}
	cost := baseCost
	cost.KokPaid = matchesKokPaid(matches)
	return EnrichedTournament{
		StoredTournament: t,
		Bracket:          &bracket,
		Matches:          matches,
		Champion:         bracket.Champion,
		PlayedCount:      played,
		TotalCount:       len(playable),
		Finished:         bracket.Champion != nil,
		Cost:             cost,
	}
}

type TournamentPodium struct {
	Champion *TournamentPair
	RunnerUp *TournamentPair
	// Bisa 2 pasangan di knockout (dua kalah semifinal, tidak ada perebutan
	// juara 3).
	Third []TournamentPair
}

// TournamentPodiumOf — juara 1/2/3 turnamen yang sudah selesai. Round robin
// ambil 3 teratas klasemen; knockout ambil pemenang final + dua kalah
// semifinal (juara 3, sengaja tidak dibedakan peringkatnya).
func TournamentPodiumOf(t EnrichedTournament) TournamentPodium {
	if !t.Finished {
		return TournamentPodium{}
	}

	if t.RoundRobin != nil {
		s := t.RoundRobin.Standings
		p := TournamentPodium{Champion: t.Champion}
		if len(s) > 1 {
			p.RunnerUp = &s[1].Pair
		}
		if len(s) > 2 {
			p.Third = []TournamentPair{s[2].Pair}
		}
		return p
	}

	if t.Bracket != nil {
		rounds := t.Bracket.Rounds
		if len(rounds) == 0 {
			return TournamentPodium{Champion: t.Champion}
		}
		final := rounds[len(rounds)-1]
		if len(final.Matches) == 0 || final.Matches[0].Winner == SideNil {
			return TournamentPodium{Champion: t.Champion}
		}
		fm := final.Matches[0]
		var runnerUp *TournamentPair
		if fm.Winner == SideA {
			runnerUp = fm.B.Pair
		} else {
			runnerUp = fm.A.Pair
		}
		var third []TournamentPair
		if len(rounds) >= 2 {
			for _, m := range rounds[len(rounds)-2].Matches {
				if m.Winner == SideNil {
					continue // BYE atau belum dimainkan
				}
				var loser *TournamentPair
				if m.Winner == SideA {
					loser = m.B.Pair
				} else {
					loser = m.A.Pair
				}
				if loser != nil {
					third = append(third, *loser)
				}
			}
		}
		return TournamentPodium{Champion: t.Champion, RunnerUp: runnerUp, Third: third}
	}

	return TournamentPodium{Champion: t.Champion}
}

// PlayedMatches — semua partai yang sudah punya skor.
func PlayedMatches(matches []BracketMatch) []BracketMatch {
	var out []BracketMatch
	for _, m := range matches {
		if m.Score != nil {
			out = append(out, m)
		}
	}
	return out
}

// TournamentMatches menurunkan semua partai dari data mentah turnamen, apa
// pun formatnya — dipakai buat billing kok per partai.
func TournamentMatches(t StoredTournament) []BracketMatch {
	if NormalizeFormat(t.Format) == FormatRoundRobin {
		return BuildRoundRobin(t).Matches
	}
	var out []BracketMatch
	for _, r := range BuildBracket(t).Rounds {
		out = append(out, r.Matches...)
	}
	return out
}

// MatchParticipants — 4 nama pemain partai ini, urutan tetap
// [sisiA.a, sisiA.b, sisiB.a, sisiB.b]. Slot BYE/kosong = "".
func MatchParticipants(m BracketMatch) [4]string {
	var out [4]string
	if m.A.Pair != nil {
		out[0], out[1] = m.A.Pair.A, m.A.Pair.B
	}
	if m.B.Pair != nil {
		out[2], out[3] = m.B.Pair.A, m.B.Pair.B
	}
	return out
}

// MatchKokPerPerson — bagian kok partai ini per orang (4 pemain tetap),
// dibulatkan sama seperti GameCostOf.
func MatchKokPerPerson(m BracketMatch) int64 {
	return PerPersonCost(m.KokTotal, 4)
}

// MatchPlayedDate — tanggal partai ini benar-benar dimainkan; skor lama
// tanpa PlayedAt jatuh ke tanggal mulai turnamen.
func MatchPlayedDate(t StoredTournament, m BracketMatch) string {
	if m.Score != nil && m.Score.PlayedAt != "" {
		return m.Score.PlayedAt
	}
	return t.Date
}

// FinalPlayedMatchID — id partai berskor paling akhir (final kalau sudah
// dimainkan). Dipakai buat menempel info juara/status lunas ke satu partai.
func FinalPlayedMatchID(matches []BracketMatch) string {
	played := PlayedMatches(matches)
	if len(played) == 0 {
		return ""
	}
	return played[len(played)-1].ID
}

type TournamentStatusValue string

const (
	StatusAkanDatang TournamentStatusValue = "akan-datang"
	StatusBerjalan   TournamentStatusValue = "berjalan"
	StatusSelesai    TournamentStatusValue = "selesai"
)

// TournamentStatus — status relatif hari ini; turnamen boleh dijadwalkan ke depan.
func TournamentStatus(date string, finished bool, today string) TournamentStatusValue {
	if finished {
		return StatusSelesai
	}
	if date > today {
		return StatusAkanDatang
	}
	return StatusBerjalan
}

// MatchTitle — knockout pakai nama babak ("Semifinal · Partai 2"); round
// robin tidak punya babak, jadi dinomori urut.
func MatchTitle(format TournamentFormat, size int, round, index int) string {
	if NormalizeFormat(format) == FormatRoundRobin {
		return fmt.Sprintf("Partai %d", index+1)
	}
	slots := BracketSize(NormalizeSize(size))
	total := RoundCount(slots)
	count := slots / (1 << (round + 1))
	label := RoundLabel(round, total)
	if count > 1 {
		return fmt.Sprintf("%s · Partai %d", label, index+1)
	}
	return label
}

// SuggestFee — saran iuran per orang biar nutup biaya kok, dibulatkan ke
// atas per 500. Integer murni (invarian §3.1), sama teknik dengan
// PerPersonCost tapi kelipatan 500, bukan 100.
func SuggestFee(kokTotal int64, participants int) int64 {
	if participants <= 0 || kokTotal <= 0 {
		return 0
	}
	step := int64(500 * participants)
	return 500 * ceilDiv(kokTotal, step)
}
