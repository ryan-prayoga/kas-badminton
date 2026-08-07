package domain

import "strings"

// NormalizeName trim + rapatkan spasi ganda. Port dari
// v2/lib/domain/game.ts normalizeName.
func NormalizeName(name string) string {
	return strings.Join(strings.Fields(name), " ")
}

// NormalizeNameType sama seperti NormalizeName tapi dipotong 60 karakter —
// dipakai untuk nama yang disimpan sebagai identitas (tipe kok, dst).
func NormalizeNameType(name string) string {
	n := NormalizeName(name)
	if len(n) > 60 {
		return n[:60]
	}
	return n
}
