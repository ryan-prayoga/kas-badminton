// Package poster merender poster QR klub (PLAN.md §6.4, §4.4) — satu
// fungsi Go menggambar layout SEKALI ke kanvas raster 300dpi, lalu:
//   - diekspor langsung jadi PNG (buat dibagikan ke grup WA), dan
//   - ditempelkan utuh sebagai satu gambar penuh-halaman ke PDF (buat cetak).
//
// SENGAJA satu jalur render, bukan dua (satu ke PDF, satu ke gambar) —
// begitu ada dua jalur, keduanya cepat/lambat beda tata letak tanpa ada
// yang sadar (§4.4). Ditolak sengaja: HTML→PDF lewat Chrome headless —
// itu proses eksternal, melanggar "satu binary" (§4.1).
package poster

import (
	"bytes"
	_ "embed"
	"fmt"
	"image/color"
	stdpng "image/png"

	"github.com/fogleman/gg"
	"github.com/go-pdf/fpdf"
	"github.com/golang/freetype/truetype"
	qrcode "github.com/skip2/go-qrcode"
	"golang.org/x/image/font"
)

//go:embed fonts/ArchivoBlack-Regular.ttf
var fontDisplayBytes []byte

//go:embed fonts/HankenGrotesk.ttf
var fontBodyBytes []byte

// Ukuran kertas didukung (§6.4: "Ukuran A4 dan A5").
type Size string

const (
	A4 Size = "a4"
	A5 Size = "a5"
)

// Input — semua yang ditampilkan poster (§6.4: "nama klub, QR besar, alamat
// pendek yang bisa diketik manual, dan satu kalimat instruksi").
type Input struct {
	ClubName    string
	ShortURL    string // mis. "kaskok.my.id/pb-sarjana" — bisa diketik manual
	Instruction string // satu kalimat, mis. "Pindai buat gabung klub"
	JoinURL     string // isi QR — URL lengkap https://...
	Size        Size
}

// Output — PNG dan PDF SELALU identik piksel demi piksel karena satu-
// satunya kode tata letak yang ada cuma Render (lihat komentar paket).
type Output struct {
	PNG []byte
	PDF []byte
}

const dpi = 300.0

// mmToPx — konversi milimeter kertas ke piksel kanvas di resolusi cetak.
func mmToPx(mm float64) int {
	return int(mm / 25.4 * dpi)
}

// Token warna dari mockup/index.html (§5.3) — poster pakai identitas
// visual yang sama dengan app, bukan palet sendiri.
var (
	colorInk    = color.RGBA{0x10, 0x14, 0x1c, 0xff} // --ink
	colorSoft   = color.RGBA{0x4a, 0x54, 0x64, 0xff} // --ink-soft
	colorAccent = color.RGBA{0x14, 0x47, 0xe6, 0xff} // --accent
	colorLine   = color.RGBA{0xe2, 0xe5, 0xea, 0xff} // --line
)

func paperSizeMM(size Size) (w, h float64) {
	if size == A5 {
		return 148, 210
	}
	return 210, 297 // A4, bawaan
}

// Font di-parse SEKALI di startup (init), bukan tiap panggilan Render —
// truetype.Parse cukup mahal (parsing glyf/cmap dari ~100-200KB), dan
// endpoint poster (clubs_links.go) mungkin dipanggil berkali-kali per
// permintaan poster admin.
var (
	fontDisplayParsed *truetype.Font
	fontBodyParsed    *truetype.Font
)

func init() {
	var err error
	if fontDisplayParsed, err = truetype.Parse(fontDisplayBytes); err != nil {
		panic(fmt.Sprintf("poster: parse font display: %v", err))
	}
	if fontBodyParsed, err = truetype.Parse(fontBodyBytes); err != nil {
		panic(fmt.Sprintf("poster: parse font body: %v", err))
	}
}

func newFace(f *truetype.Font, points float64) font.Face {
	return truetype.NewFace(f, &truetype.Options{
		Size:    points,
		DPI:     dpi,
		Hinting: font.HintingFull,
	})
}

// Render menggambar poster SEKALI ke kanvas raster, mengembalikan PNG+PDF
// identik piksel demi piksel (§6.4, §4.4).
func Render(in Input) (*Output, error) {
	if in.ClubName == "" || in.JoinURL == "" {
		return nil, fmt.Errorf("poster: ClubName dan JoinURL wajib diisi")
	}

	wMM, hMM := paperSizeMM(in.Size)
	wPx, hPx := mmToPx(wMM), mmToPx(hMM)
	margin := float64(mmToPx(16))

	dc := gg.NewContext(wPx, hPx)
	dc.SetColor(color.White)
	dc.Clear()

	cx := float64(wPx) / 2

	// --- header: garis aksen tipis di atas, nama klub besar ---
	dc.SetColor(colorAccent)
	dc.DrawRectangle(margin, margin, float64(wPx)-2*margin, mmToPxF(2.2))
	dc.Fill()

	dc.SetFontFace(newFace(fontDisplayParsed, mmToPt(13)))
	dc.SetColor(colorInk)
	nameY := margin + mmToPxF(26)
	dc.DrawStringWrapped(in.ClubName, cx, nameY, 0.5, 0.5, float64(wPx)-2*margin, 1.1, gg.AlignCenter)

	// --- QR besar, tengah kanvas ---
	qrSize := float64(wPx) - 4*margin
	if maxQR := float64(hPx) * 0.5; qrSize > maxQR {
		qrSize = maxQR
	}
	// Diminta PAS di ukuran target (bukan encode kecil lalu diperbesar) —
	// QR yang diperbesar lewat interpolasi gambar gampang jadi buram di
	// tepi modulnya dan susah dipindai; go-qrcode merender ulang modulnya
	// sendiri di resolusi berapa pun diminta.
	qrPNG, err := qrcode.Encode(in.JoinURL, qrcode.Medium, int(qrSize))
	if err != nil {
		return nil, fmt.Errorf("poster: encode QR: %w", err)
	}
	qrImg, err := stdpng.Decode(bytes.NewReader(qrPNG))
	if err != nil {
		return nil, fmt.Errorf("poster: decode QR: %w", err)
	}
	qrX := cx - qrSize/2
	qrY := mmToPxF(55)

	// Bingkai tipis di sekeliling QR — bukan bayangan (§5.3: bayangan cuma
	// buat elemen yang benar-benar mengambang, poster itu datar).
	dc.SetColor(colorLine)
	dc.SetLineWidth(mmToPxF(0.4))
	dc.DrawRectangle(qrX-mmToPxF(3), qrY-mmToPxF(3), qrSize+mmToPxF(6), qrSize+mmToPxF(6))
	dc.Stroke()

	dc.DrawImageAnchored(qrImg, int(cx), int(qrY+qrSize/2), 0.5, 0.5)

	// --- instruksi ---
	dc.SetFontFace(newFace(fontBodyParsed, mmToPt(6)))
	dc.SetColor(colorInk)
	instrY := qrY + qrSize + mmToPxF(14)
	instr := in.Instruction
	if instr == "" {
		instr = "Pindai buat gabung klub"
	}
	dc.DrawStringWrapped(instr, cx, instrY, 0.5, 0.5, float64(wPx)-2*margin, 1.3, gg.AlignCenter)

	// --- alamat pendek, bisa diketik manual kalau kamera bermasalah ---
	dc.SetFontFace(newFace(fontDisplayParsed, mmToPt(7)))
	dc.SetColor(colorAccent)
	urlY := instrY + mmToPxF(14)
	dc.DrawStringAnchored(in.ShortURL, cx, urlY, 0.5, 0.5)

	// --- footer kecil ---
	dc.SetFontFace(newFace(fontBodyParsed, mmToPt(3.5)))
	dc.SetColor(colorSoft)
	dc.DrawStringAnchored("Kok Badminton", cx, float64(hPx)-margin, 0.5, 0.5)

	var pngBuf bytes.Buffer
	if err := dc.EncodePNG(&pngBuf); err != nil {
		return nil, fmt.Errorf("poster: encode PNG: %w", err)
	}

	pdfBytes, err := embedAsPDF(pngBuf.Bytes(), wMM, hMM)
	if err != nil {
		return nil, err
	}

	return &Output{PNG: pngBuf.Bytes(), PDF: pdfBytes}, nil
}

// embedAsPDF menempel PNG yang SAMA sebagai satu gambar penuh-halaman
// (§4.4) — bukan menggambar ulang lewat jalur berbeda.
func embedAsPDF(pngBytes []byte, wMM, hMM float64) ([]byte, error) {
	pdf := fpdf.NewCustom(&fpdf.InitType{
		OrientationStr: "P",
		UnitStr:        "mm",
		Size:           fpdf.SizeType{Wd: wMM, Ht: hMM},
	})
	pdf.AddPage()
	opt := fpdf.ImageOptions{ImageType: "PNG", ReadDpi: true}
	pdf.RegisterImageOptionsReader("poster", opt, bytes.NewReader(pngBytes))
	pdf.ImageOptions("poster", 0, 0, wMM, hMM, false, opt, 0, "")
	if err := pdf.Error(); err != nil {
		return nil, fmt.Errorf("poster: susun PDF: %w", err)
	}
	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, fmt.Errorf("poster: tulis PDF: %w", err)
	}
	return buf.Bytes(), nil
}

func mmToPxF(mm float64) float64 { return mm / 25.4 * dpi }

// mmToPt — ukuran FONT (truetype.Options.Size) dipatok dalam poin, bukan
// piksel (pixel = poin × DPI/72, dihitung freetype sendiri). Dikonversi
// dari mm tinggi huruf yang diinginkan supaya tetap "mikir dalam mm" sama
// seperti seluruh tata letak lain di berkas ini — DPI ikut habis dibagi,
// hasilnya tidak tergantung resolusi kanvas.
func mmToPt(mm float64) float64 { return mm * 72.0 / 25.4 }
