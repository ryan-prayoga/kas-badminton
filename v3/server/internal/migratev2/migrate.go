package migratev2

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/domain"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// Options — parameter satu jalan migrasi (cmd/migrate-v2/main.go flags).
type Options struct {
	ClubSlug string
	ClubName string
	Timezone string
	// AdminName — nama v2 (SETELAH dipetakan ke kanonik) yang dijadikan
	// admin klub. Kosong = tidak ada admin otomatis (operator harus
	// menaikkan peran manual lewat store, klub jadi tidak bisa
	// dioperasikan sampai itu terjadi — RequirePerm butuh admin buat
	// approve claim-request siapa pun, §7.3). Selalu isi ini di praktik.
	AdminName string
}

// Result — ringkasan buat ditampilkan cmd/migrate-v2 setelah sukses.
type Result struct {
	ClubID             uuid.UUID
	UsersCreated       int
	KokTypesCreated    int
	GamesCreated       int
	ExpensesCreated    int
	WalletTopups       int
	KasNet             int64 // sama di v2 & v3 — kalau beda, Migrate sudah gagal duluan
	TournamentsCreated int
	PartaiCount        int // partai turnamen berskor — sama di v2 & v3, lihat verifikasi
}

var ErrVerificationFailed = errors.New("migratev2: verifikasi gagal, transaksi dibatalkan")

// CollectNamesRequiringMapping — union nama yang MENANGGUNG UANG (pemain
// terdaftar, punya carry, atau tercatat main) — inilah yang wajib ada di
// berkas pemetaan sebelum Migrate mau jalan sama sekali (§14 F10 "tidak
// ada nama yang gagal dipetakan ke user"). recorded_by/paidBy SENGAJA
// TIDAK di sini — itu atribusi best-effort (games.recorded_by_name
// fallback teks, PLAN.md komentar F10), bukan identitas yang menanggung
// tagihan, jadi boleh tidak ketemu di mapping tanpa menggagalkan migrasi.
func CollectNamesRequiringMapping(players []V2Player, carry []V2Carry, games []V2Game, tournaments []V2Tournament) []string {
	var names []string
	for _, p := range players {
		names = append(names, p.Name)
	}
	for _, c := range carry {
		names = append(names, c.Name)
	}
	for _, g := range games {
		for _, p := range g.Players {
			if NormalizeName(p.Name) != "" {
				names = append(names, p.Name)
			}
		}
	}
	names = append(names, participantNamesRequiringMapping(tournaments)...)
	return names
}

// Migrate — SATU jalan, idempoten (id deterministik, ids.go), berhenti
// SEBELUM menulis apa pun kalau ada nama belum dipetakan atau game bukan
// ganda 4 orang, dan MEMBATALKAN seluruh transaksi kalau verifikasi akhir
// tidak cocok (§14 F10 "Verifikasi gagal = transaksi dibatalkan, bukan
// peringatan yang bisa diabaikan") — satu s.WithClub, verifikasi jalan
// SEBELUM closure balik nil, jadi kegagalannya otomatis rollback lewat
// mekanisme WithClub yang sudah ada (store/tenant.go), bukan logic
// rollback manual baru.
func Migrate(ctx context.Context, r Reader, s *store.Store, mapping NameMapping, opts Options) (Result, error) {
	players, err := r.Players(ctx)
	if err != nil {
		return Result{}, err
	}
	carry, err := r.Carry(ctx)
	if err != nil {
		return Result{}, err
	}
	kokTypes, err := r.KokTypes(ctx)
	if err != nil {
		return Result{}, err
	}
	games, err := r.Games(ctx)
	if err != nil {
		return Result{}, err
	}
	expenses, err := r.Expenses(ctx)
	if err != nil {
		return Result{}, err
	}
	tournaments, err := r.Tournaments(ctx)
	if err != nil {
		return Result{}, err
	}

	if missing := mapping.MissingNames(CollectNamesRequiringMapping(players, carry, games, tournaments)); len(missing) > 0 {
		return Result{}, fmt.Errorf("migratev2: nama belum ada di berkas pemetaan: %v — jalankan `migrate-v2 dedupe` dulu", missing)
	}

	for _, g := range games {
		filled := 0
		for _, p := range g.Players {
			if NormalizeName(p.Name) != "" {
				filled++
			}
		}
		if filled != 4 {
			return Result{}, fmt.Errorf("migratev2: game %s (tanggal %s) punya %d slot pemain terisi, F10 mensyaratkan tepat 4 (ganda) — perbaiki datanya di v2 dulu, migrasi ditolak sebelum menulis apa pun", g.ID, g.Date, filled)
		}
	}

	knownKokType := map[string]bool{}
	for _, k := range kokTypes {
		knownKokType[k.ID] = true
	}

	expectedTourCount, expectedPlayed, expectedFeeTotal, expectedKokPaidIncome, expectedRoundingKasIn := expectedTournamentStats(tournaments)
	// kas net v3 (SumPaidKokIncome, treasury.sql) SUDAH menggabung kok
	// main-harian DAN kok turnamen — expectedKasNet harus ikut
	// menggabung, atau verifikasi di bawah akan SELALU gagal untuk klub
	// yang punya turnamen (bukan bug migrasi, cuma definisi "kas" yang
	// beda kalau dihitung terpisah).
	expectedKasNet := expectedKasNetOf(games, expenses) + expectedKokPaidIncome + expectedRoundingKasIn
	expectedUnpaid := expectedUnpaidByCanonicalName(games, mapping)

	targetClubID, err := resolveClubID(ctx, s, opts.ClubSlug)
	if err != nil {
		return Result{}, err
	}

	var result Result
	err = s.WithClub(ctx, targetClubID, func(ctx context.Context, q *gen.Queries) error {
		if _, err := q.GetClub(ctx, targetClubID); errors.Is(err, pgx.ErrNoRows) {
			if _, err := q.CreateClub(ctx, gen.CreateClubParams{
				ID: targetClubID, Slug: opts.ClubSlug, Name: opts.ClubName, Timezone: opts.Timezone,
				Settings: migratedClubSettingsJSON(), Quotas: migratedClubQuotasJSON(),
			}); err != nil {
				return fmt.Errorf("bikin klub: %w", err)
			}
		} else if err != nil {
			return err
		}
		result.ClubID = targetClubID

		// --- Pengguna: SATU per nama kanonik (dedup sudah kejadian di
		// mapping — dua nama v2 beda yang dipetakan ke kanonik sama
		// otomatis jadi SATU user di sini, deriveID user pakai kanonik). ---
		canonicalSeen := map[string]uuid.UUID{}
		ensureUser := func(canonical string) (uuid.UUID, error) {
			if id, ok := canonicalSeen[canonical]; ok {
				return id, nil
			}
			id := userID(opts.ClubSlug, canonical)
			if _, err := q.UpsertMigratedUser(ctx, gen.UpsertMigratedUserParams{ID: id, DisplayName: canonical}); err != nil {
				return uuid.Nil, fmt.Errorf("bikin user %q: %w", canonical, err)
			}
			role := gen.ClubRoleMember
			if opts.AdminName != "" && canonical == NormalizeName(opts.AdminName) {
				role = gen.ClubRoleAdmin
			}
			if err := q.UpsertMigrationMembership(ctx, gen.UpsertMigrationMembershipParams{ClubID: targetClubID, UserID: id, Role: role}); err != nil {
				return uuid.Nil, fmt.Errorf("bikin membership %q: %w", canonical, err)
			}
			canonicalSeen[canonical] = id
			result.UsersCreated++
			return id, nil
		}

		for _, p := range players {
			canonical, err := mapping.Resolve(p.Name)
			if err != nil {
				return err
			}
			if _, err := ensureUser(canonical); err != nil {
				return err
			}
		}

		// --- Jenis kok ---
		kokTypeV3 := map[string]uuid.UUID{} // v2 kok_types.id -> v3 id
		for _, k := range kokTypes {
			id := kokTypeID(opts.ClubSlug, k.ID)
			if _, err := q.UpsertMigratedKokType(ctx, gen.UpsertMigratedKokTypeParams{
				ID: id, ClubID: targetClubID, Name: k.Name, PricePerPerson: k.PricePerPerson,
				PricePerSlop: k.PricePerSlop, Stock: k.Stock, Active: k.Active,
			}); err != nil {
				return fmt.Errorf("bikin kok_type %q: %w", k.Name, err)
			}
			kokTypeV3[k.ID] = id
			result.KokTypesCreated++
		}

		// --- Main harian: ganda 4 orang, TANPA skor (v2 tidak pernah
		// menyimpan itu — komentar types.go). Slot 0-1 = side a, 2-3 =
		// side b — v2 tidak menyimpan pasangan mana lawan mana, cuma
		// urutan array; pembagian ini POSISIONAL & deterministik
		// (idempoten), bukan rekonstruksi pasangan asli yang memang
		// tidak ada datanya. ---
		for _, g := range games {
			gID := gameID(opts.ClubSlug, g.ID)
			playedOn, err := parseDate(g.Date)
			if err != nil {
				return fmt.Errorf("tanggal game %s: %w", g.ID, err)
			}

			var recordedByID *uuid.UUID
			recordedByName := textOrNilPg("")
			if g.RecordedBy != nil && NormalizeName(*g.RecordedBy) != "" {
				if canonical, ok := mapping[NormalizeName(*g.RecordedBy)]; ok {
					id, err := ensureUser(canonical)
					if err != nil {
						return err
					}
					recordedByID = &id
				} else {
					recordedByName = textOrNilPg(NormalizeName(*g.RecordedBy))
				}
			}

			if err := q.InsertMigratedGame(ctx, gen.InsertMigratedGameParams{
				ID: gID, ClubID: targetClubID, PlayedOn: playedOn, Notes: textOrNilPg(derefStr(g.Notes)),
				RecordedBy: recordedByID, RecordedByName: recordedByName,
				CreatedAt: pgtype.Timestamptz{Time: g.CreatedAt, Valid: true},
			}); err != nil {
				return fmt.Errorf("bikin game %s: %w", g.ID, err)
			}
			result.GamesCreated++

			var filledPlayers []V2GamePlayer
			for _, p := range g.Players {
				if NormalizeName(p.Name) != "" {
					filledPlayers = append(filledPlayers, p)
				}
			}
			perPerson := v2PerPersonCost(g.Koks)
			sides := []gen.GameSide{gen.GameSideA, gen.GameSideA, gen.GameSideB, gen.GameSideB}
			slots := []int16{1, 2, 1, 2}
			for i, p := range filledPlayers {
				canonical, err := mapping.Resolve(p.Name)
				if err != nil {
					return err
				}
				uID, err := ensureUser(canonical)
				if err != nil {
					return err
				}
				var paidAt pgtype.Timestamptz
				var paidBy *uuid.UUID
				if p.Paid {
					if p.PaidAt != nil {
						paidAt = pgtype.Timestamptz{Time: *p.PaidAt, Valid: true}
					} else {
						// v2 punya paid=true tanpa paidAt tercatat (data
						// lama) — pakai created_at game itu sendiri
						// supaya tetap "lunas" di v3 (bukan default
						// NULL yang berarti belum bayar, itu akan
						// mengubah angka tagihan orangnya).
						paidAt = pgtype.Timestamptz{Time: g.CreatedAt, Valid: true}
					}
					if p.PaidBy != nil {
						if canonicalPayer, ok := mapping[NormalizeName(*p.PaidBy)]; ok {
							id, err := ensureUser(canonicalPayer)
							if err != nil {
								return err
							}
							paidBy = &id
						}
					}
				}
				if err := q.InsertMigratedGamePlayer(ctx, gen.InsertMigratedGamePlayerParams{
					ID: gamePlayerID(opts.ClubSlug, g.ID, i), GameID: gID, ClubID: targetClubID,
					UserID: uID, Side: sides[i], Slot: slots[i], Amount: perPerson,
					PaidAt: paidAt, PaidBy: paidBy,
				}); err != nil {
					return fmt.Errorf("bikin game_player game %s pemain %q: %w", g.ID, p.Name, err)
				}
			}

			for _, k := range g.Koks {
				var ktID *uuid.UUID
				if k.TypeID != nil {
					if v3id, ok := kokTypeV3[*k.TypeID]; ok && knownKokType[*k.TypeID] {
						ktID = &v3id
					}
				}
				kokID := gameKokID(opts.ClubSlug, g.ID, kokIdentity(k))
				if err := q.InsertMigratedGameKok(ctx, gen.InsertMigratedGameKokParams{
					ID: kokID, GameID: gID, ClubID: targetClubID, KokTypeID: ktID,
					TypeName: textOrNilPg(derefStr(k.TypeName)), PricePerPerson: k.PricePerPerson,
				}); err != nil {
					return fmt.Errorf("bikin game_kok game %s: %w", g.ID, err)
				}
			}
		}

		// --- Pengeluaran. Tidak ada recorded_by di v2 buat ini sama
		// sekali (komentar types.go) — selalu NULL, bukan keterbatasan
		// migrasi. ---
		for _, e := range expenses {
			var ktID *uuid.UUID
			if e.TypeID != nil {
				if v3id, ok := kokTypeV3[*e.TypeID]; ok {
					ktID = &v3id
				}
			}
			if err := q.InsertMigratedExpense(ctx, gen.InsertMigratedExpenseParams{
				ID: expenseID(opts.ClubSlug, e.ID), ClubID: targetClubID, Amount: e.Amount,
				KokTypeID: ktID, TypeName: textOrNilPg(derefStr(e.TypeName)),
				CreatedAt: pgtype.Timestamptz{Time: e.CreatedAt, Valid: true},
			}); err != nil {
				return fmt.Errorf("bikin expense %s: %w", e.ID, err)
			}
			result.ExpensesCreated++
		}

		// --- Carry → dompet awal, DIGABUNG per nama kanonik (dua nama
		// v2 yang dipetakan ke satu orang, masing-masing punya carry,
		// dijumlah — bukan salah satu ditimpa diam-diam). ---
		carryByCanonical := map[string]int64{}
		for _, c := range carry {
			canonical, err := mapping.Resolve(c.Name)
			if err != nil {
				return err
			}
			carryByCanonical[canonical] += c.Carry
		}
		var canonicalCarryNames []string
		for name := range carryByCanonical {
			canonicalCarryNames = append(canonicalCarryNames, name)
		}
		sort.Strings(canonicalCarryNames)
		for _, canonical := range canonicalCarryNames {
			amount := carryByCanonical[canonical]
			if amount <= 0 {
				continue // §9.1 dompet tidak boleh minus; carry <=0 bukan deposit sungguhan
			}
			uID, err := ensureUser(canonical)
			if err != nil {
				return err
			}
			if err := q.InsertMigratedWalletEntry(ctx, gen.InsertMigratedWalletEntryParams{
				ID: walletEntryID(opts.ClubSlug, canonical), ClubID: targetClubID, UserID: uID, Amount: amount,
			}); err != nil {
				return fmt.Errorf("bikin wallet entry %q: %w", canonical, err)
			}
			result.WalletTopups++
		}

		// --- Turnamen: bagan/klasemen/kok/iuran, lihat tournament.go. Di
		// dalam closure yang SAMA — turnamen yang gagal verifikasi di
		// bawah membatalkan SELURUH migrasi (termasuk main harian), bukan
		// cuma turnamen itu sendiri (§14 F10 "verifikasi gagal = transaksi
		// dibatalkan", bukan per-entitas). ---
		for _, t := range tournaments {
			if err := migrateTournament(ctx, q, targetClubID, opts.ClubSlug, t, mapping, kokTypeV3, ensureUser); err != nil {
				return fmt.Errorf("turnamen %q (%s): %w", t.Name, t.ID, err)
			}
			result.TournamentsCreated++
		}

		// --- Verifikasi (§14 F10 "Verifikasi gagal = transaksi
		// dibatalkan"). Semuanya dihitung ULANG dari sisi v3 lewat query
		// yang SAMA dipakai endpoint produksi (treasury.go,
		// games.sql SumUnpaidByPayer) — bukan menghitung ulang dgn cara
		// lain yang kebetulan bisa saja sama-sama salah. ---
		income, err := q.SumPaidKokIncome(ctx, targetClubID)
		if err != nil {
			return err
		}
		expenseTotal, err := q.SumExpenses(ctx, targetClubID)
		if err != nil {
			return err
		}
		kasNet := income - expenseTotal
		if kasNet != expectedKasNet {
			return fmt.Errorf("%w: kas net v3 = %d, mau %d (hitungan sisi v2)", ErrVerificationFailed, kasNet, expectedKasNet)
		}
		result.KasNet = kasNet

		gameCount, err := q.CountMigratedGames(ctx, targetClubID)
		if err != nil {
			return err
		}
		if int(gameCount) != len(games) {
			return fmt.Errorf("%w: jumlah game v3 = %d, mau %d", ErrVerificationFailed, gameCount, len(games))
		}

		unpaidRows, err := q.SumUnpaidByPayerAllUsers(ctx, targetClubID)
		if err != nil {
			return err
		}
		v3Unpaid := map[string]int64{}
		reverseUser := map[uuid.UUID]string{}
		for canonical, id := range canonicalSeen {
			reverseUser[id] = canonical
		}
		for _, row := range unpaidRows {
			canonical, ok := reverseUser[row.PayerID]
			if !ok {
				return fmt.Errorf("%w: ada payer_id di v3 yang tidak dikenal dari sisi migrasi ini", ErrVerificationFailed)
			}
			v3Unpaid[canonical] = row.Total
		}
		var mismatches []string
		for name, want := range expectedUnpaid {
			if v3Unpaid[name] != want {
				mismatches = append(mismatches, fmt.Sprintf("%s: v3=%d v2=%d", name, v3Unpaid[name], want))
			}
		}
		for name, got := range v3Unpaid {
			if _, ok := expectedUnpaid[name]; !ok && got != 0 {
				mismatches = append(mismatches, fmt.Sprintf("%s: v3=%d v2=0", name, got))
			}
		}
		if len(mismatches) > 0 {
			sort.Strings(mismatches)
			return fmt.Errorf("%w: piutang per orang tidak cocok: %v", ErrVerificationFailed, mismatches)
		}

		// --- Verifikasi turnamen (§14 F10 "jumlah game DAN PARTAI
		// cocok"). expectedTourCount/expectedPlayed/expectedFeeTotal
		// dihitung SEKALI di atas (sebelum WithClub, expectedTournamentStats)
		// dari domain.EnrichTournament langsung atas data v2 mentah —
		// jalur independen dari migrateTournament (yang menulis), bukan
		// membenarkan diri sendiri. ---
		tourCount, err := q.CountMigratedTournaments(ctx, targetClubID)
		if err != nil {
			return err
		}
		if int(tourCount) != expectedTourCount {
			return fmt.Errorf("%w: jumlah turnamen v3 = %d, mau %d", ErrVerificationFailed, tourCount, expectedTourCount)
		}
		var playedTotal, feeTotal int64
		for _, t := range tournaments {
			tID := tournamentID(opts.ClubSlug, t.ID)
			played, err := q.CountMigratedPlayedMatches(ctx, tID)
			if err != nil {
				return err
			}
			playedTotal += played
			fees, err := q.SumTournamentFees(ctx, tID)
			if err != nil {
				return err
			}
			feeTotal += fees
		}
		if int(playedTotal) != expectedPlayed {
			return fmt.Errorf("%w: jumlah partai (berskor) v3 = %d, mau %d", ErrVerificationFailed, playedTotal, expectedPlayed)
		}
		if feeTotal != expectedFeeTotal {
			return fmt.Errorf("%w: total iuran turnamen v3 = %d, mau %d", ErrVerificationFailed, feeTotal, expectedFeeTotal)
		}
		result.PartaiCount = int(playedTotal)

		return nil
	})
	if err != nil {
		return Result{}, err
	}
	return result, nil
}

// resolveClubID — idempotensi klub itu sendiri: kalau slug SUDAH ada
// (migrasi sebelumnya, atau kebetulan ada klub sungguhan pakai slug
// sama), pakai id yang SUDAH ADA — jangan pernah bikin klub kedua buat
// slug yang sama (UNIQUE constraint bakal menolaknya juga, tapi lebih
// baik ketahuan di sini dengan pesan yang jelas). Baru kalau belum ada
// sama sekali, id-nya deterministik dari slug (clubID, ids.go).
func resolveClubID(ctx context.Context, s *store.Store, slug string) (uuid.UUID, error) {
	var id uuid.UUID
	found := false
	err := s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		c, err := q.GetClubBySlug(ctx, slug)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		id = c.ID
		found = true
		return nil
	})
	if err != nil {
		return uuid.Nil, err
	}
	if found {
		return id, nil
	}
	return clubID(slug), nil
}

// migratedClubSettingsJSON — sama bawaan defaultSettingsJSON
// (internal/http/clubs.go), diduplikasi sengaja: migratev2 TIDAK
// mengimpor internal/http (itu package HTTP layer, migratev2 murni
// domain+store — mengimpornya buat satu literal JSON bukan pertukaran
// yang sepadan dengan coupling-nya).
func migratedClubSettingsJSON() []byte {
	return []byte(`{"siapa_boleh_catat":"semua_anggota","wajib_verifikasi":false,"halaman_publik":false,"transparansi_kas":true,"harga_default":0,"format_main_default":"ganda","tunggakan_hari":14,"tunggakan_minimal":50000,"tunggakan_jeda_hari":7,"pengingat_wa":false,"papan_peringkat":true,"taruhan_barang":true}`)
}

// migratedClubQuotasJSON — sama bawaan defaultQuotasJSON (internal/http/admin.go).
func migratedClubQuotasJSON() []byte {
	return []byte(`{"foto_max_mb":8,"anggota_per_klub":500,"poster_aktif":10,"wa_pesan_per_hari":50}`)
}

// v2PerPersonCost — SENGAJA BUKAN domain.GameCostOf (internal/domain,
// dipakai jalur tulis-baru v3). v2 tidak pernah membulatkan (§9.5 aturan
// A "dibulatkan ke atas ke ratusan" itu KEPUTUSAN BARU v3, beda sengaja
// dari v2 — komentar internal/domain/types.go poin 2) dan pricePerPerson
// v2 SUDAH berarti "tagihan tiap satu dari 4 orang", bukan harga total
// yang perlu dibagi. Migrasi WAJIB reproduksi angka HISTORIS v2 apa
// adanya — lewat GameCostOf di sini nilainya bisa naik sedikit (bulat ke
// atas) dan verifikasi kas net akan gagal untuk harga yang bukan
// kelipatan 100 bersih.
func v2PerPersonCost(koks []V2GameKok) int64 {
	var sum int64
	for _, k := range koks {
		sum += k.PricePerPerson
	}
	return sum
}

func kokIdentity(k V2GameKok) string {
	// v2 Kok.id (JSON) tidak dibaca reader.go (tidak perlu buat apa pun
	// SELAIN identitas stabil di sini) — dibentuk dari isi kok itu
	// sendiri. Cukup buat idempotensi SELAMA urutan koks[] tidak berubah
	// antar-baca, yang memang tidak berubah (JSON tersimpan statis).
	tid := ""
	if k.TypeID != nil {
		tid = *k.TypeID
	}
	return fmt.Sprintf("%s:%d", tid, k.PricePerPerson)
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func textOrNilPg(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

func parseDate(s string) (pgtype.Date, error) {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return pgtype.Date{}, err
	}
	return pgtype.Date{Time: t, Valid: true}, nil
}

// expectedKasNetOf — port RINGKAS lib/domain/summary.ts summarize() (v2):
// paid = total game yang SUDAH lunas (jumlah per-pemain yang paid=true)
// + expense. Kok turnamen yang lunas TIDAK dihitung di sini — itu
// ditambahkan terpisah oleh pemanggil (Migrate) lewat
// expectedTournamentStats, supaya dua sumber uang (main harian vs
// turnamen) tetap bisa diuji sendiri-sendiri sebelum digabung.
func expectedKasNetOf(games []V2Game, expenses []V2Expense) int64 {
	var paid, expense int64
	for _, g := range games {
		perPerson := v2PerPersonCost(g.Koks)
		for _, p := range g.Players {
			if p.Paid && NormalizeName(p.Name) != "" {
				paid += perPerson
			}
		}
	}
	for _, e := range expenses {
		expense += e.Amount
	}
	return paid - expense
}

// expectedUnpaidByCanonicalName — total BELUM lunas per orang, sisi v2,
// dikunci ke nama KANONIK (dua alias v2 yang sama orang otomatis
// dijumlah jadi satu figur) — inilah yang dibandingkan ke
// SumUnpaidByPayerAllUsers sisi v3 (games.sql pola SumUnpaidByPayer).
// expectedTournamentStats — jalur INDEPENDEN dari migrateTournament
// (tournament.go) buat verifikasi (§14 F10 "jumlah game dan partai
// cocok") — sama-sama memanggil domain.EnrichTournament (satu-satunya
// sumber kebenaran bagan, tidak ada rumus kedua yang bisa diam-diam
// beda), tapi TIDAK menulis apa pun, cuma menghitung dari data v2
// mentah. count = jumlah turnamen, played = total partai berskor lintas
// semua turnamen, feeTotal = total iuran (lunas+belum) lintas semua
// turnamen — langsung dari Cost.FeeTotal yang sudah dihitung
// domain.TournamentCostOf, bukan dijumlah manual di sini.
//
// kokPaidIncome — total match_kok_charges yang LUNAS lintas semua
// turnamen, langsung dari Cost.KokPaid (domain, matchesKokPaid) — ini
// bagian dari kas v3 (SumPaidKokIncome, treasury.sql: "kok yang dibeli
// di sela partai turnamen" ikut dihitung), jadi WAJIB masuk expectedKasNet
// di Migrate juga, bukan cuma dihitung di sini buat gagah-gagahan.
//
// roundingKasIn — kelebihan pembulatan kok UMUM (matchId null) yang v3
// catat sebagai kas masuk SEKETIKA (migrateTournament, sama aturan jalur
// HTTP produksi addTournamentKok) — TIDAK PERNAH ada di v2 (v2 tidak
// pernah menagih kok umum sama sekali, jadi tidak ada rupiah yang bisa
// dibandingkan dari sana; angka ini murni konsekuensi migrasi menutup
// lubang itu, dihitung ulang di sini dgn domain.PerPersonCost/Rounding
// yang SAMA dipakai migrateTournament — independen, bukan membenarkan
// diri sendiri, cuma rumusnya memang cuma satu yang benar).
func expectedTournamentStats(tournaments []V2Tournament) (count, played int, feeTotal, kokPaidIncome, roundingKasIn int64) {
	for _, t := range tournaments {
		stored := toDomainStoredTournament(t)
		enriched := domain.EnrichTournament(stored) // struktur bagan/klasemen SAJA — lihat catatan di bawah kenapa Cost.KokPaid tidak dipakai
		count++
		played += enriched.PlayedCount
		feeTotal += enriched.Cost.FeeTotal

		// kokPaidIncome DIHITUNG SENDIRI di sini, BUKAN enriched.Cost.KokPaid
		// — domain.MatchKokPerPerson (dipakai Cost.KokPaid) mengasumsikan
		// Kok.Price itu HARGA TOTAL yang dibagi 4 pakai PerPersonCost
		// (komentar tournament.go baris 5-7: "Kok per-partai dibagi 4...
		// pakai rumus pembulatan yang sama §9.5 A") — semantik BARU v3.
		// v2 pricePerPerson SUDAH per-orang (migrate.go v2PerPersonCost,
		// alasan sama persis kenapa main harian juga tidak lewat
		// domain.GameCostOf). migrateTournament (tournament.go) menjumlah
		// pricePerPerson v2 APA ADANYA buat tiap partai — baris di bawah
		// mereplikasi ITU, bukan rumus domain, supaya benar-benar jadi
		// verifikasi independen dari apa yang sungguh ditulis.
		koksByMatch := map[string]int64{}
		for _, k := range t.Koks {
			if k.MatchID != nil && *k.MatchID != "" {
				koksByMatch[*k.MatchID] += k.PricePerPerson
			}
		}
		for matchID, perPerson := range koksByMatch {
			paid, ok := stored.MatchKokPaid[matchID]
			if !ok {
				continue
			}
			var match *domain.BracketMatch
			for i := range enriched.Matches {
				if enriched.Matches[i].ID == matchID {
					match = &enriched.Matches[i]
					break
				}
			}
			if match == nil || match.A.Bye || match.B.Bye {
				continue
			}
			names := domain.MatchParticipants(*match)
			for i, name := range names {
				if name != "" && paid[i] {
					kokPaidIncome += perPerson
				}
			}
		}

		var looseTotal int64
		for _, k := range t.Koks {
			if k.MatchID == nil || *k.MatchID == "" {
				looseTotal += k.PricePerPerson * 4 // domain.KoksTotal: harga per kok = pricePerPerson × 4
			}
		}
		if looseTotal <= 0 {
			continue
		}
		participants := domain.ParticipantNames(stored.Pairs)
		if len(participants) == 0 {
			continue
		}
		perPerson := domain.PerPersonCost(looseTotal, len(participants))
		roundingKasIn += domain.Rounding(perPerson, len(participants), looseTotal)
	}
	return
}

func expectedUnpaidByCanonicalName(games []V2Game, mapping NameMapping) map[string]int64 {
	out := map[string]int64{}
	for _, g := range games {
		perPerson := v2PerPersonCost(g.Koks)
		for _, p := range g.Players {
			if p.Paid || NormalizeName(p.Name) == "" {
				continue
			}
			canonical := mapping[NormalizeName(p.Name)]
			out[canonical] += perPerson
		}
	}
	return out
}
