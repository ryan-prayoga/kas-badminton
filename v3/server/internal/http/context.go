// Package httpapi berisi router, middleware, dan handler REST v3
// (API.md). Nama paket sengaja "httpapi", bukan "http" — direktorinya
// tetap internal/http (sesuai PLAN.md §4) supaya tidak tabrakan dengan
// import "net/http" di pemanggilnya.
package httpapi

import (
	"context"

	"github.com/google/uuid"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/perm"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

type ctxKey int

const (
	ctxKeyUserID ctxKey = iota
	ctxKeySessionID
	ctxKeyClubID
	ctxKeyRole
	ctxKeyPerm
)

func withUserID(ctx context.Context, userID, sessionID uuid.UUID) context.Context {
	ctx = context.WithValue(ctx, ctxKeyUserID, userID)
	return context.WithValue(ctx, ctxKeySessionID, sessionID)
}

func userIDFromContext(ctx context.Context) (uuid.UUID, bool) {
	v, ok := ctx.Value(ctxKeyUserID).(uuid.UUID)
	return v, ok
}

// sessionIDFromContext — sesi (Bearer token) yang sedang dipakai request
// ini, ditaruh RequireAuth sekali (sama pola dengan withClub+perm). Dipakai
// alur passkey (kredensial baru ditempel ke sesi/perangkat ini, §7.2.2) dan
// logout/revoke-others supaya tidak query auth.Validate dua kali.
func sessionIDFromContext(ctx context.Context) (uuid.UUID, bool) {
	v, ok := ctx.Value(ctxKeySessionID).(uuid.UUID)
	return v, ok
}

// withClub ditaruh RequireClub SEKALI per request (PLAN.md §6.2 lapisan
// pertama) sekaligus izin efektifnya sudah dihitung (perm.Resolve) — supaya
// RequirePerm di belakangnya tinggal baca map, tidak query ulang.
func withClub(ctx context.Context, clubID uuid.UUID, role gen.ClubRole, granted map[perm.Permission]bool) context.Context {
	ctx = context.WithValue(ctx, ctxKeyClubID, clubID)
	ctx = context.WithValue(ctx, ctxKeyRole, role)
	return context.WithValue(ctx, ctxKeyPerm, granted)
}

func clubIDFromContext(ctx context.Context) (uuid.UUID, bool) {
	v, ok := ctx.Value(ctxKeyClubID).(uuid.UUID)
	return v, ok
}

func roleFromContext(ctx context.Context) (gen.ClubRole, bool) {
	v, ok := ctx.Value(ctxKeyRole).(gen.ClubRole)
	return v, ok
}

func permFromContext(ctx context.Context) (map[perm.Permission]bool, bool) {
	v, ok := ctx.Value(ctxKeyPerm).(map[perm.Permission]bool)
	return v, ok
}
