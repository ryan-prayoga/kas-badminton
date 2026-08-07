// Package qris — manipulasi payload QRIS statis→dinamis (PLAN.md §9.6),
// murni Go tanpa dependency baru: format TLV (Tag-Length-Value) EMVCo QR
// Code for Payment Systems yang dipakai QRIS Indonesia sudah cukup
// sederhana buat ditulis sendiri, tidak butuh library pihak ketiga.
//
// Decode dari FOTO sengaja TIDAK di sini — itu kerja BarcodeDetector di
// browser (klien mengirim payload teks yang sudah terdekode), bukan
// server. Paket ini cuma mengurus teks: validasi payload statis dan
// menyuntikkan nominal buat versi dinamis, sama seperti @prasetya/qris
// yang dipakai v2 tapi tanpa dependency npm/Go tambahan (PLAN.md §4.4 —
// belum ada library decode/manipulasi QRIS yang dikunci di sana).
package qris

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Tag EMVCo yang disentuh langsung di sini — sisanya dilewatkan apa
// adanya (merchant/negara/dst, tidak pernah diubah).
const (
	tagPayloadFormat        = "00"
	tagPointOfInitiation    = "01"
	tagTransactionAmount    = "54"
	tagCRC                  = "63"
	pointOfInitiationStatic = "11"
	pointOfInitiationDyn    = "12"
)

// field — satu entri TLV, urutan dijaga sesuai payload asli supaya
// round-trip (parse → serialize tanpa ubah) identik.
type field struct {
	id    string
	value string
}

// Parse memecah payload EMVCo jadi daftar field terurut. Format: tiap
// entri ID(2 digit)+Length(2 digit)+Value(persis Length karakter),
// berulang sampai payload habis.
func Parse(payload string) ([]field, error) {
	var fields []field
	i := 0
	for i < len(payload) {
		if i+4 > len(payload) {
			return nil, errors.New("qris: payload terpotong (ID/panjang tidak lengkap)")
		}
		id := payload[i : i+2]
		length, err := strconv.Atoi(payload[i+2 : i+4])
		if err != nil {
			return nil, fmt.Errorf("qris: panjang field %s bukan angka: %w", id, err)
		}
		start := i + 4
		end := start + length
		if end > len(payload) {
			return nil, fmt.Errorf("qris: field %s menyatakan panjang %d tapi payload habis duluan", id, length)
		}
		fields = append(fields, field{id: id, value: payload[start:end]})
		i = end
	}
	return fields, nil
}

func serialize(fields []field) string {
	var b strings.Builder
	for _, f := range fields {
		fmt.Fprintf(&b, "%s%02d%s", f.id, len(f.value), f.value)
	}
	return b.String()
}

func findField(fields []field, id string) (field, bool) {
	for _, f := range fields {
		if f.id == id {
			return f, true
		}
	}
	return field{}, false
}

// ValidateStatic memastikan payload adalah QRIS statis yang sah: format
// EMVCo valid, tag 00="01" (indikator format), tag 01="11" (statis, BUKAN
// dinamis — mencegah admin tanpa sadar menyimpan QR dinamis kedaluwarsa
// sebagai QRIS klub), dan CRC (tag 63) cocok dgn isi payload sebelumnya.
// Dipanggil sebelum PUT /clubs/{clubId}/qris menyimpan apa pun.
func ValidateStatic(payload string) error {
	fields, err := Parse(strings.TrimSpace(payload))
	if err != nil {
		return err
	}
	fmt2, ok := findField(fields, tagPayloadFormat)
	if !ok || fmt2.value != "01" {
		return errors.New("qris: bukan payload EMVCo QR Code (tag 00 hilang atau bukan '01')")
	}
	poi, ok := findField(fields, tagPointOfInitiation)
	if !ok {
		return errors.New("qris: tag 01 (point of initiation) tidak ada")
	}
	if poi.value != pointOfInitiationStatic {
		return errors.New("qris: ini QR DINAMIS (tag 01='12'), bukan statis — pindai QRIS statis milik klub, bukan yang sudah berisi nominal")
	}
	return verifyCRC(payload, fields)
}

func verifyCRC(payload string, fields []field) error {
	crcField, ok := findField(fields, tagCRC)
	if !ok || len(crcField.value) != 4 {
		return errors.New("qris: tag 63 (CRC) hilang atau bukan 4 karakter")
	}
	// CRC dihitung atas payload SAMPAI DAN TERMASUK "6304" (ID+panjang
	// tag CRC itu sendiri), TIDAK termasuk 4 digit nilai CRC — standar
	// EMVCo, bukan pilihan sewenang-wenang.
	prefix := strings.TrimSuffix(payload, crcField.value)
	want := fmt.Sprintf("%04X", crc16CCITT([]byte(prefix)))
	if !strings.EqualFold(want, crcField.value) {
		return fmt.Errorf("qris: CRC tidak cocok (payload rusak atau bukan QRIS asli) — dapat %s, hitung %s", crcField.value, want)
	}
	return nil
}

// ToDynamic menyuntikkan nominal (rupiah, integer — invarian §3.1 tidak
// pernah float) ke payload statis: tag 01 → "12" (dinamis), tag 54 diisi/
// ditimpa, field lain dipertahankan apa adanya, field terurut ID menaik
// (konvensi EMVCo umum), CRC dihitung ulang di akhir (§9.6 "selalu dibuat
// ulang, tag kedaluwarsa eksplisit" — kedaluwarsanya sendiri kolom
// qris_dynamic_events.expires_at di DB, bukan di dalam payload, karena
// EMVCo tidak punya tag TTL baku yang didukung luas aplikasi bank).
func ToDynamic(staticPayload string, amountRupiah int64) (string, error) {
	if amountRupiah <= 0 {
		return "", errors.New("qris: amount harus lebih dari 0")
	}
	if err := ValidateStatic(staticPayload); err != nil {
		return "", err
	}
	fields, err := Parse(strings.TrimSpace(staticPayload))
	if err != nil {
		return "", err
	}

	out := make([]field, 0, len(fields)+1)
	hasAmount := false
	for _, f := range fields {
		switch f.id {
		case tagPointOfInitiation:
			out = append(out, field{id: tagPointOfInitiation, value: pointOfInitiationDyn})
		case tagTransactionAmount:
			out = append(out, field{id: tagTransactionAmount, value: strconv.FormatInt(amountRupiah, 10)})
			hasAmount = true
		case tagCRC:
			// dilewati — ditambahkan lagi di akhir setelah CRC dihitung ulang.
		default:
			out = append(out, f)
		}
	}
	if !hasAmount {
		out = append(out, field{id: tagTransactionAmount, value: strconv.FormatInt(amountRupiah, 10)})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].id < out[j].id })

	withoutCRC := serialize(out) + tagCRC + "04"
	crc := fmt.Sprintf("%04X", crc16CCITT([]byte(withoutCRC)))
	return withoutCRC + crc, nil
}

// crc16CCITT — CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, tanpa
// refin/refout, xorout 0), varian yang dipakai spesifikasi QRIS/EMVCo.
// Nilai cek standarnya crc16CCITT([]byte("123456789")) == 0x29B1 (diuji
// di qris_test.go) — memverifikasi algoritmanya sendiri lepas dari detail
// QRIS, karena tidak ada vektor uji QRIS asli yang bisa dipastikan benar
// tanpa alat eksternal.
func crc16CCITT(data []byte) uint16 {
	var crc uint16 = 0xFFFF
	for _, b := range data {
		crc ^= uint16(b) << 8
		for i := 0; i < 8; i++ {
			if crc&0x8000 != 0 {
				crc = (crc << 1) ^ 0x1021
			} else {
				crc <<= 1
			}
		}
	}
	return crc
}
