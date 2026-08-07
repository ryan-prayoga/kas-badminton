package qris

import (
	"testing"
)

// buildStatic — payload QRIS statis minimal tapi valid secara TLV,
// dirakit dari fields+serialize+crc16CCITT paket ini sendiri (white-box,
// package qris bukan qris_test) karena tidak ada vektor uji QRIS asli
// yang bisa dipastikan benar tanpa alat eksternal (lihat komentar
// crc16CCITT di qris.go).
func buildStatic(t *testing.T, extra ...field) string {
	t.Helper()
	fields := []field{
		{id: "00", value: "01"},
		{id: "01", value: "11"},
		{id: "53", value: "360"}, // currency code IDR
		{id: "58", value: "ID"},  // country code
		{id: "59", value: "KLUB BADMINTON TEST"},
	}
	fields = append(fields, extra...)
	withoutCRC := serialize(fields) + "6304"
	crc := crc16CCITT([]byte(withoutCRC))
	return withoutCRC + hex4(crc)
}

func hex4(v uint16) string {
	const hexdigits = "0123456789ABCDEF"
	return string([]byte{
		hexdigits[(v>>12)&0xF], hexdigits[(v>>8)&0xF], hexdigits[(v>>4)&0xF], hexdigits[v&0xF],
	})
}

func TestCRC16CCITT_StandardCheckValue(t *testing.T) {
	// Nilai cek baku CRC-16/CCITT-FALSE dari katalog CRC RevEng —
	// memverifikasi algoritmanya sendiri, lepas dari QRIS.
	got := crc16CCITT([]byte("123456789"))
	if got != 0x29B1 {
		t.Fatalf("crc16CCITT(123456789) = %04X, mau 29B1", got)
	}
}

func TestValidateStatic_AcceptsWellFormedPayload(t *testing.T) {
	payload := buildStatic(t)
	if err := ValidateStatic(payload); err != nil {
		t.Fatalf("ValidateStatic payload valid = %v, mau nil", err)
	}
}

func TestValidateStatic_RejectsTamperedCRC(t *testing.T) {
	payload := buildStatic(t)
	tampered := payload[:len(payload)-4] + "0000"
	if err := ValidateStatic(tampered); err == nil {
		t.Fatal("ValidateStatic payload dgn CRC ditempel salah harus gagal")
	}
}

func TestValidateStatic_RejectsAlreadyDynamic(t *testing.T) {
	// ToDynamic sendiri yang dipakai buat menghasilkan payload dinamis
	// ber-CRC valid — cara paling aman dapat fixture "dinamis yang sah"
	// tanpa merakit CRC manual dua kali.
	dynamic, err := ToDynamic(buildStatic(t), 15000)
	if err != nil {
		t.Fatalf("ToDynamic: %v", err)
	}
	if err := ValidateStatic(dynamic); err == nil {
		t.Fatal("ValidateStatic terhadap payload yang SUDAH dinamis (tag 01=12) harus ditolak")
	}
}

func TestValidateStatic_RejectsGarbage(t *testing.T) {
	if err := ValidateStatic("bukan-qris-sama-sekali"); err == nil {
		t.Fatal("ValidateStatic teks acak harus gagal")
	}
}

func TestToDynamic_InjectsAmountAndRecomputesCRC(t *testing.T) {
	static := buildStatic(t)
	dynamic, err := ToDynamic(static, 25000)
	if err != nil {
		t.Fatalf("ToDynamic: %v", err)
	}

	fields, err := Parse(dynamic)
	if err != nil {
		t.Fatalf("Parse hasil ToDynamic: %v", err)
	}
	if err := verifyCRC(dynamic, fields); err != nil {
		t.Fatalf("CRC hasil ToDynamic tidak valid: %v", err)
	}
	poi, _ := findField(fields, tagPointOfInitiation)
	if poi.value != "12" {
		t.Fatalf("tag 01 hasil ToDynamic = %q, mau 12", poi.value)
	}
	amount, ok := findField(fields, tagTransactionAmount)
	if !ok || amount.value != "25000" {
		t.Fatalf("tag 54 hasil ToDynamic = %+v, mau 25000", amount)
	}
	// Field lain (merchant name, dst) tetap ada apa adanya.
	name, ok := findField(fields, "59")
	if !ok || name.value != "KLUB BADMINTON TEST" {
		t.Fatalf("tag 59 hilang/berubah setelah ToDynamic: %+v", name)
	}
}

func TestToDynamic_OverwritesExistingAmountField(t *testing.T) {
	static := buildStatic(t, field{id: "54", value: "999"}) // seharusnya tak pernah ada di statis, tapi kalau ada harus ditimpa bukan diduplikasi
	dynamic, err := ToDynamic(static, 5000)
	if err != nil {
		t.Fatalf("ToDynamic: %v", err)
	}
	fields, _ := Parse(dynamic)
	count := 0
	for _, f := range fields {
		if f.id == tagTransactionAmount {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("jumlah tag 54 setelah ToDynamic = %d, mau 1 (tidak boleh dobel)", count)
	}
	amount, _ := findField(fields, tagTransactionAmount)
	if amount.value != "5000" {
		t.Fatalf("tag 54 = %q, mau 5000 (menimpa, bukan menambah)", amount.value)
	}
}

func TestToDynamic_RejectsNonPositiveAmount(t *testing.T) {
	static := buildStatic(t)
	if _, err := ToDynamic(static, 0); err == nil {
		t.Fatal("ToDynamic amount=0 harus ditolak")
	}
	if _, err := ToDynamic(static, -100); err == nil {
		t.Fatal("ToDynamic amount negatif harus ditolak")
	}
}

func TestParse_RejectsTruncatedPayload(t *testing.T) {
	// tag "00" menyatakan panjang 4, tapi cuma "01" (2 karakter) tersisa.
	if _, err := Parse("000401"); err == nil {
		t.Fatal("payload terpotong (panjang field lebih besar dari sisa string) harus gagal parse")
	}
}

func TestParse_RoundTripsSerialize(t *testing.T) {
	payload := buildStatic(t)
	fields, err := Parse(payload)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if got := serialize(fields); got != payload {
		t.Fatalf("serialize(Parse(payload)) != payload asli\n got: %s\nwant: %s", got, payload)
	}
}
