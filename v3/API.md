# Kok Badminton v3 — Kontrak API

Rujukan: [`PLAN.md`](PLAN.md) untuk kenapa, [`DDL.sql`](DDL.sql) untuk bentuk data.
Dokumen ini adalah bentuk konkret dari §2 fase F2 (Store & API) —
permukaan HTTP yang harus ada sebelum satu baris handler Go ditulis.

Status: **daftar endpoint + kontrak, belum jadi berkas OpenAPI mesin-baca.**
Saat dikerjakan, pindahkan tabel di bawah ke `openapi.yaml` lewat generator
atau tulis tangan — isi tabel ini adalah sumber kebenarannya, formatnya boleh
berubah.

---

## 0. Konvensi yang berlaku di semua endpoint

Ini bukan basa-basi. Tiap baris di sini menegakkan satu invarian dari
[`PLAN.md §3`](PLAN.md#3-invarian--tidak-boleh-dilanggar) atau menutup satu
lubang yang sudah ditemukan di telaah sebelumnya.

**Dasar**

- Semua endpoint di bawah `/api/v1/`.
- Isi selalu JSON. Rupiah selalu `bigint` (angka JSON tanpa desimal), tidak
  pernah string berformat, tidak pernah float. *(invarian §3.1)*
- Tanggal `YYYY-MM-DD` di zona klub (§13). Waktu `RFC3339` UTC.
- ID selalu UUID v4.

**Tenant**

- Rute klub berbentuk `/api/v1/clubs/{clubId}/...`. Middleware menetapkan
  `SET LOCAL app.club_id` dari path, **dan** memverifikasi pemanggil adalah
  anggota `clubId` itu sebelum query apa pun jalan. *(§6.2)*
- Rute lintas klub (auth, profil sendiri, superadmin) tidak punya `{clubId}`.

**Idempotensi** *(invarian §3.3, wajib di SEMUA method selain GET)*

- Header `Idempotency-Key: <uuid v4 dibuat klien>` wajib di setiap
  `POST`/`PUT`/`PATCH`/`DELETE`.
- Kunci yang sama + isi permintaan yang sama → server mengembalikan respons
  tersimpan apa adanya, tanpa menjalankan ulang efeknya.
- Kunci yang sama + isi **berbeda** → `409 Conflict` dengan kode
  `idempotency_key_reused`. Ini mencegah klien memakai ulang kunci untuk
  permintaan yang tidak sama.
- Kunci kedaluwarsa mengikuti `idempotency_keys.expires_at` (24 jam cukup).

**Versi & tabrakan** *(invarian §3.4)*

- Setiap entitas yang bisa diedit menyertakan `version` di respons GET.
- Endpoint tulis atas entitas itu **wajib** mengirim balik `version` yang
  dilihat klien, lewat header `If-Match: <version>` atau field `version` di
  body — pilih satu, konsisten di semua endpoint.
- Versi tidak cocok → `409 Conflict`, kode `version_conflict`, body memuat
  entitas **terbaru** supaya klien bisa menampilkan pilihan yang jelas
  (§9.4), bukan menimpa diam-diam.

**Kesalahan**

Bentuk galat seragam di semua endpoint — supaya lapisan UI (§5.6.1) bisa
menerjemahkan `code` ke bahasa manusia di satu tempat, bukan tersebar:

```json
{
  "error": {
    "code": "insufficient_permission",
    "message": "Kamu tidak punya izin bendahara di klub ini.",
    "detail": {}
  }
}
```

`message` adalah bahasa Indonesia yang sudah pantas ditampilkan (§5.6.1) —
klien tidak menerjemahkan `code` sendiri kecuali untuk keperluan pencabangan
logika. Kode yang dipakai berulang di seluruh API:

| Kode | HTTP | Kapan |
|---|---|---|
| `validation_failed` | 400 | Input tidak lolos aturan domain |
| `unauthenticated` | 401 | Sesi tidak ada / kedaluwarsa |
| `insufficient_permission` | 403 | Peran tidak mengizinkan (§7.4) |
| `not_found` | 404 | Entitas tidak ada / bukan milik klub ini |
| `version_conflict` | 409 | Lihat di atas |
| `idempotency_key_reused` | 409 | Lihat di atas |
| `wallet_would_go_negative` | 422 | Trigger DB menolak (§9.1) — seharusnya sudah dicegah domain sebelum sampai sini |
| `quota_exceeded` | 429 | Kuota klub/platform tercapai (§12.1) |
| `rate_limited` | 429 | OTP / percobaan login berlebihan |

**Paginasi** — daftar panjang (games, payments, notifications, audit_log)
memakai cursor, bukan offset:

```
GET /api/v1/clubs/{clubId}/games?before=2026-08-01&limit=30
→ { "items": [...], "next_cursor": "2026-07-02" }
```

Alasan cursor bukan offset: pada daftar yang terus bertambah, offset
menghasilkan baris dobel/hilang saat halaman digeser sambil data baru masuk —
persis kondisi realtime yang dipakai app ini.

**Aksi massal** *(§9.5 aturan "boleh berhasil sebagian")* — respons memuat
hasil per baris, bukan satu status untuk semuanya:

```json
{
  "results": [
    { "id": "...", "ok": true },
    { "id": "...", "ok": false, "error": { "code": "version_conflict", "message": "..." } }
  ]
}
```

---

## 1. Auth & identitas — lintas klub

Rujuk [`PLAN.md §7`](PLAN.md#7-identitas-akun-dan-akses).

| Method & path | Untuk apa | Catatan |
|---|---|---|
| `POST /auth/otp/request` | Kirim OTP ke nomor | Body `{phone, purpose}`. Rate limit per nomor+IP (§7.2) |
| `POST /auth/otp/verify` | Verifikasi OTP, buat sesi | Body `{phone, code}` → `{session_token, user}` |
| `POST /auth/passkey/register/options` | Mulai daftar passkey | WebAuthn challenge |
| `POST /auth/passkey/register/verify` | Selesaikan daftar passkey | |
| `POST /auth/passkey/login/options` | Mulai login passkey | |
| `POST /auth/passkey/login/verify` | Selesaikan login passkey | |
| `POST /auth/pin/set` | Set/ganti PIN cadangan | |
| `POST /auth/pin/verify` | Login pakai PIN | |
| `POST /auth/logout` | Cabut sesi ini | |
| `GET /auth/sessions` | Daftar perangkat aktif | §7.2.2 |
| `DELETE /auth/sessions/{id}` | Keluarkan satu perangkat | Ikut cabut passkey di perangkat itu |
| `POST /auth/sessions/revoke-others` | Keluarkan semua kecuali ini | |
| `GET /me` | Profil sendiri lintas klub | `{id, username, display_name, phone, memberships[]}` |
| `PATCH /me` | Ubah nama tampilan / username | Jeda ganti username (§7.1) |
| `DELETE /me` | Hapus akun | Anonimisasi, bukan hapus baris (§12) |
| `GET /me/notification-prefs` | Preferensi notifikasi (semua klub) | |
| `PATCH /me/notification-prefs` | Ubah preferensi | |
| `POST /me/push-subscriptions` | Daftar endpoint Web Push | |
| `DELETE /me/push-subscriptions/{id}` | Cabut langganan | |

**Pemulihan nomor hilang** (§7.2.1) — bukan endpoint auth pengguna sendiri,
tapi tindakan admin klub atas anggotanya. Lihat §4 di bawah.

---

## 2. Klub — pembuatan, pengaturan, keanggotaan

| Method & path | Untuk apa | Peran minimum |
|---|---|---|
| `POST /clubs` | Bikin klub baru | siapa saja yang punya akun (§6.6) |
| `GET /clubs/{clubId}` | Detail + `settings`, `quotas` | anggota |
| `PATCH /clubs/{clubId}/settings` | Ubah saklar (§7.4, §10.3) | admin |
| `GET /clubs/{clubId}/members` | Daftar anggota, dengan pencarian `?q=` | anggota |
| `PATCH /clubs/{clubId}/members/{userId}/role` | Ubah peran + `role_expires_at` | admin |
| `PATCH /clubs/{clubId}/members/{userId}/auto-deduct` | Nyala/mati potong otomatis pribadi | diri sendiri atau admin |
| `POST /clubs/{clubId}/members/{userId}/relocate-phone` | **Pindahkan akun ke nomor baru** | admin — §7.2.1, wajib `reason`, tercatat `visible_to_members=true` |
| `DELETE /clubs/{clubId}/members/{userId}` | Keluarkan anggota | admin |
| `POST /clubs/{clubId}` *(soft-delete)* → `DELETE /clubs/{clubId}` | Hapus klub | admin — ditolak kalau ada saldo deposit tersisa (§12.2) |
| `POST /clubs/{clubId}/restore` | Batalkan penghapusan dalam masa tenggang | admin/superadmin |

**Undangan & klaim** (§6.4, §7.3)

| Method & path | Untuk apa |
|---|---|
| `POST /clubs/{clubId}/links` | Buat tautan/QR (`purpose: join\|poster`) |
| `GET /clubs/{clubId}/links` | Daftar tautan aktif |
| `POST /clubs/{clubId}/links/{id}/rotate` | Putar token, poster lama mati |
| `DELETE /clubs/{clubId}/links/{id}` | Cabut |
| `GET /clubs/{clubId}/links/{id}/poster` | Unduh PDF/PNG siap cetak (§6.4) |
| `GET /join/{token}` | **Publik, tanpa auth.** Info klub buat halaman "Gabung klub" |
| `POST /join/{token}` | Kirim OTP + mulai klaim, lewat token QR |
| `POST /clubs/{clubId}/invites` | Undangan per-orang (nomor spesifik) |
| `GET /clubs/{clubId}/claim-requests?status=pending` | Antrean persetujuan (§7.3) |
| `POST /clubs/{clubId}/claim-requests/{id}/approve` | Setujui — riwayat menempel |
| `POST /clubs/{clubId}/claim-requests/{id}/reject` | Tolak |

---

## 3. Main — game, pemain, skor

Rujuk [`PLAN.md §8`](PLAN.md#8-format-main-yang-fleksibel).

| Method & path | Untuk apa |
|---|---|
| `GET /clubs/{clubId}/games?before=&limit=` | Daftar main, per bulan (§4.2) |
| `POST /clubs/{clubId}/games` | Catat main — lihat bentuk body di bawah |
| `GET /clubs/{clubId}/games/{id}` | Detail satu main |
| `PATCH /clubs/{clubId}/games/{id}` | Edit (skor, catatan, kok) — `If-Match` version |
| `DELETE /clubs/{clubId}/games/{id}` | Hapus (soft-delete) |
| `POST /clubs/{clubId}/games/{id}/undo` | **Batalkan cepat**, jendela 8 detik (§9.4) |
| `POST /clubs/{clubId}/games/{id}/players/{playerId}/dispute` | Sanggah — `{note}` |
| `POST /clubs/{clubId}/games/{id}/players/{playerId}/resolve-dispute` | Pencatat/bendahara menyelesaikan |

**Body `POST games`** — menunjukkan langsung bagaimana `payer_id` (§8.2) dan
skor opsional (§8.3) masuk ke satu payload:

```json
{
  "played_on": "2026-08-08",
  "format": "ganda",
  "players": [
    { "user_id": "...", "side": "a", "slot": 1 },
    { "user_id": "...", "side": "a", "slot": 2, "payer_id": "<user_id slot 1>" },
    { "user_id": "...", "side": "b", "slot": 1 },
    { "user_id": "...", "side": "b", "slot": 2 }
  ],
  "koks": [
    { "kok_type_id": "...", "qty": 2 }
  ],
  "score": {
    "format": "rally42",
    "games": [{ "a": 42, "b": 38 }]
  },
  "notes": "court 3"
}
```

Perhatikan: `payer_id` di baris pemain slot 2 sisi A menunjuk ke `user_id`
pemain lain — itulah "dibayarin pasangan" (§8.2). `payer_id` yang tidak
disebut jatuh ke `user_id`-nya sendiri (bawaan). `score` boleh dihilangkan
sepenuhnya — mencatat main tanpa skor harus tetap secepat v2.

**Biaya dihitung server, bukan klien.** Klien mengirim `koks` dan daftar
pemain; server yang menjalankan pembulatan-ke-atas-ke-ratusan (§9.5 aturan A)
dan menetapkan `amount` tiap baris `game_players`. Ini bukan pilihan gaya —
kalau klien yang menghitung, dua HP dengan versi app berbeda bisa
menghasilkan `amount` berbeda untuk main yang sama.

**Taruhan** (§8.4)

| Method & path | Untuk apa |
|---|---|
| `POST /clubs/{clubId}/games/{id}/settle-bet` | Preset "yang kalah bayar kok" — pindahkan `payer_id` semua baris ke sisi kalah |
| `POST /clubs/{clubId}/side-bets` | Catat taruhan barang — `{game_id?, debtor_id, creditor_id, item}` |
| `PATCH /clubs/{clubId}/side-bets/{id}` | Tandai lunas/batal |
| `GET /clubs/{clubId}/side-bets?open=true` | Daftar taruhan terbuka |

---

## 4. Tagihan & uang

Rujuk [`PLAN.md §9`](PLAN.md#9-uang).

**Tagihanku** — endpoint tunggal yang menjawab layar Beranda (§5.5):

```
GET /clubs/{clubId}/me/bill
→ {
    "total_owed": 47000,
    "wallet_balance": 12000,
    "auto_deduct": true,
    "items": [
      { "kind": "game", "id": "...", "game_id": "...", "amount": 15000,
        "played_on": "2026-08-08", "status": "unpaid" },
      { "kind": "game", "id": "...", "game_id": "...", "amount": 16000,
        "played_on": "2026-08-06", "status": "pending_review", "claimed_at": "..." }
    ]
  }
```

`id` = id baris tagihan itu sendiri (`game_players.id` buat `kind: "game"`) —
inilah yang dikirim balik ke `item_ids` di `POST bills/mark-paid` di bawah,
BUKAN `game_id`: satu game bisa punya beberapa baris tagihan (pemain
berbeda, atau satu penanggung menanggung beberapa pemain di game yang
sama), jadi `game_id` sendirian tidak cukup menunjuk baris yang mana.
`game_id` tetap ikut buat tautan ke detail main itu.

`status` di tiap item: `unpaid` | `pending_review` (§9.3) | `disputed` (§9.4).
Item `disputed` tidak ikut `total_owed`. Ini yang membuat status "menunggu
dicek bendahara" jujur di UI, bukan angka yang diam-diam tidak berubah.
`pending_review` baru terisi mulai F6 (payments/claim + verifikasi) — F5
cuma menghasilkan `unpaid`/`disputed`.

**Bendahara**

| Method & path | Untuk apa |
|---|---|
| `GET /clubs/{clubId}/bills?status=unpaid` | Rekap semua anggota |
| `POST /clubs/{clubId}/bills/mark-paid` | **Aksi massal** — `{item_ids: [...]}` → respons per-baris (§0) |
| `POST /clubs/{clubId}/payments/{id}/verify` | Setujui klaim bayar (§9.3) |
| `POST /clubs/{clubId}/payments/{id}/reject` | Tolak klaim |

**Pemain sendiri**

| Method & path | Untuk apa |
|---|---|
| `POST /clubs/{clubId}/payments/claim` | "Sudah transfer" — `{item_ids: [...], amount, method}` |
| `POST /clubs/{clubId}/payments/claim/{id}/cancel` | Batalkan klaim sendiri sebelum diverifikasi |

**Deposit**

| Method & path | Untuk apa |
|---|---|
| `GET /clubs/{clubId}/me/wallet` | Saldo + riwayat ledger sendiri |
| `POST /clubs/{clubId}/wallet/{userId}/topup` | Bendahara mencatat top-up |
| `POST /clubs/{clubId}/wallet/{userId}/withdraw` | Tarik saldo — wajib persetujuan admin (§9.1) |
| `GET /clubs/{clubId}/wallet/{userId}` | Saldo + ledger (bendahara/admin) |

Potong otomatis **tidak punya endpoint sendiri** — ia terjadi di dalam
transaksi `POST games` (§9.5 aturan C), bukan dipicu terpisah. Respons
`POST games` menyertakan `wallet_deductions` kalau ada, supaya klien bisa
menampilkan "Deposit menutup: ..." seketika (§9.5 aturan B).

**Kas & QRIS**

| Method & path | Untuk apa |
|---|---|
| `GET /clubs/{clubId}/treasury` | Tiga kantong (§9.2) — dihormati saklar transparansi kas |
| `POST /clubs/{clubId}/expenses` | Catat pengeluaran / beli slop |
| `GET /clubs/{clubId}/qris` | QRIS statis tersimpan |
| `PUT /clubs/{clubId}/qris` | Upload/decode dari foto |
| `POST /clubs/{clubId}/qris/dynamic` | Buat QR dinamis sekali pakai — `{amount}` |
| `POST /clubs/{clubId}/qris/dynamic/{id}/report-rejected` | Catat kegagalan (§9.5) |

---

## 5. Turnamen

Rujuk [`PLAN.md §8.1`](PLAN.md#81-pemain-tamu--orang-yang-belum-atau-tidak-akan-punya-akun)
(tamu) dan skema `tournaments`/`matches`/`match_kok_charges` di DDL.

| Method & path | Untuk apa |
|---|---|
| `GET /clubs/{clubId}/tournaments` | Daftar |
| `POST /clubs/{clubId}/tournaments` | Buat — termasuk `pairs[]` (boleh tamu, §8.1) |
| `GET /clubs/{clubId}/tournaments/{id}` | Detail + bagan/klasemen |
| `PATCH /clubs/{clubId}/tournaments/{id}` | Ubah fee, catatan |
| `POST /clubs/{clubId}/tournaments/{id}/matches/{matchId}/score` | Isi skor |
| `POST /clubs/{clubId}/tournaments/{id}/matches/{matchId}/koks` | Tambah kok partai |
| `POST /clubs/{clubId}/tournaments/{id}/koks` | Kok umum (dibagi rata — menutup lubang kok lepas v2) |
| `GET /clubs/{clubId}/tournaments/{id}/fees` | Status iuran per peserta |
| `POST /clubs/{clubId}/tournaments/{id}/fees/{userId}/mark-paid` | Tandai lunas satu orang |
| `POST /clubs/{clubId}/tournaments/{id}/kok-charges/mark-paid` | **Aksi massal** — `{ids: [...]}` → respons per-baris (§0), tandai lunas tagihan kok (per-partai ATAU umum, `match_kok_charges`) |
| `GET /clubs/{clubId}/leaderboard?season=` | Papan peringkat (§8.3) — `404` kalau saklar mati |

---

## 6. Notifikasi & berbagi

| Method & path | Untuk apa |
|---|---|
| `GET /me/notifications?unread=true` | Pusat notifikasi in-app (§10.1) |
| `POST /me/notifications/{id}/read` | Tandai dibaca |
| `POST /clubs/{clubId}/share/bill/{userId}` | Render kartu PNG / teks tagihan (§5.9) |
| `POST /clubs/{clubId}/share/tournament/{id}` | Kartu turnamen |

---

## 7. Superadmin

Tanpa `{clubId}` di path, tapi **memuat referensi klub di body/query** —
karena superadmin tidak boleh membaca isi klub (§6.5), endpoint di sini
sengaja tidak punya padanan "lihat data klub":

| Method & path | Untuk apa |
|---|---|
| `GET /admin/clubs` | Daftar klub + metrik agregat (jumlah anggota, aktivitas) |
| `POST /admin/clubs/{id}/suspend` | Tangguhkan |
| `POST /admin/clubs/{id}/quotas` | Naikkan kuota (§12.1) |
| `GET /admin/wa/health` | Status koneksi whatsmeow (§12) |
| `GET /admin/notifications/queue-depth` | Antrean WA/Push |
| `POST /admin/impersonation-grants` | Buat izin akses sementara (§6.5) — **wajib** `reason`, kedaluwarsa pendek, dan **memicu notifikasi ke admin klub bersangkutan saat dibuat** |

---

## 8. Realtime — SSE

Satu koneksi per klien, bukan per klub — pelanggan mendengarkan semua klub
yang dia ikuti sekaligus, filter di klien.

```
GET /api/v1/events?club_id=<uuid>&club_id=<uuid>...
  (Server-Sent Events, header Last-Event-ID buat resume)

event: game.created
data: {"club_id":"...","id":"...","played_on":"2026-08-08"}

event: bill.updated
data: {"club_id":"...","user_id":"...","total_owed":47000}

event: payment.verified
data: {"club_id":"...","id":"...","user_id":"..."}
```

**Beda mendasar dari v2:** event v2 cuma `"update"` dan klien
`router.refresh()` seluruh halaman
([`v2/components/realtime-refresher.tsx`](../v2/components/realtime-refresher.tsx)).
Di sini tiap event bertipe dan **membawa entitas yang berubah** — store
klien menambal baris itu saja. Ini bukan detail kecil; ini yang menjawab
klaim performa di [`PLAN.md §4.2`](PLAN.md#42-kenapa-ini-akan-terasa-lebih-cepat).

Jenis event minimum yang harus ada di F2: `game.created`, `game.updated`,
`game.deleted`, `bill.updated`, `payment.claimed`, `payment.verified`,
`wallet.updated`, `dispute.opened`, `dispute.resolved`, `claim.requested`,
`session.revoked` *(padanan `event: session` di v2, dipertahankan karena
terbukti perlu untuk logout instan lintas tab)*. **Dipicu nyata di F2**
cuma `game.created/updated/deleted` dan `bill.updated` — sisanya
didaftarkan sebagai tipe (`internal/realtime/events.go`) dan nyala saat
F4/F6 membangun endpoint aslinya (payments/wallet/klaim/sesi ada di luar
lingkup F2, lihat PLAN.md §14).

**`tournament.updated`** (F7) — satu kind buat semua perubahan turnamen
(buat, ubah, isi skor, tambah kok, iuran/kok lunas). Payload SELALU
turnamen penuh (bagan/klasemen sudah terhitung), bukan diff per-field —
lebih sederhana daripada satu kind per aksi kecil, dan klien cukup
menimpa entri di store-nya berdasar `id`.

**`club_id` di query wajib di F2** — belum ada `GET /me` (§1, F4) buat
server tahu sendiri klub mana yang diikuti pemanggil, jadi klien
menyebutkan klub yang mau didengarkan secara eksplisit. Server tetap
memverifikasi keanggotaan tiap `club_id` sebelum mendaftarkan langganan
(request dengan klub yang bukan miliknya diam-diam diabaikan, bukan
error — sama semangatnya dengan 404 di §0). Begitu `GET /me` ada, ini
berubah jadi "auto-discover dari memberships", parameter `club_id` jadi
opsional (override), bukan wajib.

---

## 9. Yang sengaja belum diisi di sini

- **Skema request/response lengkap tiap field** — tabel di atas menunjukkan
  bentuknya, bukan validasi lengkap. Itu ditulis sebagai anotasi Go di
  `internal/http/` (struct tag) dan/atau `openapi.yaml`, saat kode ditulis.
- **Rate limit per endpoint** — angka bawaannya ikut §17 `PLAN.md`; endpoint
  spesifik yang butuh limitnya sendiri (mis. `POST /auth/otp/request`)
  ditandai saat implementasi.
- **Webhook keluar** (kalau nanti ada integrasi pihak ketiga) — di luar
  lingkup F0–F10.

Kalau saat menulis handler ada bentuk yang tidak cocok dengan tabel ini,
**perbarui dokumen ini di commit yang sama** — jangan biarkan kontraknya
menyimpang diam-diam dari implementasinya.
