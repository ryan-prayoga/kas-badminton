package httpapi

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// Konversi kecil antara pgtype.* (store layer) dan JSON siap kirim
// (API.md §0: tanggal YYYY-MM-DD zona klub, waktu RFC3339 UTC, rupiah
// bigint tanpa desimal).

const dateLayout = "2006-01-02"

func parseDate(s string) (pgtype.Date, error) {
	t, err := time.Parse(dateLayout, s)
	if err != nil {
		return pgtype.Date{}, err
	}
	return pgtype.Date{Time: t, Valid: true}, nil
}

func dateString(d pgtype.Date) string {
	if !d.Valid {
		return ""
	}
	return d.Time.Format(dateLayout)
}

func textOrNil(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	return &t.String
}

func textOf(s string) pgtype.Text {
	return pgtype.Text{String: s, Valid: s != ""}
}

func tsOrZero(t pgtype.Timestamptz) time.Time {
	if !t.Valid {
		return time.Time{}
	}
	return t.Time
}

// --- DTO ---

func newUserDTOFrom(u gen.User) userDTO {
	return userDTO{
		ID:          u.ID.String(),
		Phone:       u.Phone.String,
		DisplayName: u.DisplayName,
	}
}

type sessionDTO struct {
	ID          uuid.UUID `json:"id"`
	DeviceLabel string    `json:"device_label"`
	LastSeenAt  time.Time `json:"last_seen_at"`
	CreatedAt   time.Time `json:"created_at"`
}

func newSessionDTO(s gen.Session) sessionDTO {
	return sessionDTO{
		ID:          s.ID,
		DeviceLabel: s.DeviceLabel.String,
		LastSeenAt:  tsOrZero(s.LastSeenAt),
		CreatedAt:   tsOrZero(s.CreatedAt),
	}
}

type clubDTO struct {
	ID       uuid.UUID       `json:"id"`
	Slug     string          `json:"slug"`
	Name     string          `json:"name"`
	Timezone string          `json:"timezone"`
	Status   string          `json:"status"`
	Settings json.RawMessage `json:"settings"`
	Version  int64           `json:"version"`
}

func newClubDTO(c gen.Club) clubDTO {
	return clubDTO{
		ID:       c.ID,
		Slug:     c.Slug,
		Name:     c.Name,
		Timezone: c.Timezone,
		Status:   string(c.Status),
		Settings: c.Settings,
		Version:  c.Version,
	}
}

type gamePlayerDTO struct {
	ID          uuid.UUID  `json:"id"`
	UserID      uuid.UUID  `json:"user_id"`
	PayerID     uuid.UUID  `json:"payer_id"`
	Side        string     `json:"side"`
	Slot        int16      `json:"slot"`
	Amount      int64      `json:"amount"`
	PaidAt      *time.Time `json:"paid_at,omitempty"`
	DisputedAt  *time.Time `json:"disputed_at,omitempty"`
	DisputeNote *string    `json:"dispute_note,omitempty"`
}

func newGamePlayerDTO(p gen.GamePlayer) gamePlayerDTO {
	dto := gamePlayerDTO{
		ID:          p.ID,
		UserID:      p.UserID,
		PayerID:     p.PayerID,
		Side:        string(p.Side),
		Slot:        p.Slot,
		Amount:      p.Amount,
		DisputeNote: textOrNil(p.DisputeNote),
	}
	if p.PaidAt.Valid {
		t := p.PaidAt.Time
		dto.PaidAt = &t
	}
	if p.DisputedAt.Valid {
		t := p.DisputedAt.Time
		dto.DisputedAt = &t
	}
	return dto
}

type gameKokDTO struct {
	ID             uuid.UUID  `json:"id"`
	KokTypeID      *uuid.UUID `json:"kok_type_id,omitempty"`
	TypeName       *string    `json:"type_name,omitempty"`
	PricePerPerson int64      `json:"price_per_person"`
	Qty            int32      `json:"qty"`
}

func newGameKokDTO(k gen.GameKok) gameKokDTO {
	return gameKokDTO{
		ID:             k.ID,
		KokTypeID:      k.KokTypeID,
		TypeName:       textOrNil(k.TypeName),
		PricePerPerson: k.PricePerPerson,
		Qty:            k.Qty,
	}
}

type gameDTO struct {
	ID         uuid.UUID       `json:"id"`
	ClubID     uuid.UUID       `json:"club_id"`
	PlayedOn   string          `json:"played_on"`
	Format     string          `json:"format"`
	Notes      *string         `json:"notes,omitempty"`
	RecordedBy *uuid.UUID      `json:"recorded_by,omitempty"`
	CreatedAt  time.Time       `json:"created_at"`
	UpdatedAt  time.Time       `json:"updated_at"`
	Version    int64           `json:"version"`
	Players    []gamePlayerDTO `json:"players"`
	Koks       []gameKokDTO    `json:"koks,omitempty"`
}

func newGameDTO(g gen.Game) gameDTO {
	return gameDTO{
		ID:         g.ID,
		ClubID:     g.ClubID,
		PlayedOn:   dateString(g.PlayedOn),
		Format:     string(g.Format),
		Notes:      textOrNil(g.Notes),
		RecordedBy: g.RecordedBy,
		CreatedAt:  tsOrZero(g.CreatedAt),
		UpdatedAt:  tsOrZero(g.UpdatedAt),
		Version:    g.Version,
	}
}
