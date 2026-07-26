/**
 * Kompresi foto di browser sebelum dikirim ke server.
 *
 * Foto dari kamera iPhone gampang 3–5 MB (dan kadang HEIC), padahal kolom
 * `players.photo` cuma nampung data URL <= 700.000 char. Dulu file segitu
 * langsung ditolak di client ("Foto maks 500KB") — praktis bikin ambil foto
 * dari HP mustahil. Sekarang fotonya di-resize + di-recompress dulu, jadi
 * user boleh pilih file sebesar apa pun (sampai HARD_LIMIT) dan hasil
 * akhirnya dijamin muat.
 *
 * Output selalu JPEG — sekalian nurunin format yang gak didukung server
 * (HEIC/HEIF dari iOS) selama browsernya bisa men-decode gambarnya.
 */

/** Sisi terpanjang hasil akhir. Avatar terbesar 64px @3x di kartu share. */
const MAX_DIM = 512;

/** Batas panjang data URL. Server tolak > 700.000; sisakan margin. */
const MAX_DATA_URL = 600_000;

/** Tolak lebih awal sebelum decode — cegah tab mati kena file raksasa. */
const HARD_LIMIT = 40 * 1024 * 1024;

const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35];

export class ImageCompressError extends Error {}

/** Decode file jadi sumber gambar yang bisa digambar ke canvas. */
async function decode(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  // createImageBitmap lebih hemat memori buat foto besar, dan
  // `imageOrientation` bikin EXIF rotate dari kamera HP kebaca benar.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // opsi imageOrientation belum ada di sebagian Safari → coba tanpa opsi
      try {
        return await createImageBitmap(file);
      } catch {
        // jatuh ke <img>
      }
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new ImageCompressError("Format foto tidak didukung browser ini"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function draw(
  src: CanvasImageSource & { width: number; height: number },
  maxDim: number,
): HTMLCanvasElement {
  const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageCompressError("Canvas tidak tersedia");

  // JPEG gak punya alpha — PNG transparan tanpa alas jadi hitam.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  return canvas;
}

/**
 * Resize + recompress jadi data URL JPEG yang dijamin <= MAX_DATA_URL.
 * Lempar {@link ImageCompressError} kalau file bukan gambar / gagal decode.
 */
export async function compressPhoto(file: File): Promise<string> {
  if (file.size > HARD_LIMIT) {
    throw new ImageCompressError("Foto kegedean banget (maks 40MB)");
  }

  const src = await decode(file);
  try {
    // Turunin kualitas dulu; kalau mentok baru kecilin dimensinya.
    for (let dim = MAX_DIM; dim >= 128; dim = Math.round(dim / 2)) {
      const canvas = draw(src, dim);
      for (const q of QUALITY_STEPS) {
        const dataUrl = canvas.toDataURL("image/jpeg", q);
        if (dataUrl.length <= MAX_DATA_URL) return dataUrl;
      }
    }
    throw new ImageCompressError("Foto gagal dikompres, coba foto lain");
  } finally {
    if (typeof ImageBitmap !== "undefined" && src instanceof ImageBitmap) src.close();
  }
}
