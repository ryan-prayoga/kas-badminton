// Package perm menghitung himpunan izin efektif seseorang di satu klub
// (PLAN.md §7.4). Ini pengganti "RBAC ringan" F2
// (internal/http/rbac.go.requireRole, sudah dihapus) — bedanya paket ini
// memperhitungkan tiga hal yang tidak dipunyai versi ringan itu:
//
//  1. Aturan jatuh-balik: izin yang tidak ditunjuk ke siapa pun otomatis
//     dipegang admin klub.
//  2. Peran berbatas waktu (memberships.role_expires_at) — begitu lewat,
//     turun jadi member tanpa perlu diingat siapa pun.
//  3. Saklar per klub (siapa_boleh_catat) — di klub "semua_anggota", member
//     biasa boleh mencatat main, tapi TIDAK PERNAH boleh menyentuh uang.
//
// Murni Go, tanpa DB — pemanggil (internal/http middleware) yang bertanggung
// jawab membaca role, role_expires_at, dan clubs.settings lebih dulu.
package perm

import (
	"time"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// Permission adalah satu tindakan bergranularitas kasar, bukan per-endpoint
// — cukup halus untuk memisahkan "catat main" dari "pegang uang" (yang
// literally jadi kalimat "selesai kalau" F4: "pencatat ditolak saat
// menyentuh endpoint uang"), tidak lebih halus dari itu.
type Permission string

const (
	// RecordGame — catat main, isi skor, tambah kok (§7.4 kolom `pencatat`).
	// Juga dipegang `member` biasa kalau saklar klub siapa_boleh_catat
	// bernilai "semua_anggota".
	RecordGame Permission = "record_game"

	// ManageMoney — kas, tagihan, deposit, verifikasi pembayaran, stok kok,
	// penyesuaian saldo (§7.4 kolom `bendahara`). TIDAK PERNAH jatuh ke
	// member biasa lewat saklar apa pun.
	ManageMoney Permission = "manage_money"

	// VerifyClaim — menyetujui/menolak laporan bayar dan permintaan klaim
	// akun (§7.4 kolom `verifikator`).
	VerifyClaim Permission = "verify_claim"

	// ManageMembers — peran, saklar klub, persetujuan klaim, jurnal audit,
	// poster QR — semuanya di klubnya (§7.4 kolom `admin`).
	ManageMembers Permission = "manage_members"

	// ViewAudit — membaca jurnal audit klub. Dipisah dari ManageMembers
	// karena §7.2.1 mewajibkan pemindahan nomor "terlihat oleh anggota
	// klub", bukan cuma pengurus — tapi endpoint admin (kelola peran, dst)
	// tetap harus ManageMembers, jadi keduanya bukan izin yang sama.
	ViewAudit Permission = "view_audit"
)

// SiapaBolehCatat — nilai saklar clubs.settings.siapa_boleh_catat (§7.4).
type SiapaBolehCatat string

const (
	SemuaAnggota  SiapaBolehCatat = "semua_anggota"
	HanyaPengurus SiapaBolehCatat = "hanya_pengurus"
)

// rolePermissions memetakan peran ke izin bawaannya (§7.4). admin SENGAJA
// tidak didaftar di sini — dapat semuanya lewat aturan jatuh-balik di
// Resolve, bukan daftar eksplisit, supaya menambah Permission baru di masa
// depan otomatis ikut ke admin tanpa mengedit peta ini.
var rolePermissions = map[gen.ClubRole][]Permission{
	gen.ClubRoleBendahara:   {ManageMoney},
	gen.ClubRolePencatat:    {RecordGame},
	gen.ClubRoleVerifikator: {VerifyClaim},
	// gen.ClubRoleMember: sengaja kosong — lihat SiapaBolehCatat di Resolve.
}

// allPermissions — dipakai aturan jatuh-balik admin. Daftar tunggal supaya
// Permission baru cukup ditambah di sini sekali.
var allPermissions = []Permission{RecordGame, ManageMoney, VerifyClaim, ManageMembers, ViewAudit}

// Resolve menghitung izin efektif satu keanggotaan. now dilewatkan eksplisit
// (bukan time.Now() di dalam) supaya deterministik untuk diuji.
func Resolve(role gen.ClubRole, roleExpiresAt *time.Time, siapaBolehCatat SiapaBolehCatat, now time.Time) map[Permission]bool {
	effectiveRole := role
	if roleExpiresAt != nil && !roleExpiresAt.IsZero() && now.After(*roleExpiresAt) {
		effectiveRole = gen.ClubRoleMember
	}

	out := make(map[Permission]bool, len(allPermissions))

	if effectiveRole == gen.ClubRoleAdmin {
		for _, p := range allPermissions {
			out[p] = true
		}
		return out
	}

	for _, p := range rolePermissions[effectiveRole] {
		out[p] = true
	}

	// Saklar klub: member biasa (atau peran lain yang belum dapat RecordGame
	// dari perannya sendiri) boleh catat main kalau klub "semua_anggota" —
	// tapi ini TIDAK PERNAH menambahkan ManageMoney.
	if siapaBolehCatat == SemuaAnggota {
		out[RecordGame] = true
	}

	return out
}

// Has adalah pembantu kecil supaya pemanggil tidak menulis `m[p]` mentah
// (map nil aman dibaca di Go, tapi eksplisit lebih jelas dibaca).
func Has(granted map[Permission]bool, p Permission) bool {
	return granted[p]
}
