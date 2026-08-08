package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/auth"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/perm"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

type memberDTO struct {
	UserID            uuid.UUID  `json:"user_id"`
	DisplayName       string     `json:"display_name"`
	Username          *string    `json:"username,omitempty"`
	Phone             *string    `json:"phone,omitempty"`
	Status            string     `json:"status"`
	Role              string     `json:"role"`
	RoleExpiresAt     *time.Time `json:"role_expires_at,omitempty"`
	IsTournamentGuest bool       `json:"is_tournament_guest"`
	AutoDeduct        bool       `json:"auto_deduct"`
}

func newMemberDTO(m gen.ListMembersRow) memberDTO {
	dto := memberDTO{
		UserID:            m.UserID,
		DisplayName:       m.DisplayName,
		Username:          textOrNil(m.Username),
		Phone:             textOrNil(m.Phone),
		Status:            string(m.UserStatus),
		Role:              string(m.Role),
		IsTournamentGuest: m.IsTournamentGuest,
		AutoDeduct:        m.AutoDeduct,
	}
	if m.RoleExpiresAt.Valid {
		t := m.RoleExpiresAt.Time
		dto.RoleExpiresAt = &t
	}
	return dto
}

// handleListMembers — GET /clubs/{clubId}/members?q=... (API.md §2),
// anggota mana pun boleh (pencarian §5.4, dipakai juga di pemilih pemain
// saat mencatat main).
func handleListMembers(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		q := r.URL.Query().Get("q")

		var rows []gen.ListMembersRow
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, qr *gen.Queries) error {
			var err error
			rows, err = qr.ListMembers(ctx, gen.ListMembersParams{ClubID: clubID, Q: textOf(q)})
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil daftar anggota.", nil)
			return
		}
		dtos := make([]memberDTO, 0, len(rows))
		for _, m := range rows {
			dtos = append(dtos, newMemberDTO(m))
		}
		writeJSON(w, http.StatusOK, dtos)
	}
}

type createGuestMemberRequest struct {
	DisplayName string `json:"display_name"`
}

// handleCreateGuestMember — POST /clubs/{clubId}/members/guest (PLAN.md
// §8.1 "pemain tamu"). Pencatat mengetik nama yang tidak cocok anggota mana
// pun saat mencatat main; ini bikin akun bayangan `unclaimed` LANGSUNG jadi
// anggota klub, supaya dia bisa ditagih & punya riwayat persis anggota
// biasa. Diklaim belakangan lewat QR/tautan (join.go, SearchUnclaimedByClub).
func handleCreateGuestMember(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		var req createGuestMemberRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		name := strings.TrimSpace(req.DisplayName)
		if name == "" {
			writeError(w, CodeValidationFailed, "Nama pemain tamu wajib diisi.", nil)
			return
		}

		var dto memberDTO
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			club, err := q.GetClub(ctx, clubID)
			if err != nil {
				return err
			}
			if err := checkMemberQuota(ctx, q, club); err != nil {
				return err
			}
			u, err := q.CreateUnclaimedUser(ctx, name)
			if err != nil {
				return err
			}
			m, err := q.CreateMembership(ctx, gen.CreateMembershipParams{
				ClubID: clubID, UserID: u.ID, Role: gen.ClubRoleMember,
			})
			if err != nil {
				return err
			}
			dto = memberDTO{
				UserID:      u.ID,
				DisplayName: u.DisplayName,
				Status:      string(u.Status),
				Role:        string(m.Role),
				AutoDeduct:  m.AutoDeduct,
			}
			return nil
		})
		if err != nil {
			if msg, ok := asQuotaExceeded(err); ok {
				writeError(w, CodeQuotaExceeded, msg, nil)
				return
			}
			writeError(w, CodeValidationFailed, "Gagal membuat pemain tamu.", nil)
			return
		}
		writeJSON(w, http.StatusCreated, dto)
	}
}

type updateRoleRequest struct {
	Role          string     `json:"role"`
	RoleExpiresAt *time.Time `json:"role_expires_at"`
}

var validRoles = map[string]gen.ClubRole{
	"admin": gen.ClubRoleAdmin, "bendahara": gen.ClubRoleBendahara,
	"pencatat": gen.ClubRolePencatat, "verifikator": gen.ClubRoleVerifikator,
	"member": gen.ClubRoleMember,
}

// handleUpdateMemberRole — PATCH /clubs/{clubId}/members/{userId}/role
// (API.md §2), RequirePerm(ManageMembers). role_expires_at opsional —
// peran berbatas waktu (§7.4).
func handleUpdateMemberRole(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		userID, err := uuid.Parse(chi.URLParam(r, "userId"))
		if err != nil {
			writeError(w, CodeNotFound, "Anggota tidak ditemukan.", nil)
			return
		}
		var req updateRoleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		role, ok := validRoles[req.Role]
		if !ok {
			writeError(w, CodeValidationFailed, "Peran tidak dikenali.", nil)
			return
		}
		var expiresAt pgtype.Timestamptz
		if req.RoleExpiresAt != nil {
			expiresAt = pgtype.Timestamptz{Time: *req.RoleExpiresAt, Valid: true}
		}

		var updated gen.Membership
		notFound := false
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			m, err := q.UpdateMembershipRole(ctx, gen.UpdateMembershipRoleParams{
				ClubID: clubID, UserID: userID, Role: role, RoleExpiresAt: expiresAt,
			})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					notFound = true
					return nil
				}
				return err
			}
			updated = m
			return nil
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengubah peran.", nil)
			return
		}
		if notFound {
			writeError(w, CodeNotFound, "Anggota tidak ditemukan.", nil)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"user_id": updated.UserID, "role": string(updated.Role)})
	}
}

type updateAutoDeductRequest struct {
	AutoDeduct bool `json:"auto_deduct"`
}

// handleUpdateAutoDeduct — PATCH /clubs/{clubId}/members/{userId}/auto-deduct
// (API.md §2) — "diri sendiri atau admin". RequireClub sudah jalan;
// otorisasi tambahan dicek manual di sini (bukan RequirePerm — perm itu
// per-endpoint, bukan per-"diri sendiri ATAU admin").
func handleUpdateAutoDeduct(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		callerID, _ := userIDFromContext(r.Context())
		targetID, err := uuid.Parse(chi.URLParam(r, "userId"))
		if err != nil {
			writeError(w, CodeNotFound, "Anggota tidak ditemukan.", nil)
			return
		}
		if targetID != callerID {
			granted, _ := permFromContext(r.Context())
			if !granted[perm.ManageMembers] {
				writeError(w, CodeInsufficientPermission, "Cuma diri sendiri atau admin yang boleh mengubah ini.", nil)
				return
			}
		}

		var req updateAutoDeductRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}

		notFound := false
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			_, err := q.UpdateMembershipAutoDeduct(ctx, gen.UpdateMembershipAutoDeductParams{
				ClubID: clubID, UserID: targetID, AutoDeduct: req.AutoDeduct,
			})
			if errors.Is(err, pgx.ErrNoRows) {
				notFound = true
				return nil
			}
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengubah potong otomatis.", nil)
			return
		}
		if notFound {
			writeError(w, CodeNotFound, "Anggota tidak ditemukan.", nil)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

type relocatePhoneRequest struct {
	NewPhone string `json:"new_phone"`
	Reason   string `json:"reason"`
}

// handleRelocatePhone — POST /clubs/{clubId}/members/{userId}/relocate-phone
// (API.md §2, PLAN.md §7.2.1). "Hanya admin klub, tidak bisa didelegasikan
// ke peran lain" — RequirePerm(ManageMembers) kebetulan SAMA dengan
// admin-only di tabel peran saat ini (§7.4: tidak ada peran lain yang
// pernah dapat izin ini), jadi cukup dipasang lewat RequirePerm biasa di
// router, bukan pengecekan role manual kedua.
func handleRelocatePhone(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		adminID, _ := userIDFromContext(r.Context())
		targetID, err := uuid.Parse(chi.URLParam(r, "userId"))
		if err != nil {
			writeError(w, CodeNotFound, "Anggota tidak ditemukan.", nil)
			return
		}
		var req relocatePhoneRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		if !auth.PhoneRe.MatchString(req.NewPhone) {
			writeError(w, CodeValidationFailed, "Nomor baru harus format internasional, mis. +6281234567890.", nil)
			return
		}
		if req.Reason == "" {
			writeError(w, CodeValidationFailed, "Alasan pemindahan wajib diisi — tercatat di jurnal audit klub.", nil)
			return
		}

		// Anggota klub INI dulu (§6.2) — baru sentuh tabel lintas klub (users,
		// sessions, dst) lewat WithinTx.
		isMember := false
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			_, err := q.GetMembership(ctx, gen.GetMembershipParams{ClubID: clubID, UserID: targetID})
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			isMember = err == nil
			return nil
		})
		if err != nil || !isMember {
			writeError(w, CodeNotFound, "Anggota tidak ditemukan.", nil)
			return
		}

		var phoneConflict bool
		err = s.WithinTx(r.Context(), func(ctx context.Context, q *gen.Queries) error {
			if _, err := q.UpdateUserPhone(ctx, gen.UpdateUserPhoneParams{ID: targetID, Phone: textOf(req.NewPhone)}); err != nil {
				var pgErr *pgconn.PgError
				if errors.As(err, &pgErr) && pgErr.Code == "23505" {
					phoneConflict = true
					return nil
				}
				return err
			}
			// Semua sesi, passkey, dan PIN LAMA dicabut — perangkat lama
			// otomatis keluar (§7.2.1).
			if err := q.RevokeAllSessionsByUser(ctx, targetID); err != nil {
				return err
			}
			if err := q.DeleteAllWebauthnCredentialsByUser(ctx, targetID); err != nil {
				return err
			}
			return q.DeletePin(ctx, targetID)
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal memindahkan nomor.", nil)
			return
		}
		if phoneConflict {
			writeError(w, CodeValidationFailed, "Nomor baru sudah dipakai akun lain.", nil)
			return
		}

		// TODO(F12/audit): tulis baris audit_log yang bisa dibaca SELURUH
		// anggota klub (bukan cuma pengurus) — §7.2.1 mewajibkan ini terlihat,
		// bukan cuma tercatat. audit_log belum punya query/writer di F4;
		// disambung begitu F12 (operasional & keamanan) digarap.
		_ = adminID

		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}
