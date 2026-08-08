// Pusat notifikasi in-app + preferensi + langganan Web Push (API.md §6,
// PLAN.md §10, §14 F8). Semua endpoint di sini milik SATU orang lintas
// klub (/me/...) — bukan /clubs/{clubId}/..., makanya s.WithinTx (tabel
// notifications/notification_prefs/push_subscriptions SENGAJA tidak
// ber-RLS, lihat komentar migrasi 00016_rls.sql: dilindungi filter
// user_id di query, bukan SET LOCAL app.club_id).
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

type notificationDTO struct {
	ID        uuid.UUID  `json:"id"`
	ClubID    *uuid.UUID `json:"club_id,omitempty"`
	Kind      string     `json:"kind"`
	Channel   string     `json:"channel"`
	Title     string     `json:"title,omitempty"`
	Body      string     `json:"body,omitempty"`
	URL       string     `json:"url,omitempty"`
	Status    string     `json:"status"`
	ReadAt    *time.Time `json:"read_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

func newNotificationDTO(n gen.Notification) notificationDTO {
	var p struct {
		Title string `json:"title"`
		Body  string `json:"body"`
		URL   string `json:"url"`
	}
	_ = json.Unmarshal(n.Payload, &p)
	dto := notificationDTO{
		ID: n.ID, ClubID: n.ClubID, Kind: n.Kind, Channel: string(n.Channel),
		Title: p.Title, Body: p.Body, URL: p.URL, Status: string(n.Status),
		CreatedAt: tsOrZero(n.CreatedAt),
	}
	if n.ReadAt.Valid {
		v := n.ReadAt.Time
		dto.ReadAt = &v
	}
	return dto
}

// handleGetVapidPublicKey — GET /me/push-vapid-key. Klien butuh ini buat
// PushManager.subscribe({applicationServerKey: ...}) — kunci PUBLIK,
// aman dikirim ke siapa pun yang sudah login (tidak ada rahasia di sini,
// bedanya dari VAPIDPrivateKey yang tidak pernah meninggalkan server).
func handleGetVapidPublicKey(publicKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"public_key": publicKey})
	}
}

// handleListMyNotifications — GET /me/notifications?unread=true.
func handleListMyNotifications(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())
		unreadOnly := r.URL.Query().Get("unread") == "true"

		var rows []gen.Notification
		err := s.WithinTx(r.Context(), func(ctx context.Context, q *gen.Queries) error {
			var err error
			rows, err = q.ListNotificationsByUser(ctx, gen.ListNotificationsByUserParams{
				UserID: userID, UnreadOnly: pgtype.Bool{Bool: unreadOnly, Valid: true},
			})
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil notifikasi.", nil)
			return
		}
		items := make([]notificationDTO, 0, len(rows))
		for _, n := range rows {
			items = append(items, newNotificationDTO(n))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

// handleMarkNotificationRead — POST /me/notifications/{id}/read.
func handleMarkNotificationRead(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Notifikasi tidak ditemukan.", nil)
			return
		}
		var notFound bool
		var n gen.Notification
		err = s.WithinTx(r.Context(), func(ctx context.Context, q *gen.Queries) error {
			row, err := q.MarkNotificationRead(ctx, gen.MarkNotificationReadParams{ID: id, UserID: userID})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					notFound = true
					return nil
				}
				return err
			}
			n = row
			return nil
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal menandai dibaca.", nil)
			return
		}
		if notFound {
			writeError(w, CodeNotFound, "Notifikasi tidak ditemukan atau sudah dibaca.", nil)
			return
		}
		writeJSON(w, http.StatusOK, newNotificationDTO(n))
	}
}

type notificationPrefDTO struct {
	ClubID *uuid.UUID `json:"club_id,omitempty"`
	Kind   string     `json:"kind"`
	PushOn bool       `json:"push_on"`
	WaOn   bool       `json:"wa_on"`
}

// handleGetNotificationPrefs — GET /me/notification-prefs. Cuma
// mengembalikan baris yang PERNAH diubah dari bawaan — kind yang belum
// pernah disentuh tidak muncul (bawaannya "nyala semua", lihat
// resolvePrefs di internal/notify/router.go); klien menampilkan default
// itu sendiri buat kind yang tidak ada di daftar ini.
func handleGetNotificationPrefs(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())
		var rows []gen.NotificationPref
		err := s.WithinTx(r.Context(), func(ctx context.Context, q *gen.Queries) error {
			var err error
			rows, err = q.ListNotificationPrefsByUser(ctx, userID)
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil preferensi notifikasi.", nil)
			return
		}
		items := make([]notificationPrefDTO, 0, len(rows))
		for _, p := range rows {
			items = append(items, notificationPrefDTO{ClubID: p.ClubID, Kind: p.Kind, PushOn: p.PushOn, WaOn: p.WaOn})
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

type patchNotificationPrefRequest struct {
	ClubID *string `json:"club_id"`
	Kind   string  `json:"kind"`
	PushOn bool    `json:"push_on"`
	WaOn   bool    `json:"wa_on"`
}

// handlePatchNotificationPrefs — PATCH /me/notification-prefs, body satu
// preferensi per panggilan `{club_id?, kind, push_on, wa_on}`. club_id
// kosong = bawaan lintas klub (§10.2 "opt-in per jenis").
func handlePatchNotificationPrefs(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())
		var req patchNotificationPrefRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		if req.Kind == "" {
			writeError(w, CodeValidationFailed, "kind wajib diisi.", nil)
			return
		}
		var clubID *uuid.UUID
		if req.ClubID != nil && *req.ClubID != "" {
			id, err := uuid.Parse(*req.ClubID)
			if err != nil {
				writeError(w, CodeValidationFailed, "club_id tidak valid.", nil)
				return
			}
			clubID = &id
		}

		var pref gen.NotificationPref
		err := s.WithinTx(r.Context(), func(ctx context.Context, q *gen.Queries) error {
			var err error
			pref, err = q.UpsertNotificationPref(ctx, gen.UpsertNotificationPrefParams{
				UserID: userID, ClubID: clubID, Kind: req.Kind, PushOn: req.PushOn, WaOn: req.WaOn,
			})
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengubah preferensi.", nil)
			return
		}
		writeJSON(w, http.StatusOK, notificationPrefDTO{ClubID: pref.ClubID, Kind: pref.Kind, PushOn: pref.PushOn, WaOn: pref.WaOn})
	}
}

type pushSubscriptionDTO struct {
	ID       uuid.UUID `json:"id"`
	Endpoint string    `json:"endpoint"`
}

type createPushSubscriptionRequest struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

// handleCreatePushSubscription — POST /me/push-subscriptions. Body
// bentuk `PushSubscription.toJSON()` browser apa adanya
// (`{endpoint, keys:{p256dh,auth}}`) — klien tidak perlu menyusun ulang.
// ON CONFLICT(endpoint) DO UPDATE (notifications.sql) — daftar ulang
// endpoint yang sama (mis. token berubah tapi endpoint tetap) menimpa,
// bukan duplikat.
func handleCreatePushSubscription(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())
		var req createPushSubscriptionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		if req.Endpoint == "" || req.Keys.P256dh == "" || req.Keys.Auth == "" {
			writeError(w, CodeValidationFailed, "endpoint dan keys.p256dh/auth wajib diisi.", nil)
			return
		}

		var sub gen.PushSubscription
		err := s.WithinTx(r.Context(), func(ctx context.Context, q *gen.Queries) error {
			var err error
			sub, err = q.CreatePushSubscription(ctx, gen.CreatePushSubscriptionParams{
				UserID: userID, Endpoint: req.Endpoint, P256dh: req.Keys.P256dh, Auth: req.Keys.Auth,
			})
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mendaftarkan langganan push.", nil)
			return
		}
		writeJSON(w, http.StatusCreated, pushSubscriptionDTO{ID: sub.ID, Endpoint: sub.Endpoint})
	}
}

// handleDeletePushSubscription — DELETE /me/push-subscriptions/{id}.
func handleDeletePushSubscription(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Langganan tidak ditemukan.", nil)
			return
		}
		err = s.WithinTx(r.Context(), func(ctx context.Context, q *gen.Queries) error {
			return q.DeletePushSubscription(ctx, gen.DeletePushSubscriptionParams{ID: id, UserID: userID})
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mencabut langganan.", nil)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
