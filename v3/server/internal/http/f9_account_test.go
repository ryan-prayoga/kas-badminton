// Test F9/4 (PLAN.md §12, §12.2, §14 F9): ekspor & hapus akun sendiri.
// Pola sama f9_public_test.go — Postgres sungguhan.
package httpapi_test

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/testdb"
)

func TestAccount_Export_IncludesOwnDataOnly(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	phone := randPhone()
	admin := otpLogin(t, base, notifier, phone)
	club := createClub(t, base, admin.token, randSlug())
	other := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, other.userID, gen.ClubRoleMember)

	// admin main + tagihan sendiri; other juga main — export admin TIDAK
	// boleh menyebut apa pun milik other.
	createGameWithBody(t, base, admin.token, club, gameBodyWithKok(admin.userID, 15000))
	createGameWithBody(t, base, other.token, club, gameBodyWithKok(other.userID, 9000))

	resp := authedRequest(t, http.MethodGet, base+"/api/v1/me/export", admin.token, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		dumpAndFail(t, resp, "GET /me/export")
	}
	var got struct {
		UserID string `json:"user_id"`
		Phone  string `json:"phone"`
		Clubs  []struct {
			ClubSlug string `json:"club_slug"`
			Games    []struct {
				Amount int64 `json:"amount"`
			} `json:"games"`
		} `json:"clubs"`
	}
	decodeJSON(t, resp, &got)
	if got.UserID != admin.userID {
		t.Fatalf("user_id ekspor = %q, mau %q (diri sendiri)", got.UserID, admin.userID)
	}
	if got.Phone != phone {
		t.Fatalf("phone ekspor = %q, mau %q", got.Phone, phone)
	}
	found := false
	for _, c := range got.Clubs {
		if c.ClubSlug != "" {
			for _, g := range c.Games {
				found = true
				if g.Amount != 15000 {
					t.Fatalf("amount di ekspor = %d, mau 15000 (punya admin sendiri, bukan 9000 milik other)", g.Amount)
				}
			}
		}
	}
	if !found {
		t.Fatal("ekspor tidak memuat main milik sendiri")
	}
}

func TestAccount_Delete_AnonymizesAndRevokesEverything(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	phone := randPhone()
	user := otpLogin(t, base, notifier, phone)
	club := createClub(t, base, user.token, randSlug())
	// Tagihan sendiri — HARUS tetap ada setelah dihapus (§12.2 "transaksi
	// keuangan tetap ada").
	game := createGameWithBody(t, base, user.token, club, gameBodyWithKok(user.userID, 20000))

	delResp := authedRequest(t, http.MethodPost, base+"/api/v1/me/delete", user.token, nil)
	defer delResp.Body.Close()
	if delResp.StatusCode != http.StatusOK {
		dumpAndFail(t, delResp, "POST /me/delete")
	}

	// Sesi lama sekarang harus mati — token yang sama tidak lagi valid.
	meResp := authedRequest(t, http.MethodGet, base+"/api/v1/me", user.token, nil)
	defer meResp.Body.Close()
	if meResp.StatusCode != http.StatusUnauthorized {
		dumpAndFail(t, meResp, "sesi setelah hapus akun harusnya sudah tercabut")
	}

	// Login lagi dgn nomor yang SAMA harus gagal — nomornya sudah dilepas
	// dari akun ini (dianonimkan), jadi otp/verify tidak akan menemukan
	// user manapun buat disambungkan ke sesi baru lewat nomor lama.
	otpRe := authedRequest(t, http.MethodPost, base+"/api/v1/auth/otp/request", "", map[string]string{"phone": phone, "purpose": "device"})
	defer otpRe.Body.Close()
	if otpRe.StatusCode != http.StatusOK {
		dumpAndFail(t, otpRe, "otp/request nomor bekas — masih boleh dipakai daftar ulang, itu bukan yang diuji di sini")
	}
	code := notifier.codeFor(t, phone)
	verifyResp := authedRequest(t, http.MethodPost, base+"/api/v1/auth/otp/verify", "", map[string]string{"phone": phone, "code": code})
	defer verifyResp.Body.Close()
	if verifyResp.StatusCode == http.StatusOK {
		var out struct {
			User struct {
				DisplayName string `json:"display_name"`
			} `json:"user"`
		}
		decodeJSON(t, verifyResp, &out)
		if out.User.DisplayName == "Pemain terhapus" {
			t.Fatal("nomor bekas akun terhapus harusnya bikin USER BARU, bukan menyambung balik ke identitas 'Pemain terhapus' yang sudah dianonimkan")
		}
	}

	// Tagihan lama TETAP ada di DB (bukti langsung, lewat store — sesi
	// user sudah tercabut jadi tidak bisa lagi dicek lewat endpoint
	// authed) — nama yang muncul berubah "Pemain terhapus" lewat live
	// JOIN ke users.display_name (AnonymizeUser, tidak ada salinan
	// terpisah yang bisa lupa disinkronkan).
	// RLS (§6.2) menolak baris tanpa app.club_id di-SET LOCAL dulu — pakai
	// store.WithClub (pool mentah tanpa itu balik NOL BARIS, bukan galat,
	// itulah "gagal menutup bukan membocorkan" yang sengaja diuji f2_test.go).
	s2 := store.New(testdb.Pool(t))
	var displayName string
	var amount int64
	err := s2.WithClub(context.Background(), mustUUID(t, club), func(ctx context.Context, q *gen.Queries) error {
		players, err := q.ListGamePlayersByGame(ctx, mustUUID(t, game.ID))
		if err != nil {
			return err
		}
		if len(players) == 0 {
			return errors.New("game_players kosong")
		}
		amount = players[0].Amount
		payer, err := q.GetUser(ctx, players[0].PayerID)
		if err != nil {
			return err
		}
		displayName = payer.DisplayName
		return nil
	})
	if err != nil {
		t.Fatalf("query langsung tagihan lama: %v", err)
	}
	if amount != 20000 {
		t.Fatalf("amount tagihan lama = %d, mau tetap 20000 (§12.2 transaksi keuangan tidak dihapus)", amount)
	}
	if displayName != "Pemain terhapus" {
		t.Fatalf("display_name di tagihan lama = %q, mau \"Pemain terhapus\"", displayName)
	}
}
