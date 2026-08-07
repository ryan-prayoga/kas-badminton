# Kok Badminton v3 — Rencana Pembangunan

Platform multi-klub untuk kas patungan kok badminton.
**SvelteKit + Go · akun per pemain · verifikasi WhatsApp · deposit · multi-klub.**

Status: **rencana, belum ada kode.** Dokumen ini adalah spesifikasi kerja.

---

## 0. Cara memakai dokumen ini

Dokumen ini ditulis untuk dieksekusi oleh orang atau model yang **belum pernah
melihat percakapan perancangannya**. Seluruh arah sudah diputuskan dan tidak perlu
ditanyakan ulang. Yang tersisa hanya angka bawaan yang boleh disetel — dikumpulkan
di §17.

Urutan membaca kalau baru pertama kali:

1. **§1 Latar** — kenapa v3 ada, dan apa yang salah dengan v2
2. **§2 Keputusan terkunci** — jangan diubah tanpa alasan baru
3. **§3 Invarian** — aturan yang tidak boleh dilanggar di baris kode mana pun
4. **§14 Fase kerja** — urutan pengerjaan, mulai dari F0

### Berkas pendamping

| Berkas | Isi | Status |
|---|---|---|
| [`DDL.sql`](DDL.sql) | Skema lengkap: 35 tabel, 89 indeks, RLS, trigger saldo | **Sudah diuji jalan** di Postgres 16 |
| [`mockup/index.html`](mockup/index.html) | Referensi visual "sport editorial" — Beranda & Tagihan, HP + desktop, terang + gelap | Acuan rasa, bukan kode produksi |

`DDL.sql` bukan sketsa. Ia sudah dijalankan di database bersih dan tiga perilaku
kritisnya diverifikasi: saldo minus **ditolak database** (bukan cuma ditolak kode),
RLS mengisolasi klub **pada koneksi yang dipakai ulang**, dan query tanpa
`SET LOCAL app.club_id` mengembalikan **nol baris — gagal menutup, bukan
membocorkan**.

**Lingkup MVP: F0–F5.** Sampai situ sudah jadi app yang berguna untuk satu klub
(identitas, catat main, tagihan, offline). F6–F10 melengkapi dan membuka
multi-klub secara penuh. Kalau pengerjaan harus berhenti di tengah, berhenti di
batas fase, jangan di tengah fase.

Aturan penting saat mengeksekusi:

- **v2 adalah acuan fungsional, bukan acuan visual.** Ambil daftar kemampuan dan
  logika uang yang sudah teruji. Jangan menyalin tata letak, penamaan, hierarki,
  warna, atau tipografinya — semuanya dirancang ulang (§5).
- **Jangan menyentuh `v2/` sama sekali.** v2 tetap jalan produksi sampai cutover.
- Berkas v2 yang dirujuk di dokumen ini ada di repo yang sama dan bisa dibuka
  langsung — path-nya relatif ke akar repo.

---

## 1. Latar

v2 (`v2/`, Next.js 16 + Prisma + Postgres) sudah jalan produksi dan fiturnya
lengkap. Empat hal mendorong rewrite:

**1. Terasa berat dan sering macet sebagai PWA.** Penyebabnya arsitektur, bukan
pilihan framework:

- Tiap mutasi memanggil `revalidatePath("/", "layout")` — lihat
  [`v2/lib/action-util.ts`](../v2/lib/action-util.ts).
- `getData()` memuat **seluruh** game dan turnamen dari DB tiap request, lalu
  seluruh halaman dirender ulang — lihat [`v2/lib/data.ts`](../v2/lib/data.ts)
  dan [`v2/lib/repo/snapshot.ts`](../v2/lib/repo/snapshot.ts).
- SSE cuma mengirim string `"update"`, dan klien menanggapinya dengan
  `router.refresh()` penuh — lihat
  [`v2/components/realtime-refresher.tsx`](../v2/components/realtime-refresher.tsx).

Akibatnya menandai satu orang lunas menyeret payload seluruh aplikasi.
**Mengganti bahasa tidak menyembuhkan ini.** v3 memperbaikinya di level desain
(§4).

**2. Tidak ada akun pemain.** Semua orang melihat data semua orang. Tidak ada
"tagihanku" atau "statistikku".

**3. Semua kewenangan menumpuk di satu admin.** Tidak ada pemisahan pencatat,
bendahara, dan verifikator.

**4. Hanya melayani satu klub.** v3 dibuka jadi platform supaya PB lain bisa
memakai sistem yang sama.

Tambahan lingkup baru: identitas berbasis nomor WhatsApp, dompet deposit per
pemain, format main yang tidak lagi mengunci di 4 orang, dan desain ulang total.

---

## 2. Keputusan yang sudah terkunci

| Hal | Keputusan |
|---|---|
| Backend | **Go** |
| Frontend | **SvelteKit 5** (SPA statis, di-embed ke binary Go) |
| Database | **PostgreSQL** (instans sama dengan v2, database terpisah `kok_v3`) |
| Akses DB | **sqlc + pgx**, tanpa ORM. Migrasi skema pakai **goose** |
| Multi-klub | **Ya sejak awal**, dengan **superadmin** tingkat sistem |
| Domain | **`kaskok.my.id`**; app di `app.kaskok.my.id`, tautan klub `/{slug}` |
| Superadmin | Kelola klub + metrik, **tanpa akses isi data klub** |
| Halaman publik | **Opsional per klub**, read-only, tanpa data pribadi |
| Transparansi kas | **Terbuka** — saldo kas, masuk, keluar terlihat semua orang. **Saklar per klub**, default nyala |
| Saldo deposit per orang | **Selalu privat.** Tidak pernah tampil di halaman publik, apa pun posisi saklar transparansi kas. Hanya pemiliknya, bendahara, dan admin klub yang bisa melihat |
| Ambang tunggakan | **Diatur per klub** (hari + rupiah), dengan bawaan 14 hari & Rp 50.000 |
| Kuota | **Longgar dan bisa dinaikkan** superadmin per klub — kecuali kuota pesan WA, yang batas platform |
| Retensi data | **Soft-delete + tenggang 30 hari**, lalu hapus permanen. Klub yang ditangguhkan tidak pernah dihapus otomatis |
| QR tembok | **Ada** — poster siap cetak per klub, mengarah ke halaman klub |
| Verifikasi identitas | **Nomor WA wajib**, dikirim lewat **whatsmeow** (nomor bot sudah tersedia) |
| Login harian | **Passkey (WebAuthn)** + **PIN 6 digit** cadangan. Bukan OTP tiap login |
| Notifikasi | **Web Push utama**, WA hanya yang jarang & penting |
| Identitas | Nama tampilan bebas + **username unik**; nama lama v2 jadi alias |
| Klaim akun lama | QR/tautan grup, undangan admin per-orang, dan klaim mandiri — semua lewat persetujuan |
| Peran | **Opsional**, boleh **berbatas waktu**; izin tak ditunjuk jatuh ke admin klub |
| Format main | **Fleksibel** — single, ganda, atau rotasi. Bukan kunci 4 orang |
| Penanggung biaya | **`payer_id` terpisah dari `user_id`** — bisa dibayarin orang lain; pencatat bebas menetapkan |
| Skor main harian | **Opsional.** Tiga format: sampai 30, rally 21 bo3, dan **rally 42 pindah tempat di 21** (tarkam) |
| Papan peringkat | Ada begitu skor dicatat; **saklar per klub**, default nyala |
| Taruhan | Kok = preset penanggung. Barang (Pocari dll) = ledger terpisah, **tanpa rupiah, tak menyentuh kas** |
| Deposit | **Terpisah per klub.** Potong otomatis (bisa dimatikan per pemain), **tidak boleh minus** |
| Pembagian biaya | **Dibulatkan ke atas ke ratusan rupiah**; kelebihannya masuk kas, dicatat sebagai "pembulatan" |
| Urutan potong otomatis | **Best-fit**, algoritma yang sama dengan cicilan v2; berjalan **seketika** dalam transaksi yang sama |
| Lingkup angka di Beranda | **Klub yang sedang aktif**, bukan gabungan lintas klub |
| Target skala | **~10 klub, ~300 orang** — tanpa keputusan yang mengunci di skala itu |
| Offline | **Baca offline + antrean tulis** |
| Arah visual | **Sport editorial** — hierarki ekstrem, angka sebagai elemen terbesar |
| Gerak | Beranggaran, maksimum 300ms, hanya `transform`/`opacity`. **Tanpa `backdrop-blur`** |
| Panduan awam | **driver.js**, dimuat malas, sekali per panduan, selalu bisa dilewati |
| Pemain tamu | Boleh dicatat tanpa akun — jadi anggota `unclaimed` yang bisa diklaim nanti |
| Salah catat | **Batalkan cepat** 8 detik untuk pencatat; **sanggahan** untuk yang dicatat |
| Nada bicara | Santai, sapa "kamu", tunggakan disebut netral. Teks UI terkumpul di satu tempat |
| Aksi massal | Ada untuk bendahara, dengan konfirmasi bernominal dan **tidak boleh diantre offline** |
| Layar utama | **Tagihanku dulu** |
| QRIS | Statis sebagai default; dinamis jadi jalur cepat opsional |
| Rekening bank | Ditunda, tidak masuk lingkup sekarang |
| Data v2 | **Migrasi penuh**, jadi klub pertama |
| Cutover | **Maju terus, tanpa jalur pulang** — bertumpu latihan berulang + cadangan teruji |
| Hosting | VPS yang sama (Oracle Ampere, arm64), subdomain berbeda, berdampingan dengan v2 |
| v1 (Express di akar repo) | **Dimatikan** saat cutover |

---

## 3. Invarian — tidak boleh dilanggar

Empat aturan ini berlaku di seluruh basis kode. Pelanggarannya adalah bug, bukan
selera.

1. **Uang selalu `int64` rupiah.** Tidak pernah `float`, di mana pun, termasuk di
   klien dan di JSON. Rupiah tidak punya pecahan yang dipakai di sini.
2. **Setiap query menerima `club_id`.** Tanpa pengecualian. Ini yang menjaga data
   klub tidak bocor ke klub lain.
3. **Setiap endpoint tulis menerima `Idempotency-Key`.** Server menyimpan kunci
   beserta hasilnya; permintaan ulang dengan kunci sama mengembalikan hasil yang
   sama, bukan membuat entri kedua. Tanpa ini, satu tap "sudah transfer" di
   jaringan buruk bisa menciptakan uang.
4. **Setiap entitas yang bisa diedit punya `version`.** Permintaan tulis
   menyertakan versi yang dilihat klien; kalau sudah berubah, server menolak
   dengan `409` beserta keadaan terbaru. Jangan pernah menimpa diam-diam.

---

## 4. Arsitektur

```
v3/
├── web/                     SvelteKit 5 (runes) + Tailwind 4 → static bundle
│   ├── src/lib/api/         klien REST + tipe hasil generate dari OpenAPI
│   ├── src/lib/stores/      state ternormalisasi + optimistic
│   ├── src/lib/offline/     cermin IndexedDB + outbox tulis
│   ├── src/lib/ui/          design system (komponen sendiri di atas Melt UI)
│   └── src/routes/
├── server/                  Go 1.24
│   ├── cmd/api/             HTTP server
│   ├── cmd/waworker/        proses tunggal pemegang koneksi whatsmeow
│   ├── cmd/migrate-v2/      migrasi satu kali dari DB v2
│   ├── internal/domain/     logika murni (cost, debt, wallet, bracket, stock) + test
│   ├── internal/store/      sqlc + pgx
│   ├── internal/http/       handler, middleware auth/tenant/RBAC, SSE
│   ├── internal/auth/       passkey, PIN, sesi, OTP
│   ├── internal/media/      foto & QRIS di volume disk
│   ├── internal/poster/     render poster QR klub (PDF cetak + PNG)
│   ├── internal/push/       Web Push (VAPID)
│   └── internal/notify/     router notifikasi: pilih Push atau WA per kejadian
└── deploy/                  Dockerfile multi-stage, compose, workflow CI
```

### 4.1 Kenapa SPA statis di-embed ke binary

Frontend dibangun dengan `@sveltejs/adapter-static` dan dimasukkan ke binary Go
lewat `go:embed`.

- Deploy jadi **satu binary** — tidak ada runtime Node di server.
- **Tidak ada payload SSR per navigasi** — ini kelas masalah utama v2.
  Pindah tab = ganti komponen di memori, nol request.
- Service worker bisa mem-precache seluruh shell → app dari home screen langsung
  tampil, data menyusul.
- SEO tidak relevan; semua di balik login kecuali halaman publik klub.

Konsekuensi: layar pertama butuh JS. Ditangani dengan bundle kecil dan skeleton
di HTML.

Kalau nanti ada alasan kuat butuh SSR, `adapter-node` bisa ditukar **tanpa
mengubah backend** — Go hanya bicara JSON.

### 4.2 Kenapa ini akan terasa lebih cepat

Bukan karena Go. Karena lima hal berikut:

| Masalah v2 | Penanganan v3 |
|---|---|
| `getData()` memuat semua game + turnamen tiap request | Endpoint granular + paginasi; daftar main dimuat per bulan |
| `revalidatePath("/", "layout")` tiap mutasi | Mutasi mengembalikan **entitas yang berubah saja**; store klien menambal lokal |
| SSE cuma mengirim `"update"` → klien refresh penuh | Event bertipe `{kind, id, payload}` → store menambal tanpa refetch |
| Navigasi = round-trip RSC | Navigasi client-side, nol request |
| Buka app dingin = layar kosong sampai DB menjawab | Cermin IndexedDB; isi terakhir langsung tampil, lalu disegarkan |

**Target skala:** sekitar **10 klub dan 300 orang**. Angka ini bukan pembatas
ambisi, tapi penentu apa yang boleh dianggap cukup. Pada skala ini satu VPS
santai, dan tidak perlu cache berlapis, sharding, atau antrean pekerjaan yang
rumit. **Yang tetap tidak boleh** adalah keputusan yang mengunci di skala kecil:
menghitung agregat di memori dari seluruh tabel, daftar tanpa paginasi, atau query
tanpa indeks — persis kesalahan yang membuat v2 terasa berat. Naik ke skala
berikutnya harus jadi soal menambah mesin, bukan membongkar rancangan.

**Anggaran performa, ditegakkan sejak F5 dan diukur bukan diasumsikan:**

- Shell < 80KB gzip
- Interaksi < 100ms
- Aksi lokal (mis. tandai lunas) **nol round-trip** sebelum UI berubah

### 4.3 Realtime

Postgres `LISTEN/NOTIFY` → fan-out ke pelanggan SSE. Tanpa Redis, aman lintas
proses. Pola v2 di [`v2/lib/realtime.ts`](../v2/lib/realtime.ts) sudah benar —
tiru strukturnya, ganti payloadnya jadi bertipe.

---

## 5. Desain

Dirancang dari kebutuhan pengguna, bukan dari tampilan v2.

### 5.1 Siapa, di mana, dalam keadaan apa

- **Anggota** — membuka app 10 detik sambil berdiri di pinggir lapangan, tangan
  berkeringat, satu tangan memegang raket, layar kena cahaya terang. Yang dicari
  satu hal: *aku utang berapa, dan gimana bayarnya.*
- **Pencatat** — mencatat pertandingan di sela main. Harus selesai dalam belasan
  detik atau tidak akan dilakukan sama sekali.
- **Bendahara** — duduk di rumah dengan laptop, menyisir siapa yang belum bayar.
  Butuh kepadatan informasi dan ketelitian.
- **Orang baru** — memindai QR di tembok GOR, belum tahu apa-apa. Harus paham
  dalam sekali lihat ini apa dan harus berbuat apa.

### 5.2 Prinsip

1. **Satu hal dominan per layar.** Tiap layar menjawab satu pertanyaan. Angka
   terpenting jadi elemen terbesar, bukan salah satu dari sepuluh kartu seukuran.
2. **Terbaca sambil berdiri.** Teks minimum 13px, kontras semua teks ≥ 4.5:1.
   Tidak ada abu-abu tipis 10–11px — kebiasaan buruk v2 yang gagal syarat AA.
3. **Uang tidak menghakimi.** Tunggakan adalah fakta, bukan alarm. Merah **hanya**
   untuk tindakan merusak (hapus). Warna "belum bayar" adalah netral-hangat yang
   berarti "belum selesai", bukan "kamu salah".
4. **Aksi utama di jangkauan jempol** — bawah layar, bukan pojok atas.
5. **Nol tunggu yang terasa.** Tiap aksi mengubah UI seketika; jaringan menyusul.
6. **Gerak seperlunya.** Animasi memastikan aksi diterima dan menjelaskan
   perpindahan hierarki. Bukan hiasan. Hormati `prefers-reduced-motion`.
7. **Nama benda yang berbeda harus terdengar berbeda.** v2 punya tab "Riwayat",
   "Rekap", dan "Transaksi" yang bunyinya sama bagi orang awam. Jangan diulang.
8. **Layar besar bukan layar kecil yang dilebarkan.** Di laptop, ruang dipakai
   untuk memperlihatkan lebih banyak sekaligus, bukan memperbesar kartu.

### 5.3 Bahasa visual — sport editorial

**Tipografi.** Dua huruf: satu display bergrotesk tebal untuk angka dan judul,
satu teks netral untuk isi. Angka memakai figur tabular supaya kolom rupiah rata.
Skala tegas, bukan bertingkat halus:

| Peran | Ukuran | Pemakaian |
|---|---|---|
| Hero | 48–64px, display, tebal | Angka utama layar (tagihanku, saldo kas) |
| Judul | 20–24px, display | Judul bagian |
| Isi | 15px | Teks umum |
| Meta | 13px | Keterangan, tanggal, label — **batas terkecil** |

**Warna.** Kanvas nyaris netral, satu warna aksen yang dipakai irit supaya tetap
berarti. Peran semantik: `lunas`, `belum`, `hancur` (destruktif), `aksen`. Palet
gelap dirancang bersamaan, bukan diturunkan belakangan.

**Tiap token teks diuji terhadap DUA latar: `surface` dan `bg`.** Ini bukan
kehati-hatian berlebihan — saat menyusun referensi visual, nilai `--ink-faint`
pertama lolos di atas kartu (4.59:1) tapi **gagal di atas latar halaman
(4.21:1)**, dan itu tidak akan pernah ketahuan kalau pengujiannya cuma satu latar.
Meta 13px sering jatuh di kedua tempat. Nilai finalnya ada di
[`mockup/index.html`](mockup/index.html), sudah diverifikasi lolos ≥4.5:1 untuk
seluruh token di kedua tema.

**Ruang & pemisah.** Basis 4px, ritme vertikal lega. Pemisahan lewat ruang dan
garis tipis, bukan bayangan tebal — bayangan disimpan untuk elemen yang benar-benar
mengambang (sheet, dialog).

**Sentuh.** Aksi utama tinggi 52px; target apa pun minimum 44px, ditegakkan lewat
komponen bukan disiplin manual.

**Komponen** dibangun sendiri di atas **Melt UI** (headless, Svelte-native). Satu
sistem tombol, satu sistem kolom isian, satu sistem kartu. v2 punya dua sistem
yang hidup berdampingan (shadcn + Tailwind tulis tangan) sehingga ada tiga
generasi visual dalam satu layar — jangan diulang.

### 5.4 Navigasi

Empat tab, kata benda yang menamai hal berbeda:

| Tab | Menjawab |
|---|---|
| **Beranda** | Aku utang berapa, saldoku berapa, aku main kapan |
| **Main** | Pertandingan klub — daftar, catat baru |
| **Klub** | Anggota, siapa belum bayar, kas, statistik, pengaturan |
| **Turnamen** | Bagan, klasemen, iuran |

Isinya menyesuaikan izin: bendahara melihat pintu masuk "Tagihan & Kas" besar di
Klub dan pintasan "N orang belum bayar" di Beranda; anggota biasa melihat versi
baca-saja. **Jumlah dan nama tabnya tidak berubah** — supaya orang tidak bingung
saat perannya berubah.

Profil, pemilih klub, dan pengaturan ada di avatar pojok header, bukan memakan
slot tab.

**Pencarian ada di mana pun ada daftar orang.** Klub 300 anggota tidak bisa
disisir dengan menggulir. v2 punya kotak cari di Rekap saja; di v3 pola yang sama
dipakai di daftar anggota, daftar tagihan, riwayat main, dan pemilih pemain saat
mencatat — satu komponen, bukan lima ketikan berbeda. Pencarian mencakup nama
tampilan, username, dan alias lama.

**Layar pertama saat belum punya klub.** Orang bisa sampai ke app tanpa klub —
mendaftar duluan, atau klaimnya belum disetujui. Layar itu tidak boleh kosong:
tampilkan dua jalan yang jelas, **"Gabung klub"** (masukkan kode atau pindai QR)
dan **"Bikin klub"**, plus status permintaan yang sedang menunggu kalau ada.

### 5.5 Beranda

Urutan dari atas:

1. **Tagihanku** — angka hero, satu baris konteks di bawahnya ("3 main belum
   lunas"), lalu tombol lebar **Bayar sekarang**. Kalau lunas, ruang ini berganti
   jadi pernyataan tenang bahwa semuanya beres — bukan kartu kosong.

   **Lingkupnya klub yang sedang aktif**, bukan gabungan semua klub. Nama klub
   selalu terlihat di header, jadi angkanya tidak pernah ambigu dan tombol
   "Bayar sekarang" jelas menuju kas mana. Klub lain yang punya tagihan muncul
   sebagai baris kecil di bawahnya — "PB Lain · Rp 30.000" — yang bisa diketuk
   untuk berpindah. Satu angka gabungan lintas klub sengaja dihindari: ia
   mencampur uang yang harus masuk ke kas berbeda, dan membuat tombol bayarnya
   tidak punya tujuan yang jelas.
2. **Deposit** — saldo di klub ini dan status potong-otomatis, satu baris.
3. **Main terakhirku** — beberapa entri ringkas, bisa diketuk untuk detail.
4. **Berikutnya** — jadwal atau turnamen yang akan datang, kalau ada.
5. **Pintasan pengurus** — hanya muncul kalau berizin.

### 5.5.1 Alur yang sering terlupa tapi sering terjadi

Tiga alur ini bukan kasus tepi. Kalau tidak dirancang layarnya, ketiganya jadi
keluhan pertama setelah rilis:

- **Ganti HP.** Paling sering terjadi dari semua alur akun. Harus ada satu layar
  yang memandu berurutan: verifikasi nomor → daftarkan passkey baru → set PIN →
  keluarkan perangkat lama. Bukan tiga pengaturan terpisah yang harus ditemukan
  sendiri.
- **Menunggu pembayaran dicek** (§9.3) — status yang jujur, bukan angka yang tak
  berubah.
- **Ikut lebih dari satu klub.** Berpindah klub harus jelas terasa berpindah
  konteks — nama klub selalu terlihat di header, dan angka di layar tidak pernah
  ambigu milik klub mana.

### 5.6 Layar besar

- **768–1024px:** rail navigasi kiri, konten dua kolom.
- **> 1024px:** sidebar tetap yang juga memunculkan tujuan sekunder (Kas, Anggota,
  Stok, Pengaturan) karena ruangnya ada. Pola master–detail: daftar di kiri,
  detail di kanan, tanpa pindah halaman. Dialog di tengah, bukan sheet dari bawah.
  Daftar panjang jadi tabel padat dengan angka rata kanan. Bagan turnamen tampil
  utuh tanpa gulir mendatar.

**Aksi massal untuk bendahara.** Menandai lunas satu per satu masuk akal di klub
sepuluh orang, tidak di klub tiga ratus. Daftar tagihan punya mode pilih-banyak:
centang beberapa orang, satu tindakan untuk semuanya, satu entri ringkas di
jurnal audit alih-alih tiga puluh baris terpisah.

Karena ini mengubah uang banyak orang sekaligus, pengamannya lebih ketat dari
aksi biasa: **konfirmasi yang menyebutkan jumlah orang dan total rupiah**, dan
jendela "Batalkan" (§9.4) yang membatalkan seluruh kumpulan, bukan satu per satu.
Aksi massal **tidak boleh** diantre offline — terlalu besar akibatnya untuk
dikirim membabi buta saat sinyal kembali.

Tersedia di layar besar dan di HP. Bendahara memang lebih sering di laptop, tapi
tidak boleh dipaksa mencari laptop untuk pekerjaan yang wajar dilakukan sambil
duduk di pinggir lapangan.

### 5.6.1 Nada bicara & pesan galat

Prinsip "uang tidak menghakimi" (§5.2 nomor 3) tidak akan terwujud sendiri lewat
pilihan warna. Ia hidup atau mati di kalimat-kalimat kecil, dan kalimat kecil
adalah hal pertama yang ditulis asal-asalan saat mengejar fitur.

**Nada:** santai tapi tidak kekanakan, seperti bendahara klub yang enak diajak
bicara. Sapa dengan "kamu". Bahasa Indonesia sehari-hari, bukan bahasa surat
resmi dan bukan bahasa sistem.

**Pesan galat wajib memenuhi tiga hal sekaligus:** apa yang terjadi, kenapa, dan
apa yang bisa dilakukan sekarang.

| Jangan | Pakai |
|---|---|
| "Terjadi kesalahan" | "Gagal menyimpan — koneksi terputus. Catatannya masih tersimpan, dikirim lagi otomatis kalau sudah online." |
| "Unauthorized" | "Sesi kamu sudah berakhir. Masuk lagi buat lanjut." |
| "Validation failed" | "Nominalnya belum diisi." |
| "Anda memiliki tunggakan" | "Sisa patungan kamu Rp 47.000" |
| "Rate limit exceeded" | "Kebanyakan percobaan. Coba lagi 5 menit lagi." |

**Aturan tambahan:**

- **Jangan pernah menampilkan kode galat mentah, nama tabel, atau jejak stack**
  ke pengguna. Kalau butuh untuk dukungan, tampilkan kode pendek yang bisa
  dicocokkan dengan log — bukan pesan aslinya.
- **Angka selalu berformat rupiah penuh** (`Rp 47.000`), tidak pernah `47000`.
- **Tunggakan disebut netral** — "sisa patungan", "belum lunas". Hindari "utang",
  "menunggak", "gagal bayar". Ini teman main badminton, bukan debitur.
- **Konfirmasi menyebutkan akibatnya secara konkret**, bukan "Apakah Anda yakin?".
  Contoh: "Hapus main 8 Agustus? Tagihan 4 orang ikut hilang."
- **Keadaan kosong menuntun**, bukan sekadar memberi tahu kosong: satu kalimat
  yang menjelaskan, satu tombol yang bisa ditekan.
- Seluruh teks antarmuka tinggal di satu tempat, tidak tersebar sebagai literal
  di dalam komponen — supaya bisa disisir sekaligus, dan supaya i18n nanti
  (§18) tidak berarti membongkar semuanya.

### 5.7 Gerak & kehalusan

"Smooth" adalah alasan utama v3 ada, jadi ia butuh spesifikasi, bukan selera.

**Kesalahpahaman yang harus dihindari sejak awal: halus bukan berarti banyak
animasi.** Sebagian besar rasa halus datang dari hal yang *tidak* dilakukan —
tidak ada layout yang bergeser, tidak ada frame yang jatuh, tidak ada penantian
yang terlihat. Animasi menambah poles di atas fondasi itu; ia tidak bisa
menggantikannya. App yang penuh animasi di atas render yang berat justru terasa
lebih parah daripada app polos yang cepat.

**Anggaran gerak**

| Jenis | Durasi | Easing |
|---|---|---|
| Umpan balik sentuh (tekan tombol) | 80–120ms | `ease-out` |
| Perubahan keadaan (lunas ↔ belum, centang) | 150–200ms | `ease-out` |
| Sheet, dialog, panel masuk/keluar | 220–280ms | `cubic-bezier(0.22, 1, 0.36, 1)` |
| Perpindahan halaman | 200–300ms | sama |
| Penataan ulang daftar | 200ms | `ease-in-out` |

Tidak ada animasi yang melebihi **300ms**. Di atas itu berhenti terasa responsif
dan mulai terasa seperti menunggu.

**Hanya properti yang murah.** Animasi terbatas pada `transform` dan `opacity` —
keduanya ditangani compositor tanpa memicu layout ulang. Jangan pernah
menganimasikan `width`, `height`, `top`, `left`, `margin`, atau `padding`. Untuk
efek buka-tutup memakai trik `grid-template-rows: 0fr → 1fr` seperti v2
(`.acc-panel` di `v2/app/globals.css`) — itu pengecualian yang sah karena murah
dan hasilnya mulus.

**Yang harus dihindari karena membuat patah-patah**

- **`backdrop-filter` / `backdrop-blur`.** v2 memakainya di bottom nav
  (`backdrop-blur-xl` di [`v2/components/kok/bottom-nav.tsx`](../v2/components/kok/bottom-nav.tsx)),
  dan itu salah satu sumber jank paling terkenal di Safari mobile — ia memaksa
  komposisi ulang tiap frame saat konten di belakangnya bergulir. v3 memakai
  latar solid atau semi-transparan tanpa blur.
- **Bayangan besar dan tersebar** pada elemen yang bergerak atau bergulir.
- **Animasi masuk pada setiap item daftar** saat halaman dibuka. v2 memasang
  `animate-rise` di hampir semua kartu; dengan 50 baris itu jadi gelombang yang
  membuat halaman terasa lambat justru saat harus terasa cepat. Di v3, animasi
  masuk hanya untuk item yang **benar-benar baru datang** (mis. lewat realtime),
  bukan untuk isi yang memang sudah ada.
- **Spinner untuk aksi lokal.** Menandai lunas tidak boleh memunculkan pemuat —
  ia berubah seketika (§4.2). Spinner hanya untuk yang benar-benar menunggu
  jaringan dan tidak bisa dioptimistiskan.

**Yang lebih penting daripada animasi**

- **Nol pergeseran tata letak.** Ruang untuk gambar, angka, dan badge dipesan di
  muka. Angka memakai figur tabular supaya tidak melompat saat nilainya berubah.
- **Daftar panjang** memakai `content-visibility: auto` dengan
  `contain-intrinsic-size`, dan virtualisasi kalau melewati beberapa ratus baris.
- **Gulir tidak boleh memicu render ulang.** Store yang berlangganan harus
  berbutir halus — satu baris berubah, satu baris yang dirender.
- **Kerja berat menjauh dari main thread.** Render kartu share PNG dan kompresi
  foto lewat Web Worker, bukan di jalur interaksi.

**View Transitions** dipakai untuk perpindahan tema dan perpindahan
daftar → detail, dengan syarat degradasi mulus di browser yang belum
mendukungnya. v2 sudah memakainya untuk tema dan hasilnya bagus — ide itu
dipertahankan, implementasinya ditulis ulang.

**Transisi bawaan Svelte** (`transition:`, `animate:flip`) sudah cukup untuk
hampir semua kebutuhan. Jangan menambah pustaka animasi.

**`prefers-reduced-motion` dihormati sungguhan** — bukan sekadar mempercepat
durasi, tapi mengganti gerak dengan pemudaran sederhana atau tanpa gerak sama
sekali. Sebagian orang merasa mual karena gerak parallax dan skala; itu bukan
preferensi gaya.

**Diukur, bukan dirasakan.** Sebelum F5 ditutup: rekam profil gulir di HP
kelas menengah asli (bukan simulator desktop), pastikan tidak ada frame di atas
16ms saat menggulir daftar main sepanjang satu bulan.

### 5.8 Panduan di dalam app

Untuk pengguna awam, sebagian alur tidak bisa dijelaskan lewat tata letak saja —
terutama yang jarang dilakukan dan sulit ditebak akibatnya. Di situ dipakai
**[driver.js](https://driverjs.com)**: pustaka kecil (~5KB gzip) yang menyorot
elemen dan menempelkan penjelasan berurutan.

**Dipakai untuk:**

- **Perkenalan pertama** setelah gabung klub — di mana tagihanku, di mana
  mencatat main, di mana bertanya.
- **Memasang app ke Home Screen** — langkah yang mustahil ditebak sendiri di iOS,
  dan jadi syarat notifikasi bisa jalan (§10.2).
- **Menjelaskan potong-otomatis deposit** saat pertama kali ada saldo, sebelum
  ada uang yang berkurang tanpa diminta.
- **Pengurus baru** — sekali saat seseorang pertama kali diberi peran bendahara
  atau pencatat, menunjukkan apa yang kini bisa dilakukannya.

**Aturan yang menjaga panduan tetap menolong, bukan mengganggu:**

- **Dimuat malas.** Tidak ikut shell — diambil hanya saat panduannya benar-benar
  dijalankan, supaya anggaran 80KB tidak terganggu.
- **Sekali seumur hidup per panduan**, disimpan di server (bukan `localStorage`)
  supaya ganti HP tidak mengulang dari awal.
- **Selalu bisa dilewati**, dan bisa dipanggil ulang kapan saja dari menu Bantuan.
- **Tidak pernah muncul otomatis di tengah pekerjaan.** Panduan datang di awal
  sesi atau saat pengguna menekan tanda tanya — tidak menyela orang yang sedang
  mencatat main.
- **Bukan penambal desain yang buruk.** Kalau sebuah layar butuh panduan supaya
  bisa dipakai, layarnya yang salah. Panduan hanya untuk hal yang jarang
  dilakukan atau berkonsekuensi, bukan untuk menjelaskan tombol yang seharusnya
  jelas sendiri (§5.2 nomor 1).
- **Hormati `prefers-reduced-motion`** dan pastikan sorotannya bisa ditelusuri
  keyboard. Overlay yang menjebak fokus adalah masalah aksesibilitas yang nyata.

### 5.9 Fitur v2 yang wajib ikut pindah

Fungsinya ikut, tampilannya dirancang ulang. Ditulis di sini supaya tidak hilang
saat rewrite:

- **Share teks WhatsApp + kartu gambar** —
  [`v2/lib/share.ts`](../v2/lib/share.ts) (1352 baris). Fitur yang paling sering
  dipakai untuk menagih
- **Filter periode bulanan** — ada di lima layar v2
- **Nomor partai per hari** ("Partai 1/2/3") — yang membuat rincian tagihan terbaca
- **Saran nominal iuran** yang menutup biaya kok (`suggestFee`)
- **Beli slop** (1 slop = 12 kok) yang otomatis mengurangi kas
- **Penyesuaian saldo kas** dengan keterangan
- **Autocomplete nama + foto** saat mengisi pemain
- **Turnamen multi-hari**, format skor per partai, BYE otomatis
- **Deep-link tanggal** dari Tagihan ke Main
- **Decode QRIS dari foto** (v2 memakai `jsQR`)
- **Kompresi foto di klien** — [`v2/lib/image-compress.ts`](../v2/lib/image-compress.ts)

---

## 6. Multi-klub

### 6.1 Bentuk

Satu app di satu subdomain (`app.kaskok.my.id`). Pengguna bisa jadi anggota
beberapa klub dan berpindah dari dalam app tanpa login ulang. Tautan berbagi
memakai path `/{slug-klub}/...`.

Tidak memakai subdomain per klub: butuh TLS wildcard, sesi tidak terbawa antar
klub, dan PWA harus dipasang ulang untuk tiap klub — mahal untuk manfaat kecil.

**Panjang alamat adalah batasan desain, bukan selera.** Poster QR di tembok
mencantumkan alamat pendek yang bisa diketik manual kalau kamera bermasalah, jadi
`kaskok.my.id/{slug}` harus muat dan enak dieja lewat suara di GOR yang ramai.

### 6.2 Isolasi data — tiga lapis

Satu lapis terlalu rapuh untuk data uang milik orang lain:

1. **Middleware tenant** — menetapkan klub aktif dari sesi + slug, menolak lebih
   awal kalau pengguna bukan anggota.
2. **Query** — semua query sqlc menerima `club_id` sebagai parameter wajib.
3. **Postgres Row-Level Security** — jaring terakhir. Kalau satu query lupa
   memfilter, DB yang menolak, bukan pengguna yang melihat data klub lain.

**RLS di atas connection pool punya jebakan yang harus ditangani eksplisit.**
Kebijakan RLS membaca `current_setting('app.club_id')`. Nilai itu disetel per
koneksi, sementara pgx memakai ulang koneksi untuk permintaan yang berbeda — kalau
satu jalur lupa menyetel atau lupa membersihkan, permintaan berikutnya mewarisi
`club_id` milik orang lain. Ironisnya lapisan yang dimaksudkan sebagai pengaman
justru bisa jadi sumber kebocoran.

Aturannya:

- **Semua akses DB lewat satu pembungkus** yang membuka transaksi, menjalankan
  `SET LOCAL app.club_id = $1`, lalu memanggil query. `SET LOCAL` otomatis hilang
  saat transaksi selesai — tidak ada yang tertinggal di koneksi.
- **Tidak ada query yang boleh dijalankan di luar pembungkus itu.** Ditegakkan
  dengan linter khusus atau tinjauan, bukan niat baik.
- Koneksi memakai **role aplikasi yang tunduk RLS**, bukan pemilik tabel.
  Pemilik tabel melewati RLS diam-diam, dan itu menghapus seluruh manfaatnya.
- Migrasi goose memakai role terpisah yang memang boleh melewati RLS.

Suite kebocoran antar-klub (pengguna klub A menembak tiap endpoint klub B) wajib
hijau di setiap CI, dan **harus mencakup kasus koneksi dipakai ulang**: dua
permintaan berbeda klub berurutan di pool yang sama.

### 6.3 Halaman publik klub

Opsional per klub, read-only. Mempertahankan kemudahan v2 yang tautannya bisa
langsung dibuka dari grup WhatsApp.

**Tampil:** rekap tagihan per nama, jadwal main, bagan & klasemen turnamen,
statistik klub, dan **kas klub** (saldo, total masuk, total keluar) selama saklar
transparansi kas nyala.
**Tidak pernah tampil:** nomor telepon, saldo deposit perorangan, riwayat
pembayaran perorangan, jurnal audit, pengaturan.

Perhatikan bedanya: **kas klub** boleh terbuka, **titipan pemain** tidak. Total
deposit boleh muncul sebagai satu angka gabungan di laporan tiga kantong (§9.2)
karena itu bagian dari posisi keuangan klub, tapi saldo milik orang per orang
tetap privat.

Disajikan dari **rute dan handler terpisah yang hanya punya akses ke query
"aman-publik"** — bukan halaman biasa yang disaring di UI. Kalau tidak dipisah di
lapisan server, cepat atau lambat ada field pribadi yang bocor lewat.

### 6.4 QR & poster tembok

Tiap klub bisa membuat tautan + QR permanen yang **dicetak dan ditempel di GOR**.

**Alur orang baru:**
```
pindai QR → halaman klub (info umum kalau halaman publik menyala)
  → tombol besar "Gabung klub"
  → nomor WA → OTP
  → pilih namanya dari daftar belum-terklaim, atau daftar sebagai orang baru
  → masuk antrean persetujuan admin
```

Orang bisa mengintip dulu sebelum memutuskan, dan **satu QR melayani semua
keperluan** sehingga posternya tidak perlu diganti-ganti.

**Generator poster** menghasilkan berkas siap cetak: nama klub, QR besar, alamat
pendek yang bisa diketik manual, dan satu kalimat instruksi. Ukuran A4 dan A5;
keluaran **PDF 300dpi untuk dicetak** plus **PNG untuk dibagikan ke grup WA**.
Dirender di server (Go) supaya hasil cetaknya konsisten.

**Pengendalian:** token QR bisa diputar ulang atau dicabut kalau posternya
disalahgunakan (poster lama otomatis mati) · jumlah pindaian dihitung · masa
berlaku opsional · pendaftaran lewat QR **selalu** masuk antrean persetujuan ·
rate limit per IP. QR di tembok itu publik — perlakukan begitu.

### 6.5 Superadmin

**Boleh:** membuat, menangguhkan, menghapus klub; melihat metrik agregat (jumlah
anggota, aktivitas, ukuran data); mengelola pengumuman sistem; memantau kesehatan
bridge WA dan antrean notifikasi.

**Tidak boleh membaca isi data klub.** Tagihan, riwayat, dan pembayaran tidak bisa
dibuka dari panel superadmin. Kalau dukungan teknis benar-benar membutuhkannya,
jalurnya adalah izin sementara yang diberikan admin klub, dengan jurnal audit yang
terlihat oleh klub — bukan hak yang menempel diam-diam.

Konsekuensi yang diterima sadar: sebagian masalah tidak bisa didiagnosis dari
jauh. Ditebus dengan observability serius (§12) — itu satu-satunya alat yang
tersisa.

**Batas ini adalah kebijakan, bukan jaminan teknis.** Siapa pun yang memegang
akses server atau menjalankan restore cadangan (§12) secara teknis bisa membaca
semua data. Larangan di panel superadmin menghilangkan akses yang gampang dan
tidak tercatat — bukan akses yang mungkin. Jangan menjanjikan lebih dari itu ke
klub; janjikan yang benar: tidak ada jalan biasa untuk mengintip, dan setiap
jalan luar biasa meninggalkan jejak.

### 6.6 Membuat klub baru

Siapa pun yang punya akun bisa membuat klub: nama, slug, zona waktu → pembuatnya
otomatis **admin klub** dengan seluruh izin → langsung bisa mencatat main di menit
yang sama. Tidak ada langkah yang menuntut menunjuk bendahara lebih dulu.

Onboarding menyediakan jenis kok awal, harga default, dan **poster QR yang
langsung bisa diunduh**.

---

## 7. Identitas, akun, dan akses

### 7.1 Model identitas

- **Nomor WA** = identitas terverifikasi. Satu nomor satu akun, berlaku lintas klub.
- **Nama tampilan** — bebas diubah, boleh sama dengan orang lain.
- **Username unik** (`@rian`) — pencarian, mention, tautan profil. Bisa diubah
  dengan jeda (mis. 30 hari) supaya tidak jadi ajang tukar-menukar.
- **Alias** — semua nama yang pernah dipakai orang itu di v2, per klub. Ini yang
  membuat riwayat lama tetap menempel walau namanya berganti.

### 7.2 Login: verifikasi sekali, buka harian tanpa OTP

Ini menjawab keberatan "masa tiap login minta OTP" tanpa melepas syarat wajib
verifikasi WhatsApp.

**Klaim akun / perangkat baru — perlu OTP WA:**
```
Masukkan nomor → OTP 6 digit dikirim via WA → verifikasi
  → sesi dibuat (90 hari, diperpanjang otomatis)
  → tawarkan daftar passkey (Face ID / sidik jari)
  → set PIN 6 digit sebagai cadangan
```

**Buka app sehari-hari — tanpa OTP, tanpa kirim pesan apa pun:**
```
Sesi masih hidup dan app dibuka < 7 hari lalu → langsung masuk
Sesi hidup tapi app lama tak dibuka, atau tab dibuka ulang setelah HP terkunci
  → minta kunci: passkey ATAU PIN
Sesi mati (> 90 hari) → OTP lagi
```

**Passkey dan PIN setara, bukan utama-cadangan.** WebAuthn di PWA standalone iOS
punya riwayat berubah-ubah antar versi; kalau passkey diperlakukan sebagai jalur
utama dan gagal, orang terkunci. Keduanya didaftarkan saat klaim akun, keduanya
selalu ditawarkan, dan pengguna memilih mana yang muncul duluan.

**OTP WA hanya dipakai saat:** klaim akun pertama · login di perangkat baru ·
ganti nomor · pemulihan saat passkey dan PIN sama-sama hilang.

Dengan pola ini satu orang biasanya menerima **satu pesan OTP seumur pemakaian di
satu HP**. Itu bukan cuma soal kenyamanan — volume pesan yang rendah adalah
pertahanan utama supaya nomor WA bot tidak dibanned (§10.4).

**Pengaman OTP:** disimpan ter-hash · TTL 5 menit · maksimal 5 percobaan · rate
limit per nomor **dan** per IP · jeda naik-bertahap untuk kirim ulang.

**Jalur cadangan wajib:** kalau bridge WA mati atau nomornya diblokir, admin klub
bisa membuat kode undangan sekali pakai dari panel. Tanpa ini, satu masalah WA
mengunci seluruh klub di luar app.

### 7.2.1 Kalau nomornya sendiri yang hilang

Kasus yang gampang terlupa: nomor hangus, kartu dicuri, atau ganti nomor tanpa
akses ke yang lama. Semua jalur pemulihan di atas mengirim OTP **ke nomor itu**,
jadi tanpa jalan keluar khusus orangnya terkunci selamanya — berikut seluruh
riwayat dan saldo depositnya.

**Jalurnya:** admin klub bisa memindahkan akun anggota ke nomor baru.

- Hanya `admin` klub, tidak bisa didelegasikan ke peran lain
- Wajib mengisi alasan; tercatat di `audit_log` dan **terlihat oleh anggota klub**
- Nomor lama dilepas, nomor baru diverifikasi OTP seperti perangkat baru
- Semua sesi, passkey, dan PIN lama **dicabut** — perangkat lama otomatis keluar
- Anggota yang bersangkutan diberi tahu lewat push di perangkat yang masih hidup

Ini jelas jalur yang bisa disalahgunakan admin nakal. Karena itu tidak
disembunyikan: pemindahan nomor tampil di jurnal audit yang bisa dibaca seluruh
anggota klub, bukan cuma pengurus.

Kalau seluruh klubnya tidak punya admin yang bisa dihubungi, superadmin bisa
melakukannya — tapi itu jalur luar biasa yang juga tercatat.

### 7.2.2 Daftar perangkat

`sessions` menyimpan `device_label`, jadi tampilkan gunanya: satu layar berisi
perangkat yang sedang masuk (label, terakhir aktif, lokasi kasar dari IP) dengan
tombol **keluarkan** per baris dan **keluarkan semua kecuali ini**.

Ini bukan pelengkap. Sesi berumur 90 hari — HP yang hilang, dijual, atau dipinjam
adalah cara paling mungkin orang lain masuk ke akun seseorang, dan tanpa layar ini
tidak ada cara menutupnya selain menghubungi admin. Mengeluarkan perangkat juga
mencabut passkey yang terdaftar di situ.

### 7.3 Menempelkan nama lama v2 ke akun

Migrasi membuat akun **bayangan** (`status = unclaimed`) untuk tiap nama di v2 —
tanpa nomor, tapi seluruh riwayat dan tagihannya sudah menempel di situ. Tiga
jalan mengklaimnya, semuanya aktif:

**A. QR tembok / tautan grup** — jalur utama sehari-hari (§6.4). Tidak ada admin
yang mau mengetik 30 nomor satu per satu.
**B. Admin mengundang per orang** — masukkan nomor → tautan sekali pakai via WA.
**C. Klaim mandiri** dari halaman publik klub.

Semuanya bermuara ke **antrean persetujuan**. Tanpa itu, siapa pun bisa mengklaim
nama orang lain berikut tagihannya. Permintaan dikirim ke admin seketika lewat
push, jadi biasanya selesai dalam hitungan menit.

Nama yang tak pernah diklaim tetap tampil sebagai **pemain tamu** — tidak ada
riwayat yang hilang, dan bisa diklaim kapan saja nanti.

### 7.4 Peran: opsional dan boleh berbatas waktu

| Peran | Boleh |
|---|---|
| `admin` klub | Semua di klubnya: peran, saklar, persetujuan klaim, jurnal audit, poster QR |
| `bendahara` | Kas, tagihan, deposit, verifikasi pembayaran, stok kok, penyesuaian saldo |
| `pencatat` | Catat main, isi skor, tambah kok. **Tidak menyentuh uang** |
| `verifikator` | Menyetujui/menolak laporan bayar dan permintaan klaim akun |
| `member` | Data dirinya + data klub yang bersifat umum |

**Aturan jatuh-balik:** setiap izin yang tidak ditunjuk ke siapa pun otomatis
dipegang admin klub. **Klub berisi satu orang jalan penuh sejak menit pertama** —
peran hanya berguna saat klub cukup besar untuk membagi tugas.

**Peran berbatas waktu** (`memberships.role_expires_at`) — menggantikan delegasi
PIN sementara v2 (1 jam s/d 30 hari) yang akan hilang kalau peran dibuat permanen.
Contoh: menunjuk seseorang jadi `pencatat` hanya untuk hari ini; setelah lewat,
otomatis turun jadi `member` tanpa perlu diingat siapa pun.

**Tiga saklar per klub** supaya klub santai tidak terjebak birokrasi, dan klub
yang lebih tertutup tetap terlayani:

- **Siapa boleh catat main** → `semua anggota` (default klub baru) atau
  `hanya pengurus`. Kalau `semua anggota`, member biasa boleh mencatat
  pertandingan tapi tetap tidak bisa menyentuh uang.
- **Wajib verifikasi pembayaran** → nyala/mati. Kalau mati, laporan bayar pemain
  langsung masuk ledger tanpa menunggu verifikator.
- **Transparansi kas** → nyala/mati, **default nyala**. Saat nyala, saldo kas,
  total masuk, dan total keluar terlihat semua orang termasuk di halaman publik.
  Saat mati, angka-angka itu hanya untuk pengurus. Ini melanjutkan sikap v2 yang
  sengaja membuka kas demi transparansi (lihat komentar di
  [`v2/lib/domain/summary.ts`](../v2/lib/domain/summary.ts)), tapi kini jadi
  pilihan tiap klub — bukan keputusan platform.

Implementasi: himpunan izin sebagai konstanta Go (`perm.RecordGame`,
`perm.VerifyPayment`, …); peran memetakan ke himpunan izin; middleware
`RequirePerm(...)` di tiap rute; resolusi izin memperhitungkan aturan jatuh-balik,
masa berlaku peran, dan saklar klub.

---

## 8. Format main yang fleksibel

v2 mengunci 4 pemain di seluruh kode (`pairs.a[2]`, `pairs.b[2]`, validasi tepat
4 nama — lihat [`v2/lib/domain/game.ts`](../v2/lib/domain/game.ts) dan
[`v2/lib/domain/types.ts`](../v2/lib/domain/types.ts)). Untuk dipakai klub lain
itu asumsi yang mahal: sebagian klub main single, sebagian rotasi 6–8 orang di
satu lapangan.

**Model v3:**

- Satu game punya `game_players` — **baris per pemain**, dengan `side` dan `slot`.
  Jumlahnya bebas.
- Sisi boleh 1v1 (single), 2v2 (ganda), atau lebih (rotasi).
- Biaya kok dibagi ke **jumlah pemain sebenarnya**, bukan konstanta 4.
- **Semantik snapshot harga v2 tidak boleh rusak** — harga tersimpan di dalam
  game, bukan diambil ulang dari katalog saat menampilkan riwayat.
- Nilai stok di statistik v2 memakai `pricePerPerson × 4`; di v3 pengalinya
  mengikuti format acuan klub.

**UI catat main:** default ganda 4 orang (satu tap, secepat v2), dengan pilihan
mengubah format. Migrasi mengisi semua game lama sebagai ganda 4 orang.

### 8.1 Pemain tamu — orang yang belum (atau tidak akan) punya akun

v2 memakai nama sebagai teks bebas, jadi siapa pun bisa dicatat. v3 memakai
`user_id`, dan itu **tidak boleh** berarti setiap orang wajib punya akun sebelum
bisa ikut main. Kenyataannya klub sering kedatangan teman yang main sekali lalu
tidak pernah kembali; memaksanya mendaftar dan verifikasi WA hanya untuk dicatat
sekali akan membunuh kecepatan mencatat — dan mencatat yang lambat berarti tidak
dicatat sama sekali.

**Jalannya lewat akun bayangan yang sudah ada** (§7.3): pencatat mengetik nama
apa saja; kalau tidak cocok dengan anggota mana pun, sistem membuat anggota
berstatus `unclaimed` di klub itu. Orang itu langsung bisa ditagih, punya
riwayat, dan muncul di rekap — persis seperti v2. Kalau suatu hari dia mau
bergabung, dia tinggal mengklaim namanya lewat QR dan seluruh riwayatnya
menempel.

Konsekuensi yang harus disadari:

- **Kuota anggota menghitung akun bayangan juga.** Klub yang sering kedatangan
  tamu akan menumpuk nama. Perlu cara menggabungkan atau merapikan nama di panel
  anggota.
- **Nama tamu ikut tampil di halaman publik.** Itu alasan `noindex` di §12 bukan
  formalitas.
- Pencatat harus dibantu supaya tidak membuat duplikat karena salah ketik —
  autocomplete wajib memunculkan nama mirip lebih dulu sebelum menawarkan
  "buat baru".

**Berlaku sama untuk turnamen.** Justru di situ tamu paling sering muncul: tarkam
mengundang pasangan dari klub lain, dan mereka tidak akan pernah jadi anggota.
`tournament_pairs` memakai mekanisme yang sama — nama bebas jadi anggota
`unclaimed` di klub penyelenggara, sehingga iuran dan kok partainya tetap bisa
ditagih dan tercatat.

Satu hal yang harus dipikirkan penyelenggara, bukan disembunyikan sistem: tamu
turnamen menumpuk di daftar anggota klub, dan sebagian tidak akan pernah kembali.
Panel anggota perlu penyaring **"tamu turnamen"** supaya mereka bisa disembunyikan
dari daftar sehari-hari tanpa menghapus riwayatnya.

---

### 8.2 Siapa main ≠ siapa nanggung

Kenyataan di lapangan: satu orang membayari pasangannya, atau mentraktir semua,
atau yang kalah taruhan menanggung kok. v2 tidak bisa menampung ini sama sekali —
tagihan selalu menempel ke pemainnya.

**Pemisahan yang menyelesaikan semuanya sekaligus:** tiap baris pemain punya
`user_id` (siapa yang main) **dan** `payer_id` (siapa yang menanggung). Bawaannya
sama; ubah `payer_id` dan tagihannya pindah.

| Kasus | Yang dilakukan |
|---|---|
| Semua bayar sendiri | Tidak ada — ini bawaannya |
| A membayari pasangannya | `payer_id` baris B → A |
| A mentraktir satu lapangan | `payer_id` keempat baris → A |
| Kalah taruhan, sisi B bayar semua | `payer_id` semua baris → pemain sisi B |

Konsekuensi yang harus dipatuhi di seluruh sistem:

- **"Tagihanku" dihitung dari `payer_id`, bukan `user_id`.** Ini menyentuh indeks
  utama di §13 — salah kolom di situ dan seluruh angka tagihan salah.
- Yang ditanggung **tidak melihat tagihan**, dia melihat keterangan "dibayarin A".
- Potong otomatis memakai dompet **penanggung**.
- **Sanggahan tetap hak pemainnya** (`user_id`), bukan penanggung — yang berhak
  bilang "saya tidak ikut main" adalah orang yang namanya dicatat.
- Penanggung dapat notifikasi "kamu nanggung tagihan A", yang ditanggung dapat
  "tagihanmu dibayarin B". Keduanya wajib; tidak boleh ada tagihan yang berpindah
  diam-diam.

**Pencatat bebas menetapkannya** saat mencatat, sama seperti dia memilih pemain —
menunggu persetujuan akan mematikan alur yang harus selesai dalam belasan detik.
Pengamannya sudah ada: notifikasi seketika plus tombol sanggah (§9.4).

### 8.3 Skor game harian — opsional

v2 hanya mencatat skor di turnamen. Main harian cuma tercatat siapa dan berapa
kok, jadi menang-kalahnya hilang — padahal itu bahan obrolan grup yang paling
ramai.

v3 menambahkan skor sebagai **isian opsional** saat mencatat main. Boleh dilewati
sepenuhnya; mencatat main tanpa skor harus tetap secepat v2, karena itu alur yang
paling sering dipakai.

**Tiga format**, mengikuti yang benar-benar dipakai:

| Format | Aturan |
|---|---|
| `single` | Satu game sampai 30. Format "biasa" milik v2 |
| `bo3` | Rally poin 21, best of 3. Standar pertandingan |
| `rally42` | **Satu game sampai 42, pindah tempat saat 21.** Format tarkam — paling sering dipakai di main harian |

`rally42` adalah tambahan v3; dua yang lain sudah ada di v2
([`v2/lib/domain/types.ts`](../v2/lib/domain/types.ts)) dan dipakai ulang apa
adanya supaya turnamen dan main harian berbagi satu model skor, bukan dua.

**Papan peringkat klub** ikut terbuka begitu ada skor: klasemen menang-kalah,
rentetan kemenangan, dan rekor saling berhadapan. **Ada saklar per klub**, default
nyala — di klub yang isinya beda-beda level, papan peringkat bisa membuat sebagian
orang malas ikut main, dan itu lebih merugikan daripada keseruan yang didapat.

### 8.4 Taruhan

Dua jenis, ditangani dengan cara yang sangat berbeda.

**Taruhan kok** — yang kalah menanggung biaya kok. Ini **bukan mekanisme baru**:
cukup preset dari §8.2 yang memindahkan `payer_id` semua baris ke sisi yang kalah.
Setelah skor diisi, tombol "yang kalah bayar kok" menyelesaikannya sekali tap.

**Taruhan barang** — Pocari, gorengan, apa pun. Dicatat **terpisah dan tanpa
rupiah**: isi bebas ("2 Pocari"), siapa berutang ke siapa, status lunas atau belum.

Aturan mutlak: **taruhan barang tidak pernah menyentuh kas klub, deposit, atau
tagihan.** Ia hidup di ledger sendiri. Begitu ia dinilai rupiah dan masuk tagihan,
uang kas klub tercampur urusan pribadi antar pemain — persis jenis pencampuran yang
membuat pembukuan v2 membingungkan, dan di sini akibatnya lebih parah karena
menyangkut orang lain.

Sifatnya ringan: muncul di profil sebagai statistik seru, tidak pernah muncul di
laporan keuangan, tidak pernah memicu pengingat WA, dan bisa dimatikan per klub.

---

## 9. Uang

### 9.1 Deposit (dompet pemain)

Menggantikan `player_carry` v2 — titipan cicilan yang mengambang tanpa penjelasan
dan hanya bisa ditebak lewat heuristik "item mana yang paling pas ditutup"
(lihat `carryTargetKey` di
[`v2/components/kok/debt-view.tsx`](../v2/components/kok/debt-view.tsx)).

**Dompet terpisah per klub.** Saldo yang dititipkan di PB Sarjana hanya bisa
dipakai di PB Sarjana. Ini bukan pembatasan yang dibuat-buat — uangnya memang
dipegang klub itu, dan klub lain tidak punya hak atasnya. Dompet global akan
memaksa platform jadi perantara keuangan antar klub (saldo dipakai di klub B,
uang fisiknya ada di klub A), masalah yang jauh lebih besar daripada manfaatnya.

Konsekuensi yang diterima: orang yang ikut dua klub punya dua saldo dan top-up
dua kali. Karena itu `wallet_entries` **wajib punya `club_id`**, dan layar deposit
selalu menyebut nama klubnya.

**Aturan:**

- **Ledger append-only** (`wallet_entries`): `club_id`, `user_id`, jenis
  (`topup`, `pemakaian`, `refund`, `penyesuaian`), nominal. Saldo = jumlah ledger
  **per klub**. Kolom saldo hanya cache, dengan tugas rekonsiliasi berkala.
- **Potong otomatis, bisa dimatikan per pemain.** Tagihan baru langsung dipotong
  dari saldo selama masih cukup.
- **Tidak boleh minus.** Saldo berhenti di nol; sisa tagihan tetap jadi tagihan
  biasa. Tidak ada utang tersembunyi di dalam dompet.
- **Bayar lebih otomatis masuk deposit** — inilah alasan fitur ini ada.
- **Tarik saldo perlu persetujuan** bendahara/admin, tercatat di ledger dan audit.
- Setiap potongan mengirim notifikasi ke pemiliknya. **Saldo tidak boleh berkurang
  diam-diam.**

### 9.2 Tiga kantong uang

Deposit adalah **kewajiban klub**, bukan pemasukan — uang pemain yang sewaktu-waktu
bisa ditarik. Kalau digabung ke kas, kas terlihat gemuk padahal sebagiannya bukan
haknya.

| Kantong | Isi |
|---|---|
| **Kas klub** | Uang kok yang sudah dibayar, dikurangi pengeluaran |
| **Titipan pemain** | Total saldo deposit semua anggota — kewajiban |
| **Iuran turnamen** | Pool terpisah per turnamen |

Ini melanjutkan pemisahan kas-kok vs iuran-turnamen yang sudah benar di v2 (lihat
komentar di [`v2/lib/domain/summary.ts`](../v2/lib/domain/summary.ts) dan
[`v2/lib/domain/debt.ts`](../v2/lib/domain/debt.ts)) dan menambah satu kantong.

Ketiganya tampil di layar keuangan **dengan satu kalimat penjelasan**. Jangan
diulang kesalahan v2 yang memisahkan dengan benar di kode tapi tidak pernah
menjelaskannya ke pengguna — itu sumber kebingungan terbesar di v2.

### 9.3 Pembayaran dua langkah

```
Pemain lihat tagihannya → tekan "Sudah transfer"
  → payment status=pending, notifikasi ke bendahara/verifikator
  → disetujui → status=verified, masuk ledger, tagihan berkurang
  → pemain dapat notifikasi "pembayaranmu sudah dicatat"
```

Kalau saklar **wajib verifikasi** dimatikan, langkah persetujuan dilewati. Admin
tetap bisa menandai lunas langsung — jalur cepat v2 dipertahankan. Bayar lebih
dari tagihan → sisanya masuk deposit.

**Status menunggu harus jujur di UI.** Kalau bendahara tidak membuka app selama
tiga hari, tagihan orang itu tetap terlihat belum lunas padahal uangnya sudah
masuk — dan orang itu akan merasa laporannya diabaikan. Karena itu tagihan yang
sudah diklaim **tidak boleh** tampil sama seperti tagihan yang belum dibayar:
tampilkan "Menunggu dicek bendahara · dilaporkan 2 hari lalu", dengan cara
membatalkan laporan kalau ternyata salah kirim.

Klaim yang menganggur lebih dari **3 hari** memicu pengingat ke bendahara dan
verifikator. Beban menunggu harus jatuh ke pengurus, bukan ke orang yang sudah
membayar.

### 9.4 Salah catat: batalkan cepat dan sanggahan

Dua jalur berbeda untuk dua masalah berbeda. Keduanya wajib ada — ini app yang
menambah tagihan ke orang lain, dan orang harus punya jalan keluar saat keliru.

**Batalkan cepat (untuk yang mencatat).** Aksi keliru paling sering terjadi
sedetik setelah dilakukan: salah tap nama, salah tandai lunas, salah hapus. Tiap
aksi seperti itu memunculkan toast dengan tombol **Batalkan** yang hidup ~8 detik.
Selama jendela itu, aksinya benar-benar dibatalkan, bukan dibuat aksi
berlawanan — jadi jurnal audit tidak penuh oleh pasangan "tandai lunas /
batal lunas" yang membingungkan. Lewat jendela itu, koreksi ditempuh lewat edit
biasa dan tercatat sebagaimana mestinya. v2 sama sekali tidak punya ini: salah
tap berarti mencari sendiri cara mengembalikannya.

**Sanggahan (untuk yang dicatat).** Notifikasi "kamu dicatat ikut main" membawa
tombol **"Saya tidak ikut"**. Menekannya menandai baris itu disengketakan,
memberi tahu pencatat dan bendahara, dan **menahan tagihannya** sampai
diselesaikan — tanpa menghapus apa pun sepihak. Yang mencatat bisa memperbaiki
atau menjelaskan.

Tanpa ini, satu-satunya cara membantah adalah ribut di grup WhatsApp, dan
justru itu yang app ini seharusnya kurangi.

### 9.5 Aturan uang yang mengikat

Enam aturan yang menentukan angka, bukan tampilan. Tanpa ini ditulis, tiap
pengeksekusi akan menebak sendiri — dan tebakan pada aturan uang adalah kesalahan
paling mahal di app ini.

**A. Pembagian biaya dibulatkan ke atas ke ratusan rupiah.**

```
perOrang = ceilRatusan(totalKok / jumlahPemain)
```

Contoh: kok Rp 10.000 dibagi 3 → Rp 3.333,33 → **Rp 3.400 per orang**.

Dibulatkan **ke atas**, bukan ke terdekat. Ke terdekat akan menghasilkan
Rp 3.300 dan klub nombok Rp 100 tiap game — kas disubsidi diam-diam, persis
jenis kebocoran yang tidak akan pernah ketahuan sampai selisihnya besar.

Kelebihannya (di contoh: Rp 200) masuk kas klub dan **dicatat sebagai
"pembulatan"** di laporan, bukan menyatu tanpa keterangan. Kas yang bertambah
tanpa penjelasan adalah cara tercepat kehilangan kepercayaan.

Semua orang di satu game membayar nominal yang sama persis — tidak ada satu orang
yang menanggung sisa receh tanpa alasan yang bisa dia mengerti.

*Batas yang diterima:* kalau biaya per orang di bawah Rp 100, pembulatan ini
melompat besar secara relatif. Di harga nyata (Rp 3.000-an per orang) itu tidak
pernah terjadi; jangan tambah kerumitan untuk kasus yang tidak ada.

**B. Potong otomatis memakai planner best-fit yang sama dengan cicilan.**

Saldo dipakai untuk menutup kombinasi tagihan yang menyisakan saldo paling kecil —
algoritma yang sama persis dengan planner cicilan v2
([`v2/lib/domain/debt.ts`](../v2/lib/domain/debt.ts)). Satu algoritma untuk dua
kebutuhan, bukan dua aturan yang harus dijelaskan terpisah.

Konsekuensi UI yang **wajib** dipenuhi: urutan best-fit terasa acak bagi orang
awam. Karena itu setiap potongan harus menyebut **tagihan mana saja yang tertutup**
("Deposit menutup: 2 Agu Rp 12.000, 6 Agu Rp 15.000 — sisa saldo Rp 3.000"), bukan
cuma memperlihatkan saldo berkurang. v2 sudah membuktikan bahwa saldo yang
mengambang tanpa penjelasan bikin bingung — sampai butuh heuristik khusus hanya
untuk menebak-nebak tampilannya.

**C. Potong otomatis berjalan seketika, dalam transaksi yang sama.**

Begitu game disimpan, tagihan dibuat dan deposit peserta dipotong di dalam satu
transaksi. Tidak ada jendela waktu di mana tagihan terlihat belum lunas padahal
saldonya cukup, dan tidak ada dua orang yang melihat angka berbeda.

**D. Tagihan yang disanggah dikecualikan dari potong otomatis.**

Sanggahan (§9.4) menahan tagihan. Selama ditahan: tidak dipotong dari deposit,
tidak dihitung sebagai tunggakan untuk pengingat, tidak masuk aksi massal. Kalau
tidak, uang orang terpakai untuk main yang justru dia bantah pernah ikuti — dan
itu memaksanya menagih balik ke klub.

**E. Tagihan yang sudah diklaim bayar dikunci dari potong otomatis.**

Orang menekan "sudah transfer" → tagihan itu terkunci sampai verifikator
memutuskan. Tanpa kunci ini, deposit bisa memotongnya sebelum klaimnya disetujui,
lalu klaimnya juga masuk — tagihan yang sama terbayar dua kali. Kalau klaimnya
ditolak, kuncinya lepas dan potong otomatis berjalan seperti biasa.

**F. Izin dievaluasi ulang tiap permintaan, bukan disimpan di sesi.**

Sesi hidup 90 hari; peran bisa habis besok (§7.4). Peran dan izin dibaca dari DB
di tiap permintaan. Menyimpannya di token berarti orang yang perannya sudah
dicabut tetap bisa menyentuh uang selama berhari-hari.

**Aksi massal boleh berhasil sebagian.** Dari 20 baris, yang versinya sudah
berubah ditolak dan sisanya tetap jalan. Hasilnya dilaporkan per baris beserta
alasannya, dengan tombol coba lagi untuk yang gagal — bendahara tidak perlu
mengulang dari nol. Konsekuensinya: "Batalkan" (§9.4) hanya mengembalikan baris
yang benar-benar berhasil, dan itu harus dikatakan apa adanya di UI.

### 9.6 QRIS

v2 mengubah QRIS statis merchant jadi dinamis lewat `@prasetya/qris`. Kadang
berhasil, kadang ditolak atau kedaluwarsa saat dipindai — wajar, karena sebagian
aplikasi bank memvalidasi tag QR dinamis secara berbeda dan sebagian menyimpan QR
yang sudah pernah dipindai.

v3 tidak menggantungkan pembayaran pada jalur yang tidak selalu berhasil:

- **Default: QRIS statis apa adanya**, dengan nominal tercetak besar di bawahnya
  dan tombol salin. Pemain mengetik nominalnya sendiri di aplikasi bank. Jalur ini
  tidak pernah gagal.
- **Opsional "isi nominal otomatis"** → QR dinamis. Selalu dibuat ulang saat
  dialog dibuka (jangan pernah di-cache), dengan tag kedaluwarsa eksplisit.
- Tombol **"QR-nya ditolak"** mengembalikan ke QR statis **dan mencatat
  kejadiannya**. Setelah beberapa minggu, datanya sendiri yang memutuskan apakah
  QR dinamis layak dipertahankan.
- **Decode QRIS dari foto** tetap ada — ini cara admin memasukkan QRIS-nya.
- QRIS disimpan **per klub**.

---

## 10. Notifikasi

### 10.1 Pembagian jalur

| Kejadian | Jalur | Alasan |
|---|---|---|
| OTP login / perangkat baru | **WA** | Belum ada akun, belum bisa berlangganan push |
| Undangan klaim akun | **WA** | Pemain belum punya app |
| **Kamu dicatat ikut main** | **Push** | Uang orang bertambah tanpa dia melakukan apa-apa — dia berhak tahu seketika |
| Tagihan baru · deposit berubah · pembayaran diverifikasi · undangan turnamen · jadwal partai · ringkasan bulanan · permintaan klaim masuk | **Push** | Rutin |
| Tunggakan lewat batas | **WA** | Jarang, penting; penunggak paling mungkin belum memasang app |
| Push gagal / tak berlangganan > **14 hari** | **WA** | Jaring pengaman; kalau tidak, orang itu tak pernah dapat kabar |

Hasilnya satu anggota aktif menerima kira-kira **satu pesan WA seumur pemakaian**.
Ini yang membuat pemakaian whatsmeow masuk akal — dan makin penting di multi-klub,
karena satu nomor bot melayani semua klub sekaligus.

**Pusat notifikasi di dalam app** (ikon lonceng) adalah kebenaran. Push bisa
terlewat, ditolak izinnya, atau tidak didukung perangkat — tidak boleh ada
kejadian penting yang hanya hidup di push.

### 10.2 Web Push

`Push API` + VAPID; langganan disimpan di `push_subscriptions`.

- **Android/Chrome:** jalan langsung dari browser.
- **iOS 16.4+:** hanya jalan kalau app **sudah dipasang ke Home Screen**. Ini
  dimanfaatkan jadi langkah onboarding "Pasang app + nyalakan notifikasi" dengan
  instruksi bergambar (Share → Tambah ke Layar Utama). Izin notifikasi diminta
  **setelah** ada momen relevan (mis. sesudah tagihan pertama muncul), bukan saat
  pertama membuka app.
- Opt-in per jenis, jam tenang default 21.00–07.00 mengikuti zona klub.

### 10.3 Ambang tunggakan

Diatur per klub, dengan bawaan yang masuk akal supaya klub baru tidak perlu
memikirkannya:

| Setelan | Bawaan | Keterangan |
|---|---|---|
| Umur tagihan | **14 hari** | Dihitung sejak tagihan muncul, bukan sejak terakhir ditagih |
| Nominal minimum | **Rp 50.000** | Di bawah ini tidak pernah memicu pesan WA |
| Jeda antar pengingat | **7 hari** | Satu orang tidak bisa ditagih dua kali dalam seminggu |

**Kedua syarat harus terpenuhi bersamaan (DAN, bukan ATAU).** Tunggakan Rp 3.000
yang terlupa selama sebulan tidak layak menghabiskan jatah pesan WA — dan lebih
penting lagi, tidak layak membuat orang merasa ditagih seperti debitur. Ini
sejalan dengan prinsip §5.2 nomor 3: uang tidak menghakimi.

Klub bisa mematikan pengingat WA sepenuhnya. Kalau dimatikan, pengingat tetap
muncul sebagai notifikasi in-app dan Web Push.

### 10.4 whatsmeow — biaya dan risiko

Library-nya **gratis dan tidak ada biaya per pesan** — ia berbicara langsung ke
protokol WhatsApp Web memakai nomor sendiri, seperti WhatsApp Web di laptop.

Yang dibayar bukan uang, tapi risiko: **tidak resmi dan melanggar ToS WhatsApp
Business. Nomor bisa dibanned permanen** beserta seluruh riwayat chatnya.

Mitigasi yang wajib diterapkan:

- Nomor **khusus bot** (sudah tersedia), jangan nomor pribadi siapa pun
- Volume ditekan habis lewat strategi Push-utama di §10.1
- Antrean di Postgres, jeda acak antar pesan, backoff eksponensial, **tanpa blast
  serentak**
- Isi pesan bervariasi, bukan templat identik berulang
- **Kuota per klub** supaya satu klub ramai tidak menghabiskan jatah platform
- Semua pengiriman lewat interface `Notifier` — pindah ke Meta WhatsApp Cloud API
  nanti tidak menyentuh satu baris pun logika domain
- Kalau nomor tetap kena banned: kode undangan admin dan PIN membuat semua orang
  tetap bisa masuk. **Tidak ada titik kegagalan tunggal yang mengunci app.**

---

## 11. Offline & keandalan

Bagian ini yang membedakan "app yang cepat" dari "app yang tidak pernah bikin
kesal di GOR bersinyal jelek".

**Baca offline.** Data yang sudah diambil dicermin ke IndexedDB. Buka app tanpa
sinyal → isi terakhir langsung tampil dengan penanda "data per <waktu>", lalu
disegarkan begitu online.

**Antrean tulis (outbox).** Aksi tulis masuk outbox IndexedDB dan dikirim saat
memungkinkan.

- Setiap aksi punya **`Idempotency-Key`** yang dibuat di klien (invarian §3).
- UI menampilkan status per aksi: menunggu · terkirim · gagal, dengan tombol coba
  lagi. **Tidak ada aksi yang hilang diam-diam.**
- Aksi yang tidak boleh diantre (mis. verifikasi pembayaran oleh bendahara)
  ditandai online-only dan ditolak dengan pesan jelas saat offline.

**Tabrakan perubahan.** Dua pengurus menandai lunas bersamaan, atau dua orang
mengisi skor partai yang sama. Ditangani lewat `version` (invarian §3): server
menolak dengan `409` beserta keadaan terbaru, dan UI menampilkan pilihan yang
jelas.

**Pembaruan app.** SPA di-embed di binary; setiap deploy mengganti aset. Service
worker mendeteksi versi baru dan menampilkan ajakan "Versi baru tersedia — muat
ulang". Tanpa ini orang memakai app basi berhari-hari.

**Halaman offline dan error boundary** tetap ada — di mode standalone tidak ada
address bar untuk keluar dari layar rusak. v2 sudah menanganinya dengan benar
([`v2/app/offline/page.tsx`](../v2/app/offline/page.tsx),
[`v2/app/error.tsx`](../v2/app/error.tsx)) — pertahankan idenya.

---

## 12. Operasional & keamanan

Tidak ada di v2, dan berhenti jadi opsional begitu menyimpan data klub orang lain.

- **Bridge WA satu proses.** `cmd/waworker` terpisah dari API — whatsmeow memegang
  satu koneksi, dan dua instance akan bentrok. Kalau API di-scale, worker tetap
  tunggal.
- **Pemantauan sesi WA.** Sesi bisa putus kapan saja. Kesehatannya diperiksa
  berkala; putus → peringatan ke superadmin + halaman status. Tanpa ini, OTP
  berhenti terkirim tanpa ada yang tahu.
- **Backup terjadwal + uji pemulihan.** Bukan cuma dijadwalkan — **restore diuji
  berkala**, karena cadangan yang tak pernah diuji bukan cadangan. Ini juga
  satu-satunya jaring pengaman cutover, mengingat tidak ada jalur pulang.
- **Observability.** Logging terstruktur dengan request ID, metrik Prometheus,
  pelacakan galat, endpoint health/readiness. Karena superadmin sengaja tidak boleh
  melihat data klub, ini satu-satunya alat diagnosa yang tersisa — perlakukan
  sebagai kebutuhan utama, bukan pelengkap.
- **Rate limiting umum** per user dan per IP di seluruh API, bukan cuma OTP.
- **Hapus akun & ekspor data pribadi.** Nomor telepon itu data pribadi. Aturannya:
  transaksi keuangan **tidak dihapus** (klub butuh pembukuannya), tapi identitas
  dianonimkan jadi "Pemain terhapus". Ekspor mengembalikan data pribadi orang itu.
- **Kebijakan privasi minimal** — apa yang disimpan, siapa yang bisa melihat,
  berapa lama.
- **Lingkungan dev tanpa WA.** `Notifier` palsu yang menulis OTP ke log, plus data
  seed. Tanpa ini tidak ada yang bisa mengembangkan tanpa memakai nomor produksi.
- **Halaman publik tidak boleh diindeks.** Nama anggota — termasuk pemain tamu yang
  belum pernah mengklaim akunnya — tampil di halaman publik klub. Wajib
  `noindex, nofollow` dan `robots.txt` yang menutup seluruh path publik klub.
  Orang mendaftar ke klub badminton, bukan ke hasil pencarian Google atas namanya.

### 12.1 Kuota

Prinsipnya: **kuota melindungi sumber daya bersama, bukan membatasi pemakaian
wajar.** Karena itu semuanya longgar, tersimpan per klub, dan bisa dinaikkan
superadmin tanpa deploy ulang.

| Kuota | Bawaan | Bisa dinaikkan? |
|---|---|---|
| Ukuran foto sebelum kompresi | 8 MB | Ya |
| Anggota per klub | 500 | Ya |
| Klub per orang | 20 | Ya |
| Game, turnamen, transaksi | **tanpa batas** | — |
| Poster QR aktif per klub | 10 | Ya |
| **Pesan WA per klub per hari** | **50** | **Hanya superadmin, per permintaan** |

Foto tetap dikompresi di klien seperti v2, jadi 8 MB itu batas masukan mentah dari
kamera HP; hasil simpannya jauh lebih kecil.

Kuota pesan WA **tidak punya saklar yang bisa digeser klub sendiri** — beda dari
kuota lain yang boleh dinaikkan begitu diminta. Nomor bot dipakai bersama semua
klub; satu klub yang mengirim membabi buta bisa membuat nomor itu dibanned dan
**semua klub kehilangan OTP sekaligus**. Menaikkannya adalah keputusan superadmin
setelah melihat pola pemakaian klub itu, bukan permintaan yang otomatis dikabulkan.

**Jatah onboarding.** Kuota harian 50 akan pecah tepat di saat paling penting:
klub 30 orang yang bergabung serentak butuh 30 undangan + 30 OTP = 60 pesan dalam
satu hari. Karena itu tiap klub punya **jatah onboarding sekali pakai sebesar 300
pesan**, aktif 14 hari sejak klub dibuat atau sejak superadmin menyalakannya lagi.
Jatah ini terpisah dari kuota harian dan hanya bisa dipakai untuk undangan dan OTP
— tidak untuk pengingat tagihan.

### 12.2 Retensi data

Apa yang terjadi pada data klub setelah dihapus atau ditangguhkan. Ini soal uang
orang banyak, jadi jangan ada penghapusan yang tidak bisa dibatalkan.

| Kejadian | Perlakuan |
|---|---|
| Admin menghapus klub | **Soft-delete.** Klub hilang dari daftar, data utuh. Bisa dipulihkan admin atau superadmin selama **30 hari** |
| Lewat 30 hari | Dihapus permanen. Peringatan + tawaran ekspor dikirim pada hari ke-23 |
| Superadmin menangguhkan klub | **Tidak pernah dihapus otomatis.** Penangguhan itu tindakan sengketa, bukan pembersihan — data ditahan sampai persoalannya selesai |
| Klub tidak aktif lama | **Tidak dihapus.** Klub yang cuma vakum semusim tetap punya riwayat uang yang sah |
| Anggota keluar dari klub | Keanggotaan berakhir; riwayat main dan pembayarannya **tetap** di klub, karena itu bagian pembukuan klub |
| Akun dihapus pemiliknya | Identitas dianonimkan jadi "Pemain terhapus"; transaksi keuangan tetap ada (lihat butir "Hapus akun & ekspor data pribadi" di awal §12) |

Penghapusan permanen menghapus juga foto di volume disk dan langganan push
terkaitnya. `audit_log` penghapusan disimpan di tingkat platform, tidak ikut
terhapus — supaya selalu bisa dijawab siapa menghapus apa dan kapan.

**Saldo deposit menahan penghapusan.** Klub yang masih memegang titipan pemain
tidak boleh dihapus permanen begitu saja — itu uang orang lain. Sebelum tenggang
30 hari habis, seluruh saldo harus dikembalikan atau dinolkan lewat entri ledger
yang bisa dipertanggungjawabkan. Kalau masih ada saldo tersisa saat tenggang
berakhir, penghapusan **ditahan** dan superadmin diberi tahu.

---

## 13. Skema data

Skema v2 menyimpan game dan turnamen sebagai **blob JSON** (lihat
[`v2/prisma/schema.prisma`](../v2/prisma/schema.prisma)) — itu yang memaksa "muat
semua lalu hitung di memori". v3 menormalkannya supaya "tagihan si A di klub B"
jadi satu query berindeks.

**Platform & klub**
- `clubs` — `slug`, `name`, `timezone`, `status`, `deleted_at` (soft-delete),
  `settings`, `quotas`.
  `settings` memuat: saklar catat main · wajib verifikasi · halaman publik ·
  **transparansi kas** (default nyala) · QRIS · harga default · format main
  default · **ambang tunggakan** (hari, rupiah, jeda pengingat, pengingat WA
  nyala/mati).
  `quotas` memuat nilai dari §12.1 — tersimpan per klub supaya superadmin bisa
  menaikkannya tanpa deploy ulang.
- `club_links` — tautan/QR: `purpose`, `token`, `active`, `expires_at`,
  `scan_count`, `created_by`
- `memberships` — `user_id`, `club_id`, `role`, `role_expires_at`, `joined_at`
- `platform_admins`
- `audit_log` — ubah peran, setujui klaim, sesuaikan saldo, tarik deposit, putar
  token QR, tindakan superadmin. **Punya UI yang bisa dilihat admin klub**

**Identitas & akses**
- `users` — `phone` (E.164, unik), `username` (unik), `display_name`, `photo_id`,
  `status` (`unclaimed`/`active`/`disabled`)
- `user_aliases` — nama lama v2 → user, per klub (nama sama di klub berbeda bisa
  orang berbeda)
- `sessions` — token ter-hash, `expires_at`, `device_label`. **Persisten di
  Postgres** — restart tidak menendang siapa pun keluar, tidak seperti v2 yang
  menyimpan sesi di memori proses ([`v2/lib/auth.ts`](../v2/lib/auth.ts))
- `webauthn_credentials`, `user_pins` (argon2id), `otp_codes`
- `invites` (per-orang dan tautan grup), `claim_requests`, `push_subscriptions`
- `idempotency_keys` — kunci, hasil, kedaluwarsa

**Permainan**
- `games` — `club_id`, `played_at` (tanggal di zona klub), `format`, `notes`,
  `recorded_by`, `version`
- `game_players` — `game_id`, `user_id`, `side`, `slot`, `amount`, `paid_at`,
  `paid_by`. **Baris per pemain**, jumlah bebas. Inilah yang membuat "tagihan
  si A" jadi `WHERE user_id = ? AND paid_at IS NULL`, bukan pemindaian seluruh
  tabel seperti di v2
- `game_koks` — harga di-snapshot

**Turnamen**
- `tournaments`, `tournament_pairs`, `matches`, `match_games`, `match_koks`,
  `match_kok_charges`, `tournament_fees`
- `match_kok_charges` sekaligus menutup lubang **kok lepas** yang di v2 tidak
  pernah ditagih ke siapa pun — diakui sendiri di komentar
  [`v2/lib/domain/types.ts`](../v2/lib/domain/types.ts) sekitar `TournamentCost`:
  kok umum turnamen memotong stok dan masuk `kokTotal` tapi tidak punya penanggung.
  Di v3, **setiap kok wajib punya penanggung** — partai tertentu, atau dibagi rata
  ke seluruh peserta.

**Uang**
- `payments` — `club_id`, `status` (`pending`/`verified`/`rejected`), `claimed_at`,
  `claimed_by`, `verified_by`, `method`
- `wallet_entries` — ledger deposit append-only, **`club_id` wajib**. Saldo
  dihitung per (`user_id`, `club_id`), tidak pernah lintas klub (§9.1)
- `expenses`, `kok_types` per klub

Pengaturan klub tidak punya tabel sendiri — semuanya di `clubs.settings` dan
`clubs.quotas` (lihat bagian Platform & klub di atas).

**Notifikasi & media**
- `notifications` (antrean keluar + pusat notifikasi in-app), `notification_prefs`
- `media` — foto pemain & QRIS disimpan di **volume disk** dengan nama ter-hash,
  disajikan Go. v2 menyimpan data URL langsung di kolom DB; untuk banyak klub itu
  membengkakkan database dan memperlambat setiap query. Kompresi tetap dilakukan
  di klien seperti v2.

**Zona waktu.** `played_at` disimpan sebagai tanggal di **zona klub**, bukan zona
perangkat. Timestamp lain disimpan UTC dan ditampilkan di zona klub. Tanpa aturan
ini, dua klub beda zona menghasilkan laporan yang tidak konsisten — dan v2 memakai
tanggal lokal browser, jadi ini perubahan yang harus disengaja.

---

## 14. Fase kerja

Berurutan. Tiap fase menghasilkan sesuatu yang bisa dijalankan dan diperiksa.

### F0 — Fondasi

Struktur repo `v3/`, database `kok_v3` terpisah di instans Postgres yang sama,
skeleton Go (health, config, logging terstruktur, graceful shutdown), skeleton
SvelteKit, goose, Dockerfile multi-stage (build web → embed → binary), **notifier
palsu + data seed**, workflow CI yang **menjalankan test/lint/vet** — sesuatu yang
CI v2 tidak lakukan sama sekali (lihat `.github/workflows/deploy-v2.yml`, hanya
build + deploy).

**Selesai kalau:** `docker compose up` menyajikan halaman kosong dari satu binary,
dan developer bisa jalan tanpa menyentuh WhatsApp sama sekali.

### F1 — Domain di Go

Port logika murni dari v2 **beserta testnya lebih dulu (test-first)**:

- Biaya game — kini dengan jumlah pemain variabel
- `buildDebtSummary` + planner cicilan greedy best-fit —
  [`v2/lib/domain/debt.ts`](../v2/lib/domain/debt.ts)
- Pembangun bagan knockout & klasemen round robin —
  [`v2/lib/domain/tournament.ts`](../v2/lib/domain/tournament.ts)
- Aritmetika stok — [`v2/lib/domain/stock.ts`](../v2/lib/domain/stock.ts)
- **Baru:** ledger dompet dan aturan potong-otomatis

Ini bagian paling berharga dari v2 dan sudah punya cakupan test yang layak:
[`v2/lib/domain/domain.test.ts`](../v2/lib/domain/domain.test.ts) (305 baris) dan
[`v2/lib/domain/tournament.test.ts`](../v2/lib/domain/tournament.test.ts) (723
baris).

> **Terjemahkan kasus testnya ke Go dulu, baru tulis implementasinya.** Di sinilah
> bug paling mungkin masuk, dan test v2 adalah spesifikasi yang sudah teruji di
> produksi.

Tambah **property-based test** untuk dompet: saldo tidak pernah minus, jumlah
ledger selalu sama dengan saldo.

**Selesai kalau:** `go test ./internal/domain/...` hijau dengan kasus setara v2.

### F2 — Multi-tenant, store, API, realtime

Skema dengan `club_id` menyeluruh + RLS, middleware tenant, idempotensi, versi
entitas, endpoint granular, SSE bertipe, `LISTEN/NOTIFY` untuk fan-out lintas
proses.

**Titik mulainya [`DDL.sql`](DDL.sql)** — pecah jadi migrasi goose berurutan,
jangan dijalankan sebagai satu migrasi raksasa. Jalankan migrasi sebagai
`kok_migrate`, aplikasi sebagai `kok_app`: kalau aplikasi memakai pemilik tabel,
RLS terlewati diam-diam dan lapisan pengaman ketiga hilang tanpa ada yang sadar.

**Selesai kalau:** dua klien terhubung dan mutasi di satu tercermin di lain
**tanpa memuat ulang seluruh data**; suite kebocoran antar-klub hijau; kirim ganda
dengan kunci sama tidak menghasilkan entri kedua.

### F3 — Sistem desain

Token (warna yang sudah diverifikasi kontrasnya, tipografi, ruang, gerak),
komponen inti di atas Melt UI, kerangka responsif tiga breakpoint, halaman contoh
yang memamerkan seluruh komponen.

**Acuannya [`mockup/index.html`](mockup/index.html)** — skala tipografi, peran
warna, dan hierarki di situ sudah diputuskan dan diuji. Ambil nilainya, tulis
ulang markupnya di Svelte. Jangan memulai dari nol dan jangan menawar arahnya.

> **Sengaja jadi fase tersendiri.** Kalau menumpang di fase fitur, hasilnya jadi
> tambal-sulam seperti v2 yang punya dua sistem komponen hidup berdampingan.

Termasuk **token gerak** (§5.7): durasi, easing, dan aturan properti yang boleh
dianimasikan. Ditetapkan di sini supaya tiap fitur berikutnya memakai gerak yang
sama, bukan menciptakan sendiri-sendiri.

**Selesai kalau:** halaman contoh menampilkan semua komponen di terang & gelap, di
tiga breakpoint, dan setiap token teks lolos kontras 4.5:1; profil gulir halaman
contoh di HP asli tidak punya frame di atas 16ms.

### F4 — Identitas & akses

`cmd/waworker` + whatsmeow (pairing, penyimpanan sesi, reconnect), OTP, passkey +
PIN, sesi persisten, resolusi izin (jatuh-balik, masa berlaku, saklar klub),
pembuatan klub, undangan per-orang, **tautan + QR klub + generator poster**,
klaim + persetujuan, panel superadmin.

**Selesai kalau:** poster QR dicetak, dipindai HP asing, dan orang itu berhasil
gabung sampai masuk antrean persetujuan; buka app berikutnya cukup Face ID; peran
berbatas waktu turun sendiri saat kedaluwarsa; `pencatat` ditolak saat menyentuh
endpoint uang.

### F5 — UI inti + offline

Beranda (tagihanku sebagai hero), Main, Klub. Store optimistic, cermin IndexedDB,
**outbox tulis**, service worker + ajakan pembaruan versi, halaman offline &
error, pencarian orang, layar "belum punya klub", batalkan cepat, pemain tamu,
**penanggung biaya (§8.2)**, **skor opsional (§8.3)**, panduan driver.js
(perkenalan + "pasang ke Home Screen").

**Selesai kalau:** alur harian penuh berfungsi di 375px **dan** 1440px; menandai
lunas terasa instan (nol round-trip sebelum UI berubah); mode pesawat tetap bisa
dibaca dan aksinya mengantre lalu terkirim tanpa duplikat.

> **Tab Turnamen sengaja kosong sampai F7.** Navigasi empat tab dibangun utuh di
> sini, tapi isinya baru datang belakangan. Jangan biarkan tampil sebagai layar
> rusak — isi dengan keadaan kosong yang jujur ("Turnamen segera hadir"), atau
> sembunyikan tabnya lewat feature flag sampai F7 selesai.

**Batas MVP ada di sini.** Sampai F5, app sudah berguna penuh untuk satu klub.

### F6 — Uang

Deposit (ledger, potong otomatis, tarik dengan persetujuan), alur klaim →
verifikasi, QRIS statis/dinamis + decode dari foto + pencatatan keberhasilan,
laporan tiga kantong, jurnal audit yang bisa dilihat admin klub.

**Selesai kalau:** bayar lebih masuk deposit dan tagihan berikutnya terpotong
otomatis; saldo tidak pernah bisa dibuat minus lewat jalur mana pun; total ledger
selalu sama dengan saldo cache setelah rekonsiliasi; tiga kantong uang tampil
dengan penjelasannya; setiap perubahan saldo memicu notifikasi ke pemiliknya.

### F7 — Turnamen & keseruan

Bagan knockout, round robin, dialog partai, kok per partai, iuran, perbaikan kok
lepas, saran nominal iuran. Bagan tampil utuh di desktop.

Plus yang lahir dari skor main harian (§8.3): **papan peringkat klub** (klasemen,
rentetan menang, saling berhadapan) dengan saklar per klub, dan **taruhan barang**
(§8.4) sebagai ledger terpisah tanpa rupiah.

**Selesai kalau:** turnamen 8 pasangan bisa dijalankan dari pembuatan sampai juara;
**tidak ada satu kok pun yang tidak punya penanggung** (lubang kok lepas v2
tertutup); bagan tampil tanpa gulir mendatar di 1440px; papan peringkat bisa
dimatikan dan benar-benar hilang saat dimatikan; taruhan barang tidak pernah muncul
di laporan keuangan mana pun.

### F8 — Notifikasi & berbagi

Web Push (VAPID) + preferensi + jam tenang, pusat notifikasi in-app, antrean WA
dengan rate limit dan kuota per klub, jaring pengaman WA saat push gagal. Share
teks WhatsApp + kartu gambar.

**Selesai kalau:** push sampai di Android dan iOS-terpasang; jam tenang dihormati;
kuota dan jatah onboarding berfungsi; orang yang tidak berlangganan push tetap
dapat kabar lewat WA; kartu share terbaca rapi saat dikirim ke grup WhatsApp.

### F9 — Halaman publik & operasional

Rute publik read-only dengan query terpisah, backup terjadwal + uji restore,
metrik & pelacakan galat, rate limiting umum, kuota, hapus akun & ekspor data,
kebijakan privasi.

**Selesai kalau:** tes otomatis membuktikan respons publik tak pernah memuat nomor
telepon, saldo, atau riwayat bayar perorangan; halaman publik ber-`noindex`;
cadangan berhasil di-restore ke instans bersih dan app-nya jalan; klub bisa
menghapus akunnya sendiri dan mengunduh datanya.

### F10 — Migrasi & cutover

`cmd/migrate-v2` membaca DB v2 dan menulis ke skema v3 sebagai **klub pertama**.

**Idempoten** (aman diulang) dan **terverifikasi**:

- Total kas cocok
- Piutang per orang cocok
- `player_carry` v2 masuk sebagai saldo deposit awal
- Jumlah game dan partai cocok
- Semua game lama tercatat sebagai ganda 4 orang
- Tidak ada nama yang gagal dipetakan ke user

**Verifikasi gagal = transaksi dibatalkan**, bukan peringatan yang bisa diabaikan.

**Merapikan nama sebelum migrasi — langkah wajib, bukan opsional.** v2 memakai
nama sebagai kunci utama (`players.name` adalah primary key), dan nama diketik
manual berkali-kali selama bertahun-tahun. Hampir pasti ada `Rian`, `rian`, dan
`Ryan` yang sebenarnya satu orang, masing-masing memegang riwayat dan tagihan
sendiri. Kalau dimigrasikan apa adanya, orang itu jadi tiga anggota di v3 dan
tagihannya terpecah tiga — dan setelah pemiliknya mengklaim salah satu, dua
sisanya jadi hantu yang sulit digabungkan.

Karena itu `cmd/migrate-v2` menjalankan tahap pra-migrasi:

1. Cetak daftar nama yang mirip (normalisasi huruf besar-kecil, spasi ganda,
   jarak Levenshtein kecil) beserta jumlah game dan nilai tagihan masing-masing.
2. **Manusia yang memutuskan** mana yang digabung — bukan tebakan otomatis.
   Salah menggabungkan dua orang berbeda jauh lebih merusak daripada membiarkan
   satu orang punya dua entri.
3. Keputusan disimpan sebagai berkas pemetaan yang ikut masuk repo, supaya
   migrasi tetap **idempoten** dan latihan berulang menghasilkan hasil sama persis.
4. Nama yang digabung tetap tersimpan semua di `user_aliases`, jadi riwayat lama
   yang menyebut nama versi mana pun tetap menemukan orangnya.

`recorded_by` di v2 juga berupa teks nama bebas ("Admin", nama operator).
Dipetakan ke user kalau cocok; kalau tidak, disimpan apa adanya sebagai teks —
jangan mengarang penautan yang tidak pasti pada data pembukuan.

Karena **tidak ada jalur pulang**, pengamannya ada di depan: latihan migrasi
berulang di salinan produksi sampai nol selisih; cadangan DB tepat sebelum cutover
yang **sudah diuji restore**; masa pemantauan ketat beberapa hari pertama.

**Rilis:** v3 naik di subdomain baru berdampingan dengan v2 yang masih jalan.
Setelah anggota pindah dan angkanya terbukti cocok, v2 dibekukan read-only sebagai
arsip, dan **v1 (Express di akar repo) dimatikan**.

---

## 15. Risiko

| Risiko | Penanganan |
|---|---|
| **Kebocoran data antar klub** — paling fatal di multi-tenant | Tiga lapis: middleware tenant, `club_id` wajib di tiap query, RLS. Suite kebocoran di tiap CI |
| **Halaman publik / QR membocorkan data pribadi** | Rute + query terpisah yang secara struktur tidak punya akses ke field pribadi — bukan penyaringan di UI |
| **QR tembok disalahgunakan** | Pendaftaran lewat QR selalu antre persetujuan; token bisa diputar/dicabut; rate limit per IP; jumlah pindaian dipantau |
| **Kirim ganda menciptakan uang** | `Idempotency-Key` wajib; hasil disimpan dan dikembalikan apa adanya |
| **Deposit salah hitung** | Ledger append-only sebagai kebenaran; saldo cuma cache; rekonsiliasi berkala; property-based test; larangan minus menghapus satu kelas galat |
| **Nomor WA dibanned** — menyeret semua klub | Volume ditekan lewat Push-utama; kuota per klub; antrean berjeda; kode undangan + PIN sebagai jalur masuk kedua; `Notifier` siap pindah ke Cloud API |
| **Sesi WA putus tanpa ketahuan** | Pemantauan berkala + peringatan ke superadmin + halaman status |
| **Bug saat port logika uang** | Port test v2 lebih dulu sebagai spesifikasi; jalankan v2 & v3 pada data sama saat verifikasi migrasi dan bandingkan tiap angka |
| **Cutover gagal tanpa jalur pulang** | Latihan berulang sampai nol selisih; cadangan yang sudah diuji restore; masa pemantauan ketat |
| **Desain kembali jadi tambal-sulam** | Sistem desain jadi fase tersendiri (F3) sebelum layar mana pun dibangun |
| **Superadmin tak bisa mendiagnosis** — konsekuensi sadar | Observability serius (§12); jalur izin sementara dari admin klub |
| **Jumlah pemain variabel merusak perhitungan lama** | Migrasi menetapkan semua game v2 sebagai ganda 4 orang; test perbandingan angka v2 vs v3 |
| **RLS bocor lewat koneksi yang dipakai ulang** | Semua akses DB lewat satu pembungkus transaksi ber-`SET LOCAL`; role aplikasi tunduk RLS; tes kebocoran mencakup dua permintaan beda klub berurutan di pool sama (§6.2) |
| **Orang terkunci karena kehilangan nomor WA** | Admin klub bisa memindahkan akun ke nomor baru, wajib beralasan dan tercatat di jurnal audit yang dibaca seluruh anggota (§7.2.1) |
| **Kuota WA pecah tepat di hari onboarding** | Jatah onboarding sekali pakai 300 pesan, terpisah dari kuota harian (§12.1) |
| **Klub dihapus padahal masih memegang titipan pemain** | Penghapusan permanen ditahan selama saldo deposit belum nol; superadmin diberi tahu (§12.2) |
| **Nama duplikat v2 memecah tagihan satu orang jadi beberapa** | Tahap merapikan nama sebelum migrasi, diputuskan manusia, disimpan sebagai berkas pemetaan yang ikut repo (F10) |
| **Orang ditagih untuk main yang tidak diikutinya** | Notifikasi "kamu dicatat ikut main" seketika + tombol sanggah yang menahan tagihan sampai selesai (§9.4) |
| **Salah tap merusak data dan tak bisa dikembalikan** | Batalkan cepat 8 detik yang benar-benar membatalkan, bukan membuat aksi berlawanan (§9.4) |
| **Animasi justru bikin patah-patah** | Anggaran gerak ≤300ms, hanya properti compositor, tanpa `backdrop-blur`, animasi masuk hanya untuk item yang benar-benar baru; profil gulir diukur di HP asli (§5.7) |
| **Panduan driver.js jadi gangguan, bukan bantuan** | Dimuat malas, sekali per panduan, tak pernah menyela pekerjaan, dan bukan penambal layar yang memang membingungkan (§5.8) |
| **Lingkup membengkak** | Fase berurutan; F0–F5 sudah app berguna untuk satu klub walau sisanya tertunda |
| **v3 tetap terasa berat** | Anggaran performa ditegakkan sejak F5, diukur bukan diasumsikan |

---

## 16. Verifikasi

1. **Go** — `go test ./...`, `go vet ./...`, `golangci-lint run`. Domain wajib
   punya test yang diturunkan dari test v2, plus property-based test untuk dompet.
2. **Web** — `svelte-check`, lint, vitest untuk store, outbox, dan logika format.
3. **Kontrak** — spesifikasi OpenAPI jadi sumber kebenaran; tipe klien di-generate
   darinya, sehingga API dan UI tidak bisa berbeda diam-diam.
4. **Isolasi tenant** — pengguna klub A menembak tiap endpoint klub B dan harus
   selalu ditolak. Wajib hijau tiap CI.
5. **Halaman publik & QR** — pemeriksaan otomatis bahwa respons publik tidak pernah
   memuat nomor telepon, saldo deposit, atau riwayat pembayaran perorangan.
6. **Idempotensi** — kirim aksi bayar dua kali dengan kunci sama; pastikan hanya
   satu entri terbentuk.
7. **Konflik** — dua klien menandai lunas item yang sama; yang kalah dapat `409`
   dan pesan jelas, bukan penimpaan diam-diam.
8. **E2E (Playwright)** — buat klub baru → catat main sebagai satu-satunya anggota;
   catat main single dan rotasi; gabung lewat QR sampai disetujui (bridge WA
   dipalsukan); login ulang dengan passkey **dan** dengan PIN; peran sementara
   kedaluwarsa; bayar lebih → masuk deposit → tagihan berikutnya terpotong
   otomatis; klaim + verifikasi bayar; buat turnamen + isi skor; **ganti nomor
   lewat admin**; **satu orang di dua klub** — pastikan saldo dan angka Beranda
   tidak pernah tercampur antar klub.
9. **Poster** — unduh PDF A4 & A5, cetak, pindai dengan beberapa HP berbeda,
   pastikan QR terbaca dari jarak sekitar 1,5 meter.
10. **Offline** — mode pesawat: app tetap terbaca, aksi mengantre, terkirim saat
    online, tidak ada duplikat.
11. **Manual di browser** — 375×812 dan 1440×900, di kedua tema. Tidak boleh ada
    scroll horizontal pada badan halaman di mobile.
12. **Realtime** — dua tab, mutasi di satu, yang lain menambal tanpa memuat ulang
    (panel network: nol permintaan data).
13. **PWA** — build produksi, pasang ke home screen, matikan jaringan: shell +
    data terakhir tetap tampil; uji ajakan pembaruan versi.
14. **Notifikasi** — Web Push diuji di Android dan iOS-terpasang; jam tenang
    dihormati; pengalihan ke WA jalan saat push gagal; kuota per klub berfungsi.
15. **Performa** — ukuran shell, waktu tap→UI berubah untuk "tandai lunas",
    Lighthouse mobile.
16. **Kehalusan** — rekam profil gulir di **HP kelas menengah asli**, bukan
    simulator desktop: tidak ada frame > 16ms saat menggulir daftar main sepanjang
    satu bulan. Periksa juga tidak ada pergeseran tata letak saat data masuk, dan
    `prefers-reduced-motion` benar-benar mengganti gerak, bukan sekadar
    mempercepatnya.
17. **Batalkan & sanggah** — batalkan dalam 8 detik benar-benar mengembalikan
    keadaan tanpa meninggalkan pasangan aksi di jurnal audit; menyanggah menahan
    tagihan dan memberi tahu pencatat.
18. **Pemain tamu** — catat main dengan nama yang belum pernah ada, pastikan
    anggota `unclaimed` terbentuk, bisa ditagih, lalu bisa diklaim lewat QR dan
    riwayatnya menempel. Ulangi lewat pasangan turnamen dari luar klub.
19. **Aksi massal** — tandai lunas 20 orang sekaligus; pastikan konfirmasinya
    menyebut jumlah orang dan total rupiah, jurnal audit mencatatnya sebagai satu
    entri, "Batalkan" mengembalikan seluruh kumpulan, dan aksinya ditolak saat
    offline.
20. **Nada bicara** — sisir seluruh teks antarmuka: tidak ada kode galat mentah
    yang bocor ke pengguna, tidak ada angka tanpa format rupiah, dan tidak ada
    kata bernada menghakimi di layar tagihan.
21. **Penanggung biaya** — catat main dengan A menanggung tagihan B; pastikan
    "Tagihanku" milik A bertambah dan milik B tidak, potong otomatis memakai
    dompet A, keduanya dapat notifikasi, dan **B tetap yang berhak menyanggah**.
22. **Skor & papan peringkat** — catat main tanpa skor (harus tetap secepat v2),
    lalu dengan skor di ketiga format termasuk `rally42`; matikan papan peringkat
    di pengaturan klub dan pastikan benar-benar hilang, bukan cuma disembunyikan.
23. **Taruhan barang** — pastikan tidak pernah muncul di kas, deposit, tagihan,
    laporan tiga kantong, atau pengingat WA.
24. **Aksesibilitas** — telusuri satu halaman penuh dengan Tab saja; rasio kontras
    tiap token teks diverifikasi sebelum dipakai; uji keterbacaan di bawah cahaya
    terang; overlay driver.js bisa ditelusuri keyboard dan tidak menjebak fokus.
25. **Pemulihan** — restore cadangan ke instans bersih dan pastikan app jalan.
26. **Migrasi** — perbandingan angka v2 vs v3 nol selisih, termasuk `player_carry`
    → saldo deposit awal, sebelum cutover. Berkas pemetaan nama duplikat sudah
    ditinjau manusia dan ikut tersimpan di repo.

---

## 17. Angka bawaan yang boleh ditinjau ulang

Tidak ada lagi keputusan yang menunggu — seluruh arah sudah terkunci di §2. Yang
tersisa hanya angka, dan angka boleh diubah tanpa membongkar rancangan. Dikumpulkan
di sini supaya mudah ditemukan saat mau disetel:

| Angka | Nilai | Rujukan |
|---|---|---|
| Ambang tunggakan | 14 hari · Rp 50.000 · jeda 7 hari | §10.3 |
| Masa berlaku sesi | 90 hari, diperpanjang otomatis | §7.2 |
| Jeda sebelum minta kunci ulang | 7 hari sejak app terakhir dibuka | §7.2 |
| TTL OTP | 5 menit, maks 5 percobaan | §7.2 |
| Jam tenang notifikasi | 21.00–07.00 | §10.2 |
| Ambang "tak berlangganan push" → alihkan ke WA | 14 hari | §10.1 |
| Tenggang hapus klub | 30 hari, peringatan hari ke-23 | §12.2 |
| Jatah onboarding WA | 300 pesan, aktif 14 hari | §12.1 |
| Jendela "Batalkan" | 8 detik | §9.4 |
| Pengingat klaim bayar menganggur | 3 hari | §9.3 |
| Kuota | lihat tabel | §12.1 |
| Anggaran performa | shell < 80KB gzip · interaksi < 100ms | §4.2 |
| Anggaran gerak | ≤ 300ms, frame ≤ 16ms saat gulir | §5.7 |

Semuanya harus dibaca dari konfigurasi, **bukan ditulis sebagai konstanta tersebar
di dalam kode.** Yang per-klub disimpan di `clubs.settings` / `clubs.quotas`; yang
tingkat platform di konfigurasi server.

---

## 18. Backlog (di luar lingkup sekarang)

- Transfer bank dengan kode unik 3 digit sebagai jalur pembayaran
- **Menggabungkan dua akun** milik orang yang sama (dua nomor berbeda) — sekarang
  belum ada jalannya; sementara ditangani manual oleh superadmin
- Domain sendiri per klub
- Meta WhatsApp Cloud API menggantikan whatsmeow
- Impor data klub baru dari Excel/CSV
- Ekspor CSV/JSON per klub
- i18n (struktur disiapkan; isi hanya Bahasa Indonesia untuk sekarang)
- Penagihan berlangganan kalau platform dipakai klub luar secara serius
