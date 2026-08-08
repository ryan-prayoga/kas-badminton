package migratev2

import (
	"context"
	"fmt"
	"sort"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/domain"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// participantNamesRequiringMapping — nama yang menanggung uang lewat
// turnamen (dipasangkan atau punya baris iuran) — ikut wajib dipetakan,
// sama alasan pemain main harian (migrate.go CollectNamesRequiringMapping).
func participantNamesRequiringMapping(tournaments []V2Tournament) []string {
	var names []string
	for _, t := range tournaments {
		for _, p := range t.Pairs {
			if NormalizeName(p.A) != "" {
				names = append(names, p.A)
			}
			if NormalizeName(p.B) != "" {
				names = append(names, p.B)
			}
		}
		for _, f := range t.Fees {
			names = append(names, f.Name)
		}
	}
	return names
}

// toDomainStoredTournament — konversi APA ADANYA, tanpa normalisasi ulang
// (domain.EnrichTournament tidak butuh itu — lihat komentar migrate.go).
// matchId di Results/Koks/MatchKokPaid sudah dalam format PERSIS yang
// sama dengan domain.MatchID/RRMatchID hasilkan (v2 & v3 pakai rumus
// string yang identik, "r%d-%d"/"rr%d-%d") — jadi lookup silang aman
// tanpa penerjemahan apa pun.
func toDomainStoredTournament(t V2Tournament) domain.StoredTournament {
	pairs := make([]domain.TournamentPair, len(t.Pairs))
	for i, p := range t.Pairs {
		pairs[i] = domain.TournamentPair{ID: p.ID, Slot: p.Slot, A: p.A, B: p.B}
	}

	results := map[string]domain.MatchScore{}
	for id, sc := range t.Results {
		games := make([]domain.GameScore, len(sc.Games))
		for i, g := range sc.Games {
			games[i] = domain.GameScore{A: g.A, B: g.B}
		}
		playedAt := derefStr(sc.PlayedAt)
		results[id] = domain.MatchScore{Format: domain.ScoreFormat(sc.Format), Games: games, PlayedAt: playedAt}
	}

	koks := make([]domain.TournamentKok, len(t.Koks))
	for i, k := range t.Koks {
		koks[i] = domain.TournamentKok{
			Kok:     domain.Kok{TypeID: derefStr(k.TypeID), TypeName: derefStr(k.TypeName), Price: k.PricePerPerson},
			MatchID: derefStr(k.MatchID), Date: k.Date,
		}
	}

	fees := make([]domain.TournamentFee, len(t.Fees))
	for i, f := range t.Fees {
		fees[i] = domain.TournamentFee{Name: f.Name, Paid: f.Paid, PaidAt: derefStr(f.PaidAt), PaidBy: derefStr(f.PaidBy)}
	}

	mkp := map[string][4]bool{}
	for id, arr := range t.MatchKokPaid {
		mkp[id] = arr
	}

	return domain.StoredTournament{
		ID: t.ID, Name: t.Name, Date: t.Date, EndDate: derefStr(t.EndDate),
		Format: domain.TournamentFormat(t.Format), Size: t.Size, Fee: t.Fee,
		ScoreFormat: domain.ScoreFormat(t.ScoreFormat),
		Pairs:       pairs, Results: results, Koks: koks, Fees: fees, MatchKokPaid: mkp,
	}
}

// matchDBCoords — port matchDBCoords (internal/http/tournaments.go,
// unexported di sana jadi tidak bisa diimpor) — SATU-SATUNYA tempat yang
// tahu skema round/idx penyimpanan `matches`. Round robin idx = i*100+j
// (i<j) supaya UNIQUE(tournament_id,round,idx) tetap terjamin sampai 32
// pasangan (MaxPairs — j maksimal 31, aman jauh di bawah 100).
func matchDBCoords(format domain.TournamentFormat, m domain.BracketMatch) (round, idx int32, err error) {
	if format == domain.FormatRoundRobin {
		var i, j int
		if _, e := fmt.Sscanf(m.ID, "rr%d-%d", &i, &j); e != nil {
			return 0, 0, fmt.Errorf("id partai round robin tidak valid: %q", m.ID)
		}
		if i > j {
			i, j = j, i
		}
		return 0, int32(i*100 + j), nil
	}
	return int32(m.Round), int32(m.Index), nil
}

// migrateTournament — SATU turnamen, dipanggil DI DALAM closure
// s.WithClub yang sama dengan Migrate (migrate.go) supaya kegagalan di
// mana pun (termasuk verifikasi akhir Migrate) membatalkan turnamen ini
// JUGA, bukan cuma main harian. ensureUser SAMA closure dgn Migrate
// (dedup user lintas main-harian & turnamen otomatis, bukan dua peta
// terpisah yang bisa mencar).
func migrateTournament(
	ctx context.Context, q *gen.Queries, clubID uuid.UUID, slug string,
	t V2Tournament, mapping NameMapping, kokTypeV3 map[string]uuid.UUID,
	ensureUser func(string) (uuid.UUID, error),
) error {
	stored := toDomainStoredTournament(t)
	enriched := domain.EnrichTournament(stored)

	tID := tournamentID(slug, t.ID)
	startsOn, err := parseDate(t.Date)
	if err != nil {
		return fmt.Errorf("tanggal mulai turnamen %s: %w", t.ID, err)
	}
	var endsOn pgtype.Date
	if t.EndDate != nil {
		d, err := parseDate(*t.EndDate)
		if err != nil {
			return fmt.Errorf("tanggal selesai turnamen %s: %w", t.ID, err)
		}
		endsOn = d
	}

	var recordedByID *uuid.UUID
	if t.RecordedBy != nil {
		if canonical, ok := mapping[NormalizeName(*t.RecordedBy)]; ok {
			id, err := ensureUser(canonical)
			if err != nil {
				return err
			}
			recordedByID = &id
		}
		// Tidak ada recorded_by_name fallback di tabel tournaments (beda
		// dari games — komentar queries/migrate_v2.sql), jadi kalau tidak
		// cocok mapping ya NULL, bukan galat.
	}

	if _, err := q.UpsertMigratedTournament(ctx, gen.UpsertMigratedTournamentParams{
		ID: tID, ClubID: clubID, Name: t.Name, StartsOn: startsOn, EndsOn: endsOn,
		Format: gen.TournamentFormat(t.Format), Size: int32(t.Size), Fee: t.Fee,
		ScoreFormat: gen.ScoreFormat(t.ScoreFormat), Notes: textOrNilPg(derefStr(t.Notes)),
		RecordedBy: recordedByID, CreatedAt: pgtype.Timestamptz{Time: t.CreatedAt, Valid: true},
	}); err != nil {
		return fmt.Errorf("bikin turnamen %s: %w", t.ID, err)
	}

	// --- Pasangan: SATU per slot, player NULL = BYE/kosong. matches.pair_a/
	// pair_b SENGAJA tidak pernah diisi di sini — produksi sendiri tidak
	// pernah menulisnya (EnsureMatch, tournaments.sql, cuma
	// tournament_id/club_id/round/idx); sumber kebenaran pasangan tiap
	// partai TETAP dihitung ulang dari tournament_pairs+match_games saat
	// baca (komentar UpdateMatchResult), bukan kolom itu. ---
	for _, p := range t.Pairs {
		pID := tournamentPairID(slug, t.ID, p.Slot)
		var playerA, playerB *uuid.UUID
		if NormalizeName(p.A) != "" {
			canonical, err := mapping.Resolve(p.A)
			if err != nil {
				return err
			}
			id, err := ensureUser(canonical)
			if err != nil {
				return err
			}
			playerA = &id
		}
		if NormalizeName(p.B) != "" {
			canonical, err := mapping.Resolve(p.B)
			if err != nil {
				return err
			}
			id, err := ensureUser(canonical)
			if err != nil {
				return err
			}
			playerB = &id
		}
		if _, err := q.UpsertMigratedTournamentPair(ctx, gen.UpsertMigratedTournamentPairParams{
			ID: pID, TournamentID: tID, ClubID: clubID, Slot: int32(p.Slot), PlayerA: playerA, PlayerB: playerB,
		}); err != nil {
			return fmt.Errorf("bikin pasangan turnamen %s slot %d: %w", t.ID, p.Slot, err)
		}
	}

	// --- Partai: bagan/klasemen dihitung ULANG lewat domain.EnrichTournament
	// (bukan re-implementasi di sini) — matches dibuat cuma buat partai
	// yang punya skor ATAU kok terikat (persis EnsureMatch "lazy" di
	// jalur HTTP produksi, tournaments.go handleScoreMatch/addTournamentKok). ---
	matchV3ID := map[string]uuid.UUID{} // v2/domain matchId string -> v3 matches.id
	koksByMatch := map[string][]V2TournamentKok{}
	var looseKoks []V2TournamentKok
	for _, k := range t.Koks {
		if k.MatchID != nil && *k.MatchID != "" {
			koksByMatch[*k.MatchID] = append(koksByMatch[*k.MatchID], k)
		} else {
			looseKoks = append(looseKoks, k)
		}
	}

	playedCount := 0
	for _, m := range enriched.Matches {
		hasScore := m.Score != nil
		hasKoks := len(koksByMatch[m.ID]) > 0
		if !hasScore && !hasKoks {
			continue
		}
		round, idx, err := matchDBCoords(stored.Format, m)
		if err != nil {
			return fmt.Errorf("turnamen %s: %w", t.ID, err)
		}
		match, err := q.EnsureMatch(ctx, gen.EnsureMatchParams{TournamentID: tID, ClubID: clubID, Round: round, Idx: idx})
		if err != nil {
			return fmt.Errorf("bikin partai %s turnamen %s: %w", m.ID, t.ID, err)
		}
		matchV3ID[m.ID] = match.ID

		if hasScore {
			if err := q.DeleteMatchGames(ctx, match.ID); err != nil {
				return err
			}
			for i, g := range m.Score.Games {
				if _, err := q.CreateMatchGame(ctx, gen.CreateMatchGameParams{
					MatchID: match.ID, GameNo: int16(i + 1), ScoreA: int16(g.A), ScoreB: int16(g.B),
				}); err != nil {
					return fmt.Errorf("bikin skor partai %s: %w", m.ID, err)
				}
			}
			var winnerSide gen.NullGameSide
			if m.Winner != domain.SideNil {
				winnerSide = gen.NullGameSide{GameSide: gen.GameSide(m.Winner), Valid: true}
			}
			playedOn, _ := parseDate(domain.MatchPlayedDate(stored, m))
			if _, err := q.UpdateMatchResult(ctx, gen.UpdateMatchResultParams{
				ID: match.ID, ClubID: clubID, WinnerSide: winnerSide, AutoWin: m.AutoWin,
				ScoreFormat: gen.NullScoreFormat{ScoreFormat: gen.ScoreFormat(m.Score.Format), Valid: true},
				PlayedOn:    playedOn,
			}); err != nil {
				return fmt.Errorf("simpan hasil partai %s: %w", m.ID, err)
			}
			if !m.A.Bye && !m.B.Bye {
				playedCount++
			}
		}
	}

	// --- Kok per-partai: dicatat 1:1 (match_koks, arsip pemakaian) +
	// ditagih SEKALI per partai ke 4 slot pesertanya (match_kok_charges,
	// jumlah SEMUA kok partai itu — bukan per baris kok, karena
	// matchKokPaid v2 juga satu status per partai bukan per kok). ---
	for matchDomainID, koks := range koksByMatch {
		v3MatchID, ok := matchV3ID[matchDomainID]
		if !ok {
			continue // partai tidak sah (BYE/tak ada di bagan) — kok yang menunjuk ke situ diabaikan, sama semangat v2 (matchId tak valid jadi kok umum)
		}
		var found *domain.BracketMatch
		for i := range enriched.Matches {
			if enriched.Matches[i].ID == matchDomainID {
				found = &enriched.Matches[i]
				break
			}
		}
		if found == nil || found.A.Bye || found.B.Bye {
			continue
		}
		var perPerson int64
		for _, k := range koks {
			id := matchKokID(slug, t.ID, matchDomainID, kokIdentity(V2GameKok{TypeID: k.TypeID, TypeName: k.TypeName, PricePerPerson: k.PricePerPerson}))
			var ktID *uuid.UUID
			if k.TypeID != nil {
				if v3id, ok := kokTypeV3[*k.TypeID]; ok {
					ktID = &v3id
				}
			}
			usedOn, _ := parseDate(k.Date)
			if err := q.InsertMigratedMatchKok(ctx, gen.InsertMigratedMatchKokParams{
				ID: id, ClubID: clubID, TournamentID: tID, MatchID: &v3MatchID, KokTypeID: ktID,
				TypeName: textOrNilPg(derefStr(k.TypeName)), PricePerPerson: k.PricePerPerson, UsedOn: usedOn,
			}); err != nil {
				return fmt.Errorf("bikin match_kok partai %s: %w", matchDomainID, err)
			}
			perPerson += k.PricePerPerson
		}
		names := domain.MatchParticipants(*found)
		paid := stored.MatchKokPaid[matchDomainID]
		chargedOn, _ := parseDate(koks[0].Date)
		for i, name := range names {
			if NormalizeName(name) == "" {
				continue
			}
			canonical, err := mapping.Resolve(name)
			if err != nil {
				return err
			}
			uID, err := ensureUser(canonical)
			if err != nil {
				return err
			}
			var paidAt pgtype.Timestamptz
			if paid[i] {
				paidAt = pgtype.Timestamptz{Time: t.UpdatedAt, Valid: true}
			}
			chargeID := deriveID("matchKokCharge", slug, t.ID, matchDomainID, fmt.Sprintf("%d", i))
			if err := q.InsertMigratedMatchKokCharge(ctx, gen.InsertMigratedMatchKokChargeParams{
				ID: chargeID, ClubID: clubID, TournamentID: tID, MatchID: &v3MatchID, UserID: uID,
				Amount: perPerson, PaidAt: paidAt, ChargedOn: chargedOn,
			}); err != nil {
				return fmt.Errorf("bikin tagihan kok partai %s: %w", matchDomainID, err)
			}
		}
	}

	// --- Kok umum (lepas dari partai manapun) — v2 TIDAK PERNAH menagih
	// ini ke siapa pun (lubang yang diakui, DDL.sql match_koks.match_id
	// komentar). Migrasi MENUTUPnya: dibagi rata ke SEMUA peserta yang
	// tercatat di bagan, kelebihan pembulatan masuk kas sebagai
	// "pembulatan" — SAMA ATURAN v3 (tournaments.go addTournamentKok
	// jalur "kok umum"), diterapkan retroaktif ke data lama. Statusnya
	// SELALU belum lunas (v2 tidak pernah tahu ini utang, jadi tidak ada
	// "sudah dibayar" buat direkonstruksi). ---
	if len(looseKoks) > 0 {
		participants := domain.ParticipantNames(stored.Pairs)
		if len(participants) > 0 {
			var total int64
			for _, k := range looseKoks {
				id := matchKokID(slug, t.ID, "", kokIdentity(V2GameKok{TypeID: k.TypeID, TypeName: k.TypeName, PricePerPerson: k.PricePerPerson}))
				var ktID *uuid.UUID
				if k.TypeID != nil {
					if v3id, ok := kokTypeV3[*k.TypeID]; ok {
						ktID = &v3id
					}
				}
				usedOn, _ := parseDate(k.Date)
				if err := q.InsertMigratedMatchKok(ctx, gen.InsertMigratedMatchKokParams{
					ID: id, ClubID: clubID, TournamentID: tID, MatchID: nil, KokTypeID: ktID,
					TypeName: textOrNilPg(derefStr(k.TypeName)), PricePerPerson: k.PricePerPerson, UsedOn: usedOn,
				}); err != nil {
					return fmt.Errorf("bikin match_kok umum: %w", err)
				}
				total += k.PricePerPerson * 4 // domain.KoksTotal: harga per kok = pricePerPerson × 4
			}
			perPerson := domain.PerPersonCost(total, len(participants))
			chargedOn := startsOn
			sortedParticipants := append([]string{}, participants...)
			sort.Strings(sortedParticipants)
			for _, name := range sortedParticipants {
				canonical, err := mapping.Resolve(name)
				if err != nil {
					return err
				}
				uID, err := ensureUser(canonical)
				if err != nil {
					return err
				}
				chargeID := deriveID("looseKokCharge", slug, t.ID, canonical)
				if err := q.InsertMigratedMatchKokCharge(ctx, gen.InsertMigratedMatchKokChargeParams{
					ID: chargeID, ClubID: clubID, TournamentID: tID, MatchID: nil, UserID: uID,
					Amount: perPerson, ChargedOn: chargedOn,
				}); err != nil {
					return fmt.Errorf("bikin tagihan kok umum: %w", err)
				}
			}
			if rounding := domain.Rounding(perPerson, len(participants), total); rounding > 0 {
				if _, err := q.CreateExpense(ctx, gen.CreateExpenseParams{
					ClubID: clubID, Amount: -rounding, Note: textOrNilPg("pembulatan kok turnamen (migrasi v2)"),
				}); err != nil {
					return fmt.Errorf("catat pembulatan kok umum: %w", err)
				}
			}
		}
	}

	// --- Iuran: satu baris tetap per peserta (persis v2 t.Fees), amount
	// flat = t.Fee (§9 "iuran"). ---
	for _, f := range t.Fees {
		canonical, err := mapping.Resolve(f.Name)
		if err != nil {
			return err
		}
		uID, err := ensureUser(canonical)
		if err != nil {
			return err
		}
		var paidAt pgtype.Timestamptz
		var paidBy *uuid.UUID
		if f.Paid {
			if f.PaidAt != nil {
				d, err := parseDate(*f.PaidAt)
				if err == nil {
					paidAt = pgtype.Timestamptz{Time: d.Time, Valid: true}
				}
			}
			if !paidAt.Valid {
				paidAt = pgtype.Timestamptz{Time: t.UpdatedAt, Valid: true}
			}
			if f.PaidBy != nil {
				if canonicalPayer, ok := mapping[NormalizeName(*f.PaidBy)]; ok {
					id, err := ensureUser(canonicalPayer)
					if err != nil {
						return err
					}
					paidBy = &id
				}
			}
		}
		if err := q.UpsertMigratedTournamentFee(ctx, gen.UpsertMigratedTournamentFeeParams{
			TournamentID: tID, ClubID: clubID, UserID: uID, Amount: t.Fee, PaidAt: paidAt, PaidBy: paidBy,
		}); err != nil {
			return fmt.Errorf("bikin iuran turnamen %s pemain %q: %w", t.ID, f.Name, err)
		}
	}

	return nil
}
