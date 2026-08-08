// Package realtime adalah bus event bertipe lewat Postgres LISTEN/NOTIFY
// (PLAN.md §4.3, API.md §8). Beda mendasar dari v2: tiap event membawa
// entitas yang berubah, klien menambal store lokal — bukan
// router.refresh() penuh.
package realtime

import (
	"encoding/json"

	"github.com/google/uuid"
)

// Channel adalah satu-satunya channel Postgres yang dipakai — payload-nya
// sudah bertipe (Kind + ClubID + Data), jadi tidak perlu channel terpisah
// per jenis event.
const Channel = "kok_events"

type Kind string

// Kind yang NYALA di F2 (dipicu handler clubs/games — internal/http).
const (
	KindGameCreated Kind = "game.created"
	KindGameUpdated Kind = "game.updated"
	KindGameDeleted Kind = "game.deleted"
	KindBillUpdated Kind = "bill.updated"
)

// Kind yang DIDAFTARKAN tapi belum dipicu apa pun di F2 — dokumentatif,
// menunggu endpoint aslinya (API.md §8 daftar minimum, PLAN.md §14
// F4/F6/F7). Menjaga nama event konsisten begitu fase itu tiba, tanpa
// mengunci server ke lingkup yang belum dikerjakan.
const (
	KindPaymentClaimed  Kind = "payment.claimed"
	KindPaymentVerified Kind = "payment.verified"
	KindWalletUpdated   Kind = "wallet.updated"
	KindDisputeOpened   Kind = "dispute.opened"
	KindDisputeResolved Kind = "dispute.resolved"
	KindClaimRequested  Kind = "claim.requested"
	KindSessionRevoked  Kind = "session.revoked"
)

// KindPaymentRejected — F6/2, dipisah dari KindPaymentVerified: item ini
// kembali "unpaid" biasa (bukan lunas) baik ditolak bendahara maupun
// dibatalkan sendiri sebelum diverifikasi (§9.3, §9.5 aturan E lepas).
const KindPaymentRejected Kind = "payment.rejected"

// F7 (PLAN.md §14, API.md §5) — turnamen. Satu kind cukup buat semua
// perubahan (buat, ubah, isi skor, tambah kok, iuran lunas): payload
// SELALU tournament penuh (tournamentDTO), klien menimpa entri di
// store-nya sendiri berdasar id — sama pola bill.updated (bukan diff
// per-field), lebih sederhana daripada mendaftar satu kind per aksi kecil.
const KindTournamentUpdated Kind = "tournament.updated"

// KindSideBetUpdated — F7 (§8.4), dipicu create & PATCH status. Taruhan
// barang tidak menyentuh uang jadi tidak butuh bill.updated berpasangan
// (beda dari settle-bet di games.go yang MEMANG mengubah payer_id →
// memicu game.updated + bill.updated seperti biasa).
const KindSideBetUpdated Kind = "side_bet.updated"

// Event adalah bentuk yang dikirim lewat NOTIFY dan diteruskan ke
// subscriber SSE. ClubID dipakai bus buat filter kebocoran antar-klub
// (§6.2) — subscriber cuma menerima event dari klub yang dia ikuti,
// dihitung sekali saat SSE konek (internal/http/events.go).
type Event struct {
	Kind   Kind            `json:"kind"`
	ClubID uuid.UUID       `json:"club_id"`
	Data   json.RawMessage `json:"data"`
}

// NewEvent membungkus payload domain (mis. {"id":"...","played_on":"..."})
// jadi Event siap-publish. Gagal marshal Data dianggap bug pemanggil —
// panic disengaja supaya ketahuan saat development, bukan silently
// terlewat di produksi.
func NewEvent(kind Kind, clubID uuid.UUID, data any) Event {
	raw, err := json.Marshal(data)
	if err != nil {
		panic("realtime: gagal marshal payload event: " + err.Error())
	}
	return Event{Kind: kind, ClubID: clubID, Data: raw}
}
