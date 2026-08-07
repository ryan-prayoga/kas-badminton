package poster

import (
	"bytes"
	"image/png"
	"testing"
)

func TestRender_A4_ProducesValidPNGAndPDF(t *testing.T) {
	out, err := Render(Input{
		ClubName:    "PB Sarjana",
		ShortURL:    "kaskok.my.id/pb-sarjana",
		Instruction: "Pindai buat gabung klub",
		JoinURL:     "https://kaskok.my.id/join/abc123",
		Size:        A4,
	})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}

	img, err := png.Decode(bytes.NewReader(out.PNG))
	if err != nil {
		t.Fatalf("PNG keluaran tidak valid: %v", err)
	}
	wantW, wantH := mmToPx(210), mmToPx(297)
	if img.Bounds().Dx() != wantW || img.Bounds().Dy() != wantH {
		t.Errorf("dimensi PNG A4 = %dx%d, mau %dx%d (300dpi)", img.Bounds().Dx(), img.Bounds().Dy(), wantW, wantH)
	}

	if !bytes.HasPrefix(out.PDF, []byte("%PDF-")) {
		t.Error("keluaran PDF tidak berawalan %PDF- — bukan PDF valid")
	}
	if len(out.PDF) < 1000 {
		t.Errorf("PDF terlalu kecil (%d byte) buat berisi gambar penuh-halaman", len(out.PDF))
	}
}

func TestRender_A5_LebihKecilDariA4(t *testing.T) {
	a4, err := Render(Input{ClubName: "X", JoinURL: "https://x.test/join/x", Size: A4})
	if err != nil {
		t.Fatalf("render A4: %v", err)
	}
	a5, err := Render(Input{ClubName: "X", JoinURL: "https://x.test/join/x", Size: A5})
	if err != nil {
		t.Fatalf("render A5: %v", err)
	}

	imgA4, _ := png.Decode(bytes.NewReader(a4.PNG))
	imgA5, _ := png.Decode(bytes.NewReader(a5.PNG))
	if imgA5.Bounds().Dx() >= imgA4.Bounds().Dx() {
		t.Errorf("lebar A5 (%d) harus lebih kecil dari A4 (%d)", imgA5.Bounds().Dx(), imgA4.Bounds().Dx())
	}
}

func TestRender_WajibClubNameDanJoinURL(t *testing.T) {
	if _, err := Render(Input{JoinURL: "https://x.test"}); err == nil {
		t.Error("ClubName kosong seharusnya galat")
	}
	if _, err := Render(Input{ClubName: "X"}); err == nil {
		t.Error("JoinURL kosong seharusnya galat")
	}
}
