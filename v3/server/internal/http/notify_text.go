package httpapi

import "strconv"

// rupiahText — "Rp47.000", format ringkas buat isi notifikasi Push/WA
// (§5.6.1 "angka selalu berformat rupiah penuh"). BUKAN duplikat lib/
// format.ts di klien — itu buat tampilan UI, ini buat teks pesan yang
// dikirim server sebelum sampai ke perangkat mana pun.
func rupiahText(amount int64) string {
	s := strconv.FormatInt(amount, 10)
	neg := ""
	if amount < 0 {
		neg = "-"
		s = s[1:]
	}
	var out []byte
	for i, c := range []byte(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, '.')
		}
		out = append(out, c)
	}
	return "Rp" + neg + string(out)
}
