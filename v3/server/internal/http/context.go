// Package httpapi berisi router, middleware, dan handler REST v3
// (API.md). Nama paket sengaja "httpapi", bukan "http" — direktorinya
// tetap internal/http (sesuai PLAN.md §4) supaya tidak tabrakan dengan
// import "net/http" di pemanggilnya.
package httpapi

import (
	"context"

	"github.com/google/uuid"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

type ctxKey int

const (
	ctxKeyUserID ctxKey = iota
	ctxKeyClubID
	ctxKeyRole
)

func withUserID(ctx context.Context, id uuid.UUID) context.Context {
	return context.WithValue(ctx, ctxKeyUserID, id)
}

func userIDFromContext(ctx context.Context) (uuid.UUID, bool) {
	v, ok := ctx.Value(ctxKeyUserID).(uuid.UUID)
	return v, ok
}

func withClub(ctx context.Context, clubID uuid.UUID, role gen.ClubRole) context.Context {
	ctx = context.WithValue(ctx, ctxKeyClubID, clubID)
	return context.WithValue(ctx, ctxKeyRole, role)
}

func clubIDFromContext(ctx context.Context) (uuid.UUID, bool) {
	v, ok := ctx.Value(ctxKeyClubID).(uuid.UUID)
	return v, ok
}

func roleFromContext(ctx context.Context) (gen.ClubRole, bool) {
	v, ok := ctx.Value(ctxKeyRole).(gen.ClubRole)
	return v, ok
}
