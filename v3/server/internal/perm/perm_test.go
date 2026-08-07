package perm

import (
	"testing"
	"time"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

func TestResolve(t *testing.T) {
	now := time.Date(2026, 8, 7, 12, 0, 0, 0, time.UTC)
	future := now.Add(24 * time.Hour)
	past := now.Add(-24 * time.Hour)

	cases := []struct {
		name          string
		role          gen.ClubRole
		roleExpiresAt *time.Time
		siapaBoleh    SiapaBolehCatat
		want          map[Permission]bool
	}{
		{
			name: "admin dapat semua izin",
			role: gen.ClubRoleAdmin,
			want: map[Permission]bool{
				RecordGame: true, ManageMoney: true, VerifyClaim: true,
				ManageMembers: true, ViewAudit: true,
			},
		},
		{
			name: "bendahara cuma uang, tidak catat main di klub hanya_pengurus",
			role: gen.ClubRoleBendahara, siapaBoleh: HanyaPengurus,
			want: map[Permission]bool{ManageMoney: true},
		},
		{
			name: "pencatat catat main, TIDAK PERNAH uang — kalimat selesai-kalau F4",
			role: gen.ClubRolePencatat, siapaBoleh: HanyaPengurus,
			want: map[Permission]bool{RecordGame: true},
		},
		{
			name: "verifikator cuma verify_claim",
			role: gen.ClubRoleVerifikator, siapaBoleh: HanyaPengurus,
			want: map[Permission]bool{VerifyClaim: true},
		},
		{
			name: "member di klub hanya_pengurus tidak dapat apa-apa",
			role: gen.ClubRoleMember, siapaBoleh: HanyaPengurus,
			want: map[Permission]bool{},
		},
		{
			name: "member di klub semua_anggota dapat RecordGame, tetap bukan uang",
			role: gen.ClubRoleMember, siapaBoleh: SemuaAnggota,
			want: map[Permission]bool{RecordGame: true},
		},
		{
			name: "bendahara di klub semua_anggota dapat RecordGame tambahan + ManageMoney aslinya",
			role: gen.ClubRoleBendahara, siapaBoleh: SemuaAnggota,
			want: map[Permission]bool{ManageMoney: true, RecordGame: true},
		},
		{
			name: "peran pencatat kedaluwarsa turun jadi member (hanya_pengurus) — tidak dapat apa-apa",
			role: gen.ClubRolePencatat, roleExpiresAt: &past, siapaBoleh: HanyaPengurus,
			want: map[Permission]bool{},
		},
		{
			name: "peran admin BELUM kedaluwarsa (masa depan) tetap dapat semua",
			role: gen.ClubRoleAdmin, roleExpiresAt: &future,
			want: map[Permission]bool{
				RecordGame: true, ManageMoney: true, VerifyClaim: true,
				ManageMembers: true, ViewAudit: true,
			},
		},
		{
			name: "peran bendahara kedaluwarsa di klub semua_anggota — turun ke member, cuma RecordGame lewat saklar",
			role: gen.ClubRoleBendahara, roleExpiresAt: &past, siapaBoleh: SemuaAnggota,
			want: map[Permission]bool{RecordGame: true},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Resolve(tc.role, tc.roleExpiresAt, tc.siapaBoleh, now)
			for p := range tc.want {
				if !Has(got, p) {
					t.Errorf("izin %q seharusnya ADA, tidak ada. got=%v", p, got)
				}
			}
			for _, p := range allPermissions {
				if tc.want[p] {
					continue
				}
				if Has(got, p) {
					t.Errorf("izin %q seharusnya TIDAK ADA, tapi ada. got=%v", p, got)
				}
			}
		})
	}
}
