// Router notifikasi Push vs WA (PLAN.md §10.1, §14 F8) — bagian yang bisa
// dihitung MURNI (jalur bawaan per kejadian, jam tenang) dipisah ke sini
// biar tertest tanpa DB/waktu sungguhan; keputusan yang butuh baca
// preferensi/langganan dari DB ada di internal/notify (Router).
package domain

// NotifKind — satu per baris tabel §10.1. String murni (bukan enum
// Postgres) karena disimpan sebagai `notifications.kind text` — daftarnya
// boleh bertambah tanpa migrasi.
type NotifKind string

const (
	NotifGameRecorded     NotifKind = "game_recorded"      // "kamu dicatat ikut main"
	NotifBillPayerChanged NotifKind = "bill_payer_changed" // "kamu nanggung tagihan A" / "tagihanmu dibayarin B" (§8.2)
	NotifWalletUpdated    NotifKind = "wallet_updated"     // deposit berubah
	NotifPaymentVerified  NotifKind = "payment_verified"   // pembayaran diverifikasi
	NotifClaimRequested   NotifKind = "claim_requested"    // permintaan klaim masuk (buat verifikator)
	NotifDebtOverdue      NotifKind = "debt_overdue"       // tunggakan lewat batas (§10.3)
)

type NotifChannel string

const (
	ChannelPush NotifChannel = "push"
	ChannelWA   NotifChannel = "wa"
)

// DefaultChannelFor — jalur BAWAAN per kejadian (§10.1 tabel). Tunggakan
// lewat batas jalan WA (jarang, penting, penunggak paling mungkin belum
// masang app); sisanya Push (rutin, uang orang berubah tanpa dia
// berbuat apa-apa — dia berhak tahu seketika, tapi tidak layak
// menghabiskan jatah WA buat itu).
func DefaultChannelFor(kind NotifKind) NotifChannel {
	if kind == NotifDebtOverdue {
		return ChannelWA
	}
	return ChannelPush
}

// IsQuietHour — jam tenang bawaan 21.00–07.00 (§10.2), dalam JAM LOKAL
// klub (pemanggil yang menghitung dari clubs.timezone, fungsi ini cuma
// pembandingan integer). Wraparound lewat tengah malam: 21,22,23,0..6
// termasuk tenang; 7..20 tidak.
func IsQuietHour(hour int) bool {
	return hour >= 21 || hour < 7
}
