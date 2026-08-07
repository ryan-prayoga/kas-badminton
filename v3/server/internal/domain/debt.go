// Port dari v2/lib/domain/debt.ts — hutang & cicilan. Planner murni: balik
// daftar slot yang harus di-flip jadi paid + carry baru + nominal payment
// yang dicatat. Repo layer (F2) yang eksekusi tulisannya.
//
// Dua sumber tagihan: main biasa (per pemain per game) dan kok per partai
// turnamen (cuma ditagih ke 4 pemain partai itu). Iuran patungan turnamen
// (fee flat, pool terpisah) SENGAJA tidak ikut di sini — itu ditagih &
// dilunasin sendiri di halaman Turnamen, biar Rekap fokus ke kok aja.
package domain

// BuildDebtSummary — ringkasan hutang per orang: sisa = max(0, owedGross −
// carry).
func BuildDebtSummary(games []EnrichedGame, carry CarryMap, tournaments []EnrichedTournament) []DebtEntry {
	type accum struct {
		name      string
		owedGross int64
		items     []DebtItem
	}
	byName := map[string]*accum{}
	var order []string
	bucket := func(name string) *accum {
		if a, ok := byName[name]; ok {
			return a
		}
		a := &accum{name: name}
		byName[name] = a
		order = append(order, name)
		return a
	}

	matchNumbers := GameMatchNumbers(storedGamesOf(games))

	for _, g := range games {
		for _, p := range g.Players {
			if p.Paid || p.Name == "" {
				continue
			}
			e := bucket(p.Name)
			e.owedGross += g.Cost.PerPerson
			e.items = append(e.items, DebtItem{
				GameID:      g.ID,
				Date:        g.Date,
				Name:        p.Name,
				Amount:      g.Cost.PerPerson,
				KokCount:    g.Cost.KokCount,
				Kind:        DebtKindGame,
				CreatedAt:   g.CreatedAt,
				MatchNumber: matchNumbers[g.ID],
			})
		}
	}

	for _, tt := range tournaments {
		for _, m := range tt.Matches {
			if m.KokTotal <= 0 {
				continue
			}
			perPerson := MatchKokPerPerson(m)
			if perPerson <= 0 {
				continue
			}
			names := MatchParticipants(m)
			for i, name := range names {
				if name == "" || m.KokPaid[i] {
					continue
				}
				e := bucket(name)
				e.owedGross += perPerson
				e.items = append(e.items, DebtItem{
					GameID:    tt.ID + "::" + m.ID,
					Date:      MatchPlayedDate(tt.StoredTournament, m),
					Name:      name,
					Amount:    perPerson,
					KokCount:  len(m.Koks),
					Kind:      DebtKindTurnamenKok,
					Label:     tt.Name + " · " + MatchTitle(tt.Format, tt.Size, m.Round, m.Index),
					CreatedAt: tt.CreatedAt,
				})
			}
		}
	}

	out := make([]DebtEntry, 0, len(order))
	for _, name := range order {
		a := byName[name]
		c := carry[name]
		if c < 0 {
			c = 0
		}
		total := a.owedGross - c
		if total < 0 {
			total = 0
		}
		out = append(out, DebtEntry{Name: a.name, OwedGross: a.owedGross, Items: a.items, Carry: c, Total: total})
	}
	sortDebtEntries(out)
	return out
}

func sortDebtEntries(entries []DebtEntry) {
	// insertion sort — jumlah entri sekecil jumlah anggota klub (§4.2: tidak
	// ada agregat besar di memori); ganti sort.Slice kalau nanti perlu.
	for i := 1; i < len(entries); i++ {
		j := i
		for j > 0 && less(entries[j], entries[j-1]) {
			entries[j-1], entries[j] = entries[j], entries[j-1]
			j--
		}
	}
}

// less: urut total menurun, seri dipecah nama menaik.
func less(a, b DebtEntry) bool {
	if a.Total != b.Total {
		return a.Total > b.Total
	}
	return a.Name < b.Name
}

func storedGamesOf(games []EnrichedGame) []StoredGame {
	out := make([]StoredGame, len(games))
	for i, g := range games {
		out[i] = g.StoredGame
	}
	return out
}

// --- Cicilan & lunas ---

type unpaidRef struct {
	slot      TouchedSlot
	date      string
	createdAt string
	amount    int64
}

func (r unpaidRef) orderKey() string { return r.date + "\x00" + r.createdAt }

func unpaidRefs(games []StoredGame, name string, tournaments []StoredTournament) []unpaidRef {
	var refs []unpaidRef
	for _, g := range games {
		perPerson := GameCostOf(g.Koks, len(g.Players)).PerPerson
		for i, p := range g.Players {
			if p.Name == name && !p.Paid {
				refs = append(refs, unpaidRef{
					slot:      TouchedSlot{Kind: DebtKindGame, ID: g.ID, Index: i},
					date:      g.Date,
					createdAt: g.CreatedAt,
					amount:    perPerson,
				})
			}
		}
	}
	for _, t := range tournaments {
		for _, m := range TournamentMatches(t) {
			if m.KokTotal <= 0 {
				continue
			}
			perPerson := MatchKokPerPerson(m)
			if perPerson <= 0 {
				continue
			}
			names := MatchParticipants(m)
			for i, n := range names {
				if n != name || m.KokPaid[i] {
					continue
				}
				refs = append(refs, unpaidRef{
					slot:      TouchedSlot{Kind: DebtKindTurnamenKok, ID: t.ID, Index: i, MatchID: m.ID},
					date:      MatchPlayedDate(t, m),
					createdAt: t.CreatedAt,
					amount:    perPerson,
				})
			}
		}
	}
	return refs
}

// PlanInstallment — bayar sebagian: greedy lunasin tagihan yang nominalnya
// paling pas (best-fit) dulu, bukan yang paling lama (§9.5 B).
func PlanInstallment(games []StoredGame, carry CarryMap, name string, amount int64, tournaments []StoredTournament) SettlePlan {
	c := carry[name]
	if c < 0 {
		c = 0
	}
	credit := c + amount
	refs := unpaidRefs(games, name, tournaments)

	touched, remaining := bestFitPlan(refs,
		func(r unpaidRef) int64 { return r.amount },
		unpaidRef.orderKey,
		credit,
	)

	slots := make([]TouchedSlot, len(touched))
	for i, r := range touched {
		slots[i] = r.slot
	}

	plan := SettlePlan{
		Touched:       slots,
		PaymentAmount: amount,
		// Cicilan yang menutup semua tagihan tersisa dihitung lunas (sisa
		// kredit jadi titipan).
		ClearsDebt: len(refs) > 0 && len(touched) == len(refs),
	}
	if remaining > 0 {
		plan.CarryAfter = remaining
		plan.HasCarryAfter = true
	}
	return plan
}

// PlanSettle — lunasin semua tagihan orang sekali klik. Tunai = max(0, total − carry titipan).
func PlanSettle(games []StoredGame, carry CarryMap, name string, tournaments []StoredTournament) SettlePlan {
	carryBefore := carry[name]
	if carryBefore < 0 {
		carryBefore = 0
	}
	refs := unpaidRefs(games, name, tournaments)
	sortUnpaidRefsByOldest(refs)

	var settled int64
	slots := make([]TouchedSlot, len(refs))
	for i, r := range refs {
		settled += r.amount
		slots[i] = r.slot
	}

	payment := settled - carryBefore
	if payment < 0 {
		payment = 0
	}
	return SettlePlan{Touched: slots, PaymentAmount: payment, ClearsDebt: true}
}

func sortUnpaidRefsByOldest(refs []unpaidRef) {
	for i := 1; i < len(refs); i++ {
		j := i
		for j > 0 && refs[j-1].orderKey() > refs[j].orderKey() {
			refs[j-1], refs[j] = refs[j], refs[j-1]
			j--
		}
	}
}
