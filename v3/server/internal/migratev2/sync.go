package migratev2

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// SyncOnce — SATU putaran sync HIDUP v2 -> v3 (cmd/sync-v2), dipanggil
// BERULANG selama v2 & v3 jalan bersamaan (Ryan minta ini, bukan
// freeze-v2-lalu-migrate-sekali dari rencana F10 asli — lihat catatan
// PLAN.md §14 F10). Beda mendasar dari Migrate (migrate.go):
//
//   - Nama v2 yang belum ada di berkas pemetaan TIDAK menggagalkan
//     seluruh putaran — cuma baris yang menyangkut nama itu yang
//     dilewati (SkippedForMapping), sisanya tetap tersync. Satu nama
//     baru/typo di v2 tidak boleh menghentikan sync buat semua orang.
//   - Game yang SUDAH pernah tersync boleh DITULIS ULANG kalau
//     v2.games.updated_at berubah (v2-induk terus jalan, orang tetap
//     menandai lunas belakangan di sana) — lihat UpsertSyncedGame dkk,
//     dijaga watermark di migratev2_sync_state.
//   - TIDAK ADA verifikasi-gagal-batalkan-semua seperti Migrate — ini
//     sistem hidup, data yang sudah kepakai orang tidak bisa ditarik
//     balik cuma karena satu putaran sync ketemu selisih. Rekonsiliasi
//     dihitung & DIKEMBALIKAN di Result buat caller (cmd/sync-v2) log,
//     bukan alasan rollback.
//   - Turnamen dititipkan ke migrateTournament yang SAMA dipakai
//     Migrate (sudah upsert-aman buat metadata/bagan/skor) — SATU
//     keterbatasan yang diwariskan dan sengaja TIDAK ditutup di sini:
//     status lunas iuran & kok per-partai turnamen (tournament_fees,
//     match_kok_charges) masih ON CONFLICT DO NOTHING, jadi "ditandai
//     lunas belakangan" untuk turnamen BELUM ikut tersinkron ulang
//     (beda dari main harian, yang sudah). Cakupan v1 sync hidup fokus
//     ke domain yang paling sering berubah setelah tercatat: main
//     harian. Diketahui dan bukan bug diam-diam.
//
// TIDAK PERNAH menulis ke v2 (sama seperti Migrate — package ini
// read-only ke v2, lihat komentar types.go), dan TIDAK PERNAH
// mencerminkan balik apa pun yang dibuat langsung di v3 (dompet/deposit,
// main jumlah pemain bebas, taruhan barang, dst — fitur itu memang
// tidak punya representasi di skema v2 sama sekali).
type SyncResult struct {
	ClubID                uuid.UUID
	UsersUpserted         int
	KokTypesUpserted      int
	GamesInserted         int
	GamesUpdated          int
	GamesUnchanged        int
	ExpensesProcessed     int // baris diproses (append-only, ON CONFLICT DO NOTHING) — bukan hitungan "baru"
	WalletTopups          int // baris wallet_entry BARU ditulis buat delta carry (bukan jumlah orang)
	TournamentsSynced     int
	SkippedForMapping     []string // nama v2 yang belum ada di berkas pemetaan — baris terkait dilewati putaran ini
	SkippedInvalidGames   []string // v2 game.ID yang bukan ganda 4 orang terisi — dilewati, bukan menggagalkan putaran
	SkippedTournaments    []string // "nama turnamen: alasan" — turnamen yang gagal sync (biasanya nama peserta belum dipetakan)
	SkippedCarryDecreases []string // nama kanonik yang carry v2-nya TURUN — ledger v3 append-only tidak bisa menariknya otomatis, perlu keputusan manusia
}

// SyncOnce membaca SELURUH tabel v2 (sama seperti Migrate, reader.go
// tidak punya filter delta — wajar di skala klub kecil) tapi cuma
// MENULIS yang berubah, dibandingkan ke migratev2_sync_state.
func SyncOnce(ctx context.Context, r Reader, s *store.Store, mapping NameMapping, opts Options) (SyncResult, error) {
	players, err := r.Players(ctx)
	if err != nil {
		return SyncResult{}, err
	}
	carry, err := r.Carry(ctx)
	if err != nil {
		return SyncResult{}, err
	}
	kokTypes, err := r.KokTypes(ctx)
	if err != nil {
		return SyncResult{}, err
	}
	games, err := r.Games(ctx)
	if err != nil {
		return SyncResult{}, err
	}
	expenses, err := r.Expenses(ctx)
	if err != nil {
		return SyncResult{}, err
	}
	tournaments, err := r.Tournaments(ctx)
	if err != nil {
		return SyncResult{}, err
	}

	targetClubID, err := resolveClubID(ctx, s, opts.ClubSlug)
	if err != nil {
		return SyncResult{}, err
	}

	var result SyncResult
	skippedNames := map[string]bool{}
	skipName := func(raw string) {
		n := NormalizeName(raw)
		if n == "" || skippedNames[n] {
			return
		}
		skippedNames[n] = true
		result.SkippedForMapping = append(result.SkippedForMapping, n)
	}

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
			result.UsersUpserted++
			return id, nil
		}
		// resolveOrSkip — beda dari mapping.Resolve murni: kegagalan di sini
		// TIDAK dikembalikan sebagai error yang membatalkan putaran, cuma
		// dicatat ke SkippedForMapping dan pemanggil melewati baris itu saja.
		resolveOrSkip := func(raw string) (string, bool) {
			canonical, err := mapping.Resolve(raw)
			if err != nil {
				skipName(raw)
				return "", false
			}
			return canonical, true
		}

		getState := func(key string) (string, bool, error) {
			v, err := q.GetSyncState(ctx, gen.GetSyncStateParams{ClubID: targetClubID, Key: key})
			if errors.Is(err, pgx.ErrNoRows) {
				return "", false, nil
			}
			if err != nil {
				return "", false, err
			}
			return v, true, nil
		}
		setState := func(key, value string) error {
			return q.UpsertSyncState(ctx, gen.UpsertSyncStateParams{ClubID: targetClubID, Key: key, Value: value})
		}

		for _, p := range players {
			canonical, ok := resolveOrSkip(p.Name)
			if !ok {
				continue
			}
			if _, err := ensureUser(canonical); err != nil {
				return err
			}
		}

		kokTypeV3 := map[string]uuid.UUID{}
		for _, k := range kokTypes {
			id := kokTypeID(opts.ClubSlug, k.ID)
			if _, err := q.UpsertMigratedKokType(ctx, gen.UpsertMigratedKokTypeParams{
				ID: id, ClubID: targetClubID, Name: k.Name, PricePerPerson: k.PricePerPerson,
				PricePerSlop: k.PricePerSlop, Stock: k.Stock, Active: k.Active,
			}); err != nil {
				return fmt.Errorf("bikin kok_type %q: %w", k.Name, err)
			}
			kokTypeV3[k.ID] = id
			result.KokTypesUpserted++
		}

		// --- Main harian: satu-satunya domain yang benar-benar ditulis
		// ULANG kalau v2 berubah (watermark games.updated_at) — lihat
		// komentar package di atas soal kenapa turnamen belum sedalam ini. ---
		for _, g := range games {
			filled := 0
			for _, p := range g.Players {
				if NormalizeName(p.Name) != "" {
					filled++
				}
			}
			if filled != 4 {
				result.SkippedInvalidGames = append(result.SkippedInvalidGames, g.ID)
				continue
			}

			stateKey := "game:updated_at:" + g.ID
			curWatermark := g.UpdatedAt.UTC().Format(time.RFC3339Nano)
			lastWatermark, found, err := getState(stateKey)
			if err != nil {
				return err
			}
			if found && lastWatermark == curWatermark {
				result.GamesUnchanged++
				continue
			}

			var filledPlayers []V2GamePlayer
			var unresolvedInGame bool
			for _, p := range g.Players {
				if NormalizeName(p.Name) == "" {
					continue
				}
				if _, ok := resolveOrSkip(p.Name); !ok {
					unresolvedInGame = true
					continue
				}
				filledPlayers = append(filledPlayers, p)
			}
			if unresolvedInGame {
				// game ini melibatkan nama yang belum dipetakan — lewati
				// SELURUH game (bukan sebagian pemainnya) supaya tagihan tidak
				// pernah tercatat parsial buat satu partai; ronde berikutnya
				// otomatis coba lagi begitu berkas pemetaan diperbarui (watermark
				// belum ditulis, jadi tidak dianggap "sudah tersync").
				continue
			}

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

			wasNew := !found
			if err := q.UpsertSyncedGame(ctx, gen.UpsertSyncedGameParams{
				ID: gID, ClubID: targetClubID, PlayedOn: playedOn, Notes: textOrNilPg(derefStr(g.Notes)),
				RecordedBy: recordedByID, RecordedByName: recordedByName,
				CreatedAt: pgtype.Timestamptz{Time: g.CreatedAt, Valid: true},
				UpdatedAt: pgtype.Timestamptz{Time: g.UpdatedAt, Valid: true},
			}); err != nil {
				return fmt.Errorf("sync game %s: %w", g.ID, err)
			}
			if wasNew {
				result.GamesInserted++
			} else {
				result.GamesUpdated++
			}

			perPerson := v2PerPersonCost(g.Koks)
			sides := []gen.GameSide{gen.GameSideA, gen.GameSideA, gen.GameSideB, gen.GameSideB}
			slots := []int16{1, 2, 1, 2}
			for i, p := range filledPlayers {
				canonical := mapping[NormalizeName(p.Name)] // sudah terverifikasi ada lewat resolveOrSkip di atas
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
				if err := q.UpsertSyncedGamePlayer(ctx, gen.UpsertSyncedGamePlayerParams{
					ID: gamePlayerID(opts.ClubSlug, g.ID, i), GameID: gID, ClubID: targetClubID,
					UserID: uID, Side: sides[i], Slot: slots[i], Amount: perPerson,
					PaidAt: paidAt, PaidBy: paidBy,
				}); err != nil {
					return fmt.Errorf("sync game_player game %s pemain %q: %w", g.ID, p.Name, err)
				}
			}

			for _, k := range g.Koks {
				var ktID *uuid.UUID
				if k.TypeID != nil {
					if v3id, ok := kokTypeV3[*k.TypeID]; ok {
						ktID = &v3id
					}
				}
				kokID := gameKokID(opts.ClubSlug, g.ID, kokIdentity(k))
				if err := q.UpsertSyncedGameKok(ctx, gen.UpsertSyncedGameKokParams{
					ID: kokID, GameID: gID, ClubID: targetClubID, KokTypeID: ktID,
					TypeName: textOrNilPg(derefStr(k.TypeName)), PricePerPerson: k.PricePerPerson,
				}); err != nil {
					return fmt.Errorf("sync game_kok game %s: %w", g.ID, err)
				}
			}

			if err := setState(stateKey, curWatermark); err != nil {
				return fmt.Errorf("simpan watermark game %s: %w", g.ID, err)
			}
		}

		// --- Pengeluaran: v2 tidak pernah mengedit baris lama (tidak ada
		// updated_at, types.go) — insert apa adanya, ON CONFLICT DO NOTHING
		// sudah cukup idempoten, tidak perlu watermark. ---
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
				return fmt.Errorf("sync expense %s: %w", e.ID, err)
			}
			result.ExpensesProcessed++
		}

		// --- Carry -> delta wallet_entries. carry DIGABUNG per nama
		// kanonik dulu (sama Migrate), lalu dibandingkan ke watermark
		// tersimpan supaya cuma SELISIHnya yang jadi baris ledger baru. ---
		carryByCanonical := map[string]int64{}
		for _, c := range carry {
			canonical, ok := resolveOrSkip(c.Name)
			if !ok {
				continue
			}
			carryByCanonical[canonical] += c.Carry
		}
		var canonicalCarryNames []string
		for name := range carryByCanonical {
			canonicalCarryNames = append(canonicalCarryNames, name)
		}
		sort.Strings(canonicalCarryNames)
		for _, canonical := range canonicalCarryNames {
			current := carryByCanonical[canonical]
			stateKey := "carry:" + canonical
			lastStr, found, err := getState(stateKey)
			if err != nil {
				return err
			}
			var last int64
			if found {
				last, err = strconv.ParseInt(lastStr, 10, 64)
				if err != nil {
					return fmt.Errorf("watermark carry %q rusak (%q): %w", canonical, lastStr, err)
				}
			}
			if current == last {
				continue
			}
			if current < last {
				// carry v2 TURUN (koreksi manual) — ledger v3 append-only tidak
				// bisa menariknya balik otomatis (§9.1 dompet tidak boleh
				// minus, dan ini bukan penarikan sungguhan yang disetujui
				// siapa pun). Perlu keputusan manusia (tarik dompet manual +
				// catatan), jadi CUMA dilaporkan, watermark TIDAK diperbarui —
				// tetap dilaporkan tiap putaran sampai ditangani.
				result.SkippedCarryDecreases = append(result.SkippedCarryDecreases,
					fmt.Sprintf("%s: v2=%d, tersync=%d", canonical, current, last))
				continue
			}
			if current <= 0 {
				continue // sama seperti Migrate: carry <=0 bukan deposit sungguhan
			}
			uID, err := ensureUser(canonical)
			if err != nil {
				return err
			}
			delta := current - last
			if err := q.InsertMigratedWalletEntry(ctx, gen.InsertMigratedWalletEntryParams{
				ID: walletEntryDeltaID(opts.ClubSlug, canonical, last, current), ClubID: targetClubID, UserID: uID, Amount: delta,
			}); err != nil {
				return fmt.Errorf("bikin wallet entry delta %q: %w", canonical, err)
			}
			result.WalletTopups++
			if err := setState(stateKey, strconv.FormatInt(current, 10)); err != nil {
				return fmt.Errorf("simpan watermark carry %q: %w", canonical, err)
			}
		}

		// --- Turnamen: dititipkan ke migrateTournament yang sudah
		// upsert-aman (Migrate juga memakainya) — DIBUNGKUS supaya satu
		// turnamen gagal (biasanya peserta belum dipetakan) tidak
		// menggagalkan seluruh putaran sync, beda dari Migrate yang
		// sengaja all-or-nothing. Watermark updated_at dipakai cuma buat
		// SKIP kerja kalau tidak ada perubahan — bukan syarat korektnes,
		// migrateTournament sendiri sudah idempoten. ---
		for _, t := range tournaments {
			stateKey := "tournament:updated_at:" + t.ID
			curWatermark := t.UpdatedAt.UTC().Format(time.RFC3339Nano)
			lastWatermark, found, err := getState(stateKey)
			if err != nil {
				return err
			}
			if found && lastWatermark == curWatermark {
				continue
			}
			if err := migrateTournament(ctx, q, targetClubID, opts.ClubSlug, t, mapping, kokTypeV3, ensureUser); err != nil {
				result.SkippedTournaments = append(result.SkippedTournaments, fmt.Sprintf("%s: %v", t.Name, err))
				continue
			}
			if err := setState(stateKey, curWatermark); err != nil {
				return fmt.Errorf("simpan watermark turnamen %s: %w", t.ID, err)
			}
			result.TournamentsSynced++
		}

		return nil
	})
	if err != nil {
		return SyncResult{}, err
	}
	sort.Strings(result.SkippedForMapping)
	return result, nil
}
