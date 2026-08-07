package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/domain"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/perm"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/realtime"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

const defaultGamesLimit = 30

// undoWindow — jendela "batalkan cepat" (§9.4). Lewat ini, koreksi lewat
// edit/hapus biasa (jurnal audit normal), bukan hard-delete diam-diam.
const undoWindow = 8 * time.Second

// --- request body ---

type createGamePlayerRequest struct {
	UserID  string  `json:"user_id"`
	Side    string  `json:"side"`
	Slot    int16   `json:"slot"`
	PayerID *string `json:"payer_id"`
}

type createGameKokRequest struct {
	KokTypeID      *string `json:"kok_type_id"`
	TypeName       *string `json:"type_name"`
	PricePerPerson *int64  `json:"price_per_person"`
	Qty            int32   `json:"qty"`
}

type createGameSetRequest struct {
	A int16 `json:"a"`
	B int16 `json:"b"`
}

type createGameScoreRequest struct {
	Format string                 `json:"format"`
	Games  []createGameSetRequest `json:"games"`
}

type createGameRequest struct {
	PlayedOn string                    `json:"played_on"`
	Format   string                    `json:"format"`
	Notes    string                    `json:"notes"`
	Players  []createGamePlayerRequest `json:"players"`
	Koks     []createGameKokRequest    `json:"koks"`
	// Score OPSIONAL (§8.3) — dihilangkan sepenuhnya kalau main tidak
	// dicatat skornya, supaya mencatat main tanpa skor tetap secepat v2.
	Score *createGameScoreRequest `json:"score"`
}

// handleCreateGame — POST /clubs/{clubId}/games (API.md §3). Biaya
// dihitung SERVER lewat domain.GameCostOf (F1) — klien cuma mengirim
// pemain & kok, tidak pernah amount per orang, supaya dua HP versi
// berbeda tidak bisa menghasilkan tagihan berbeda untuk main yang sama.
func handleCreateGame(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())
		clubID, _ := clubIDFromContext(r.Context())

		var req createGameRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		if req.Format == "" {
			req.Format = "ganda"
		}
		playedOn, err := parseDate(req.PlayedOn)
		if err != nil {
			writeError(w, CodeValidationFailed, "Tanggal main belum diisi atau formatnya salah (YYYY-MM-DD).", nil)
			return
		}
		if len(req.Players) == 0 {
			writeError(w, CodeValidationFailed, "Main butuh minimal satu pemain.", nil)
			return
		}

		type resolvedPlayer struct {
			userID, payerID uuid.UUID
			side            gen.GameSide
			slot            int16
		}
		players := make([]resolvedPlayer, 0, len(req.Players))
		for _, p := range req.Players {
			uid, err := uuid.Parse(p.UserID)
			if err != nil {
				writeError(w, CodeValidationFailed, "user_id pemain tidak valid.", nil)
				return
			}
			payerID := uid
			if p.PayerID != nil && *p.PayerID != "" {
				payerID, err = uuid.Parse(*p.PayerID)
				if err != nil {
					writeError(w, CodeValidationFailed, "payer_id pemain tidak valid.", nil)
					return
				}
			}
			if p.Side != "a" && p.Side != "b" {
				writeError(w, CodeValidationFailed, "side pemain harus 'a' atau 'b'.", nil)
				return
			}
			players = append(players, resolvedPlayer{userID: uid, payerID: payerID, side: gen.GameSide(p.Side), slot: p.Slot})
		}

		// Skor OPSIONAL (§8.3) — dihitung & divalidasi SEBELUM transaksi
		// (murni, tidak butuh DB), sama alasan biaya dihitung server:
		// winner_side tidak boleh beda antara dua HP yang mencatat main
		// yang sama.
		var scoreFormat gen.NullScoreFormat
		var winnerSide gen.NullGameSide
		var scoreSets []gen.CreateGameScoreParams // GameID diisi belakangan, sudah tahu ID-nya
		if req.Score != nil {
			sets := make([]domain.GameSetScore, 0, len(req.Score.Games))
			for _, g := range req.Score.Games {
				sets = append(sets, domain.GameSetScore{A: int(g.A), B: int(g.B)})
			}
			winner, err := domain.GameWinnerSide(domain.GameScoreFormat(req.Score.Format), sets)
			if err != nil {
				writeError(w, CodeValidationFailed, "Skor tidak valid: "+err.Error(), nil)
				return
			}
			scoreFormat = gen.NullScoreFormat{ScoreFormat: gen.ScoreFormat(req.Score.Format), Valid: true}
			winnerSide = gen.NullGameSide{GameSide: gen.GameSide(winner), Valid: true}
			for i, g := range req.Score.Games {
				scoreSets = append(scoreSets, gen.CreateGameScoreParams{GameNo: int16(i + 1), ScoreA: g.A, ScoreB: g.B})
			}
		}

		var game gen.Game
		var savedPlayers []gen.GamePlayer
		var savedKoks []gen.GameKok
		var savedScores []gen.GameScore
		var billTotals map[uuid.UUID]int64

		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			// Resolusi kok: kok_type_id → snapshot dari katalog, atau
			// ad-hoc (type_name+price_per_person langsung dari klien)
			// kalau tidak ada di katalog (§8 "harga dikunci di dalam
			// game").
			domainKoks := make([]domain.Kok, 0, len(req.Koks))
			type resolvedKok struct {
				kokTypeID      *uuid.UUID
				typeName       string
				pricePerPerson int64
				qty            int32
			}
			resolvedKoks := make([]resolvedKok, 0, len(req.Koks))
			for _, k := range req.Koks {
				rk := resolvedKok{qty: k.Qty}
				if rk.qty <= 0 {
					rk.qty = 1
				}
				if k.KokTypeID != nil && *k.KokTypeID != "" {
					id, err := uuid.Parse(*k.KokTypeID)
					if err != nil {
						return errValidation("kok_type_id tidak valid.")
					}
					kt, err := q.GetKokType(ctx, gen.GetKokTypeParams{ID: id, ClubID: clubID})
					if err != nil {
						return errValidation("Jenis kok tidak ditemukan di klub ini.")
					}
					rk.kokTypeID = &id
					rk.typeName = kt.Name
					rk.pricePerPerson = kt.PricePerPerson
				} else {
					if k.TypeName == nil || k.PricePerPerson == nil {
						return errValidation("Kok tanpa kok_type_id wajib mengisi type_name dan price_per_person.")
					}
					rk.typeName = *k.TypeName
					rk.pricePerPerson = *k.PricePerPerson
				}
				resolvedKoks = append(resolvedKoks, rk)
				domainKoks = append(domainKoks, domain.Kok{Price: rk.pricePerPerson * int64(rk.qty)})
			}

			cost := domain.GameCostOf(domainKoks, len(players))

			g, err := q.CreateGame(ctx, gen.CreateGameParams{
				ClubID:      clubID,
				PlayedOn:    playedOn,
				Format:      gen.GameFormat(req.Format),
				Notes:       textOf(req.Notes),
				ScoreFormat: scoreFormat,
				WinnerSide:  winnerSide,
				RecordedBy:  &userID,
			})
			if err != nil {
				return err
			}
			game = g

			for _, set := range scoreSets {
				set.GameID = game.ID
				gs, err := q.CreateGameScore(ctx, set)
				if err != nil {
					return err
				}
				savedScores = append(savedScores, gs)
			}

			for _, k := range resolvedKoks {
				gk, err := q.CreateGameKok(ctx, gen.CreateGameKokParams{
					GameID:         game.ID,
					ClubID:         clubID,
					KokTypeID:      k.kokTypeID,
					TypeName:       textOf(k.typeName),
					PricePerPerson: k.pricePerPerson,
					Qty:            k.qty,
				})
				if err != nil {
					return err
				}
				savedKoks = append(savedKoks, gk)
			}

			billTotals = map[uuid.UUID]int64{}
			for _, p := range players {
				gp, err := q.CreateGamePlayer(ctx, gen.CreateGamePlayerParams{
					GameID:  game.ID,
					ClubID:  clubID,
					UserID:  p.userID,
					PayerID: p.payerID,
					Side:    p.side,
					Slot:    p.slot,
					Amount:  cost.PerPerson,
				})
				if err != nil {
					return err
				}
				savedPlayers = append(savedPlayers, gp)
				billTotals[p.payerID] = 0 // diisi di bawah lewat SumUnpaidByPayer
			}

			// Kelebihan pembulatan masuk kas, dicatat eksplisit — bukan
			// menyatu diam-diam ke total (§9.5 aturan A).
			if cost.Rounding > 0 {
				if _, err := q.CreateExpense(ctx, gen.CreateExpenseParams{
					ClubID:     clubID,
					Amount:     -cost.Rounding,
					Note:       textOf("pembulatan"),
					RecordedBy: &userID,
					GameID:     &game.ID,
				}); err != nil {
					return err
				}
			}

			for payerID := range billTotals {
				total, err := q.SumUnpaidByPayer(ctx, gen.SumUnpaidByPayerParams{ClubID: clubID, PayerID: payerID})
				if err != nil {
					return err
				}
				billTotals[payerID] = total
			}

			dto := newGameDTO(game)
			for _, p := range savedPlayers {
				dto.Players = append(dto.Players, newGamePlayerDTO(p))
			}
			for _, k := range savedKoks {
				dto.Koks = append(dto.Koks, newGameKokDTO(k))
			}
			for _, sc := range savedScores {
				dto.Score = append(dto.Score, newGameScoreDTO(sc))
			}
			if err := realtime.Publish(ctx, q, realtime.NewEvent(realtime.KindGameCreated, clubID, dto)); err != nil {
				return err
			}
			for payerID, total := range billTotals {
				billData := map[string]any{"club_id": clubID, "user_id": payerID, "total_owed": total}
				if err := realtime.Publish(ctx, q, realtime.NewEvent(realtime.KindBillUpdated, clubID, billData)); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			var ve *validationErr
			if errors.As(err, &ve) {
				writeError(w, CodeValidationFailed, ve.msg, nil)
				return
			}
			writeError(w, CodeValidationFailed, "Gagal mencatat main.", nil)
			return
		}

		dto := newGameDTO(game)
		for _, p := range savedPlayers {
			dto.Players = append(dto.Players, newGamePlayerDTO(p))
		}
		for _, k := range savedKoks {
			dto.Koks = append(dto.Koks, newGameKokDTO(k))
		}
		for _, sc := range savedScores {
			dto.Score = append(dto.Score, newGameScoreDTO(sc))
		}
		writeJSON(w, http.StatusCreated, dto)
	}
}

// handleListGames — GET /clubs/{clubId}/games?before=&limit= (cursor per
// tanggal, API.md §0/§3).
func handleListGames(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())

		limit := defaultGamesLimit
		if v := r.URL.Query().Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
				limit = n
			}
		}
		var before pgtype.Date
		if v := r.URL.Query().Get("before"); v != "" {
			d, err := parseDate(v)
			if err != nil {
				writeError(w, CodeValidationFailed, "Parameter before harus YYYY-MM-DD.", nil)
				return
			}
			before = d
		}

		var games []gen.Game
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			games, err = q.ListGamesByClub(ctx, gen.ListGamesByClubParams{
				ClubID: clubID,
				Limit:  int32(limit),
				Before: before,
			})
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil daftar main.", nil)
			return
		}

		items := make([]gameDTO, 0, len(games))
		for _, g := range games {
			items = append(items, newGameDTO(g))
		}
		resp := map[string]any{"items": items}
		if len(games) == limit {
			resp["next_cursor"] = dateString(games[len(games)-1].PlayedOn)
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

// handleGetGame — GET /clubs/{clubId}/games/{id}.
func handleGetGame(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		gameID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Main tidak ditemukan.", nil)
			return
		}

		dto, err := loadGameDTO(r.Context(), s, clubID, gameID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				writeError(w, CodeNotFound, "Main tidak ditemukan.", nil)
				return
			}
			writeError(w, CodeValidationFailed, "Gagal mengambil data main.", nil)
			return
		}
		writeJSON(w, http.StatusOK, dto)
	}
}

func loadGameDTO(ctx context.Context, s *store.Store, clubID, gameID uuid.UUID) (gameDTO, error) {
	var dto gameDTO
	err := s.WithClub(ctx, clubID, func(ctx context.Context, q *gen.Queries) error {
		g, err := q.GetGame(ctx, gen.GetGameParams{ID: gameID, ClubID: clubID})
		if err != nil {
			return err
		}
		players, err := q.ListGamePlayersByGame(ctx, gameID)
		if err != nil {
			return err
		}
		koks, err := q.ListGameKoksByGame(ctx, gameID)
		if err != nil {
			return err
		}
		scores, err := q.ListGameScoresByGame(ctx, gameID)
		if err != nil {
			return err
		}
		dto = newGameDTO(g)
		for _, p := range players {
			dto.Players = append(dto.Players, newGamePlayerDTO(p))
		}
		for _, k := range koks {
			dto.Koks = append(dto.Koks, newGameKokDTO(k))
		}
		for _, sc := range scores {
			dto.Score = append(dto.Score, newGameScoreDTO(sc))
		}
		return nil
	})
	return dto, err
}

type updateGameRequest struct {
	Notes string `json:"notes"`
}

// handleUpdateGame — PATCH /clubs/{clubId}/games/{id}, If-Match version
// (invarian §3.4). F2 cuma dukung ubah catatan — cukup buat membuktikan
// pola versioning; ubah skor/kok/pemain menyusul di fase yang menyentuh
// alur itu.
func handleUpdateGame(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		gameID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Main tidak ditemukan.", nil)
			return
		}
		version, ok := requireIfMatch(r)
		if !ok {
			writeError(w, CodeValidationFailed, "Header If-Match: <version> wajib diisi.", nil)
			return
		}
		var req updateGameRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}

		var game gen.Game
		conflict := false
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			g, err := q.UpdateGame(ctx, gen.UpdateGameParams{
				ID: gameID, ClubID: clubID, Notes: textOf(req.Notes), Version: version,
			})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					conflict = true
					return nil
				}
				return err
			}
			game = g
			return realtime.Publish(ctx, q, realtime.NewEvent(realtime.KindGameUpdated, clubID, newGameDTO(g)))
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengubah main.", nil)
			return
		}
		if conflict {
			current, err := loadGameDTO(r.Context(), s, clubID, gameID)
			if err != nil {
				writeError(w, CodeNotFound, "Main tidak ditemukan.", nil)
				return
			}
			writeError(w, CodeVersionConflict, "Main ini sudah diubah orang lain. Cek versi terbaru dulu.", current)
			return
		}

		writeJSON(w, http.StatusOK, newGameDTO(game))
	}
}

// handleDeleteGame — DELETE /clubs/{clubId}/games/{id} (soft-delete).
func handleDeleteGame(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		gameID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Main tidak ditemukan.", nil)
			return
		}

		notFound := false
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			_, err := q.SoftDeleteGame(ctx, gen.SoftDeleteGameParams{ID: gameID, ClubID: clubID})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					notFound = true
					return nil
				}
				return err
			}
			return realtime.Publish(ctx, q, realtime.NewEvent(realtime.KindGameDeleted, clubID, map[string]any{"id": gameID}))
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal menghapus main.", nil)
			return
		}
		if notFound {
			writeError(w, CodeNotFound, "Main tidak ditemukan.", nil)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// handleUndoGame — POST /clubs/{clubId}/games/{id}/undo, jendela 8 detik
// (§9.4). Berbeda dari handleDeleteGame: ini HARD delete, hanya boleh yang
// mencatatnya, dan cuma dalam undoWindow — lewat itu jalurnya edit/hapus
// biasa. Bill payer yang tersentuh dihitung ulang SETELAH baris fisiknya
// hilang, di transaksi kedua (transaksi pertama sudah commit begitu
// HardDeleteGame sukses).
func handleUndoGame(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())
		clubID, _ := clubIDFromContext(r.Context())
		gameID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Main tidak ditemukan.", nil)
			return
		}

		var notFound, notRecorder, tooLate bool
		var payerIDs []uuid.UUID
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			g, err := q.GetGame(ctx, gen.GetGameParams{ID: gameID, ClubID: clubID})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					notFound = true
					return nil
				}
				return err
			}
			if g.RecordedBy == nil || *g.RecordedBy != userID {
				notRecorder = true
				return nil
			}
			if time.Since(tsOrZero(g.CreatedAt)) > undoWindow {
				tooLate = true
				return nil
			}
			players, err := q.ListGamePlayersByGame(ctx, gameID)
			if err != nil {
				return err
			}
			for _, p := range players {
				payerIDs = append(payerIDs, p.PayerID)
			}
			affected, err := q.HardDeleteGame(ctx, gen.HardDeleteGameParams{ID: gameID, ClubID: clubID, RecordedBy: &userID})
			if err != nil {
				return err
			}
			if affected == 0 {
				notFound = true
				return nil
			}
			return realtime.Publish(ctx, q, realtime.NewEvent(realtime.KindGameDeleted, clubID, map[string]any{"id": gameID}))
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal membatalkan main.", nil)
			return
		}
		if notFound {
			writeError(w, CodeNotFound, "Main tidak ditemukan.", nil)
			return
		}
		if notRecorder {
			writeError(w, CodeInsufficientPermission, "Cuma yang mencatat main ini yang bisa membatalkannya.", nil)
			return
		}
		if tooLate {
			writeError(w, CodeValidationFailed, "Jendela batalkan cepat (8 detik) sudah lewat. Koreksi lewat edit atau hapus biasa.", nil)
			return
		}

		// Payer bisa dobel kalau satu orang nanggung beberapa baris —
		// dedup biar event bill-updated tidak dikirim berkali-kali sia-sia.
		seen := map[uuid.UUID]bool{}
		_ = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			for _, payerID := range payerIDs {
				if seen[payerID] {
					continue
				}
				seen[payerID] = true
				total, err := q.SumUnpaidByPayer(ctx, gen.SumUnpaidByPayerParams{ClubID: clubID, PayerID: payerID})
				if err != nil {
					continue
				}
				billData := map[string]any{"club_id": clubID, "user_id": payerID, "total_owed": total}
				_ = realtime.Publish(ctx, q, realtime.NewEvent(realtime.KindBillUpdated, clubID, billData))
			}
			return nil
		})

		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// handleDisputeGamePlayer — POST .../games/{id}/players/{playerId}/dispute
// (§9.4 sanggahan). HAK PEMAIN (user_id) — playerId di path adalah user_id,
// BUKAN game_players.id, karena yang menyanggah adalah "orang yang namanya
// dicatat", dan game_players punya UNIQUE(game_id, user_id) jadi ini tetap
// satu baris yang jelas.
func handleDisputeGamePlayer(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		callerID, _ := userIDFromContext(r.Context())
		gameID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Main tidak ditemukan.", nil)
			return
		}
		playerUserID, err := uuid.Parse(chi.URLParam(r, "playerId"))
		if err != nil {
			writeError(w, CodeNotFound, "Pemain tidak ditemukan.", nil)
			return
		}
		if playerUserID != callerID {
			writeError(w, CodeInsufficientPermission, "Cuma orang yang dicatat sendiri yang bisa bilang 'saya tidak ikut'.", nil)
			return
		}
		var req struct {
			Note string `json:"note"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)

		var row gen.GamePlayer
		notFound := false
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			gp, err := q.DisputeGamePlayer(ctx, gen.DisputeGamePlayerParams{
				GameID: gameID, ClubID: clubID, UserID: playerUserID, DisputeNote: textOf(req.Note),
			})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					notFound = true
					return nil
				}
				return err
			}
			row = gp
			// Sanggahan menahan tagihan (§9.5 aturan D) — bill payer
			// berubah seketika, bukan nunggu potong-otomatis berikutnya.
			total, err := q.SumUnpaidByPayer(ctx, gen.SumUnpaidByPayerParams{ClubID: clubID, PayerID: gp.PayerID})
			if err != nil {
				return err
			}
			billData := map[string]any{"club_id": clubID, "user_id": gp.PayerID, "total_owed": total}
			return realtime.Publish(ctx, q, realtime.NewEvent(realtime.KindBillUpdated, clubID, billData))
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal menyanggah.", nil)
			return
		}
		if notFound {
			writeError(w, CodeNotFound, "Baris main untukmu tidak ditemukan, atau sudah disanggah.", nil)
			return
		}
		writeJSON(w, http.StatusOK, newGamePlayerDTO(row))
	}
}

// handleResolveGamePlayerDispute — POST .../resolve-dispute. "Pencatat/
// bendahara menyelesaikan" (API.md §3) — bukan RequirePerm murni karena
// pencatat (RecordGame) dan bendahara (ManageMoney) dua izin terpisah yang
// TIDAK saling menjatuhkan satu sama lain (perm.rolePermissions), jadi
// dicek manual, sama pola dgn handleUpdateAutoDeduct.
func handleResolveGamePlayerDispute(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		granted, _ := permFromContext(r.Context())
		if !granted[perm.RecordGame] && !granted[perm.ManageMoney] {
			writeError(w, CodeInsufficientPermission, "Cuma pencatat atau bendahara yang bisa menyelesaikan sanggahan.", nil)
			return
		}
		gameID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Main tidak ditemukan.", nil)
			return
		}
		playerUserID, err := uuid.Parse(chi.URLParam(r, "playerId"))
		if err != nil {
			writeError(w, CodeNotFound, "Pemain tidak ditemukan.", nil)
			return
		}

		var row gen.GamePlayer
		notFound := false
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			gp, err := q.ResolveGamePlayerDispute(ctx, gen.ResolveGamePlayerDisputeParams{
				GameID: gameID, ClubID: clubID, UserID: playerUserID,
			})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					notFound = true
					return nil
				}
				return err
			}
			row = gp
			total, err := q.SumUnpaidByPayer(ctx, gen.SumUnpaidByPayerParams{ClubID: clubID, PayerID: gp.PayerID})
			if err != nil {
				return err
			}
			billData := map[string]any{"club_id": clubID, "user_id": gp.PayerID, "total_owed": total}
			return realtime.Publish(ctx, q, realtime.NewEvent(realtime.KindBillUpdated, clubID, billData))
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal menyelesaikan sanggahan.", nil)
			return
		}
		if notFound {
			writeError(w, CodeNotFound, "Baris main ini tidak sedang disanggah.", nil)
			return
		}
		writeJSON(w, http.StatusOK, newGamePlayerDTO(row))
	}
}

// validationErr membawa pesan validasi dari dalam closure WithClub ke
// pemanggil di luar transaksi (Rollback otomatis lewat defer di
// store.WithClub kalau fn mengembalikan error apa pun).
type validationErr struct{ msg string }

func (e *validationErr) Error() string { return e.msg }

func errValidation(msg string) error { return &validationErr{msg: msg} }
