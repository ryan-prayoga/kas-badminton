-- Kok Badminton v3 — skema awal.
--
-- Rujukan: v3/PLAN.md. Berkas ini adalah bentuk konkret dari §13 (Skema data).
-- Pecah jadi beberapa migrasi goose saat dikerjakan; disatukan di sini supaya
-- bisa dibaca sebagai satu gambar utuh.
--
-- Tiga hal yang menentukan bentuk skema ini:
--
--   1. UANG SELALU BIGINT RUPIAH. Tidak ada NUMERIC, tidak ada FLOAT
--      (PLAN.md §3 invarian 1).
--   2. SETIAP TABEL MILIK KLUB PUNYA club_id, dan RLS menegakkannya sebagai
--      jaring terakhir (§3 invarian 2, §6.2).
--   3. SETIAP ENTITAS YANG BISA DIEDIT PUNYA version untuk deteksi tabrakan
--      (§3 invarian 4).
--
-- Target skala ~10 klub / ~300 orang (§4.2) — indeks di bawah dipilih untuk
-- itu, bukan untuk skala yang tidak akan datang.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- username & slug case-insensitive
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- pencarian nama (§5.4)

-- ============================================================================
-- ROLE
-- ============================================================================
-- Aplikasi TIDAK BOLEH memakai pemilik tabel: pemilik melewati RLS diam-diam
-- dan itu menghapus seluruh manfaat lapisan ketiga (PLAN.md §6.2).

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kok_app') THEN
    CREATE ROLE kok_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kok_migrate') THEN
    CREATE ROLE kok_migrate NOLOGIN BYPASSRLS;
  END IF;
END $$;

-- ============================================================================
-- ENUM
-- ============================================================================

CREATE TYPE club_status      AS ENUM ('active', 'suspended', 'deleted');
CREATE TYPE user_status      AS ENUM ('unclaimed', 'active', 'disabled');
CREATE TYPE club_role        AS ENUM ('admin', 'bendahara', 'pencatat', 'verifikator', 'member');
CREATE TYPE game_format      AS ENUM ('single', 'ganda', 'rotasi');
CREATE TYPE game_side        AS ENUM ('a', 'b');
CREATE TYPE payment_status   AS ENUM ('pending', 'verified', 'rejected');
CREATE TYPE payment_method   AS ENUM ('qris_statis', 'qris_dinamis', 'transfer', 'tunai', 'deposit');
CREATE TYPE wallet_kind      AS ENUM ('topup', 'pemakaian', 'refund', 'penyesuaian');
CREATE TYPE tournament_format AS ENUM ('knockout', 'round_robin');
-- single  : satu game sampai 30 (format "biasa" v2)
-- bo3     : rally poin 21, best of 3
-- rally42 : satu game sampai 42, pindah tempat saat 21 — format tarkam (§8.3)
CREATE TYPE score_format     AS ENUM ('single', 'bo3', 'rally42');
CREATE TYPE bet_status       AS ENUM ('open', 'settled', 'cancelled');
CREATE TYPE notif_channel    AS ENUM ('push', 'wa', 'inapp');
CREATE TYPE notif_status     AS ENUM ('queued', 'sent', 'failed', 'skipped');
CREATE TYPE link_purpose     AS ENUM ('join', 'poster');
CREATE TYPE claim_status     AS ENUM ('pending', 'approved', 'rejected');

-- ============================================================================
-- PLATFORM & KLUB
-- ============================================================================

CREATE TABLE clubs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        citext NOT NULL UNIQUE,
  name        text NOT NULL,
  timezone    text NOT NULL DEFAULT 'Asia/Jakarta',
  status      club_status NOT NULL DEFAULT 'active',

  -- Saklar per klub (PLAN.md §7.4, §10.3). Dibaca lewat helper bertipe di Go,
  -- jangan disebar sebagai akses map mentah.
  --   siapa_boleh_catat      : 'semua_anggota' | 'hanya_pengurus'
  --   wajib_verifikasi       : bool
  --   halaman_publik         : bool
  --   transparansi_kas       : bool (default true)
  --   harga_default          : bigint (rupiah per orang)
  --   format_main_default    : game_format
  --   tunggakan_hari         : int (default 14)
  --   tunggakan_minimal      : bigint (default 50000)
  --   tunggakan_jeda_hari    : int (default 7)
  --   pengingat_wa           : bool
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Kuota (§12.1). Per klub supaya superadmin bisa menaikkan tanpa deploy.
  quotas      jsonb NOT NULL DEFAULT '{}'::jsonb,

  merchant_qris text,

  deleted_at  timestamptz,          -- soft-delete, tenggang 30 hari (§12.2)
  purge_after timestamptz,          -- diisi saat deleted_at diset
  created_by  uuid,                 -- FK ditambahkan setelah tabel users
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     bigint NOT NULL DEFAULT 1
);

CREATE INDEX clubs_active_idx ON clubs (status) WHERE deleted_at IS NULL;
CREATE INDEX clubs_purge_idx  ON clubs (purge_after) WHERE purge_after IS NOT NULL;

-- ============================================================================
-- IDENTITAS
-- ============================================================================

CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL untuk akun bayangan / pemain tamu (§7.3, §8.1) — mereka punya riwayat
  -- dan tagihan tapi belum pernah diklaim, jadi belum punya nomor.
  phone        text UNIQUE
                 CONSTRAINT users_phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  username     citext UNIQUE
                 CONSTRAINT users_username_fmt CHECK (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  photo_id     uuid,
  status       user_status NOT NULL DEFAULT 'unclaimed',

  username_changed_at timestamptz,   -- jeda ganti username (§7.1)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  version      bigint NOT NULL DEFAULT 1,

  -- Akun yang sudah diklaim wajib punya nomor; yang belum, wajib tidak punya.
  CONSTRAINT users_claimed_has_phone
    CHECK ((status = 'unclaimed' AND phone IS NULL) OR (status <> 'unclaimed' AND phone IS NOT NULL))
);

CREATE INDEX users_name_trgm_idx ON users USING gin (display_name gin_trgm_ops);

ALTER TABLE clubs
  ADD CONSTRAINT clubs_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id);

-- Nama lama v2 → user, per klub. Nama yang sama di klub berbeda bisa orang
-- berbeda, jadi keunikannya per klub (§7.1).
CREATE TABLE user_aliases (
  club_id  uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  alias    citext NOT NULL,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source   text NOT NULL DEFAULT 'v2',
  PRIMARY KEY (club_id, alias)
);
CREATE INDEX user_aliases_user_idx ON user_aliases (user_id);

CREATE TABLE memberships (
  club_id          uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role             club_role NOT NULL DEFAULT 'member',
  role_expires_at  timestamptz,          -- peran sementara (§7.4)
  is_tournament_guest boolean NOT NULL DEFAULT false,  -- penyaring tamu (§8.1)
  auto_deduct      boolean NOT NULL DEFAULT true,      -- potong otomatis (§9.1)
  joined_at        timestamptz NOT NULL DEFAULT now(),
  left_at          timestamptz,
  PRIMARY KEY (club_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id) WHERE left_at IS NULL;
CREATE INDEX memberships_role_expiry_idx ON memberships (role_expires_at)
  WHERE role_expires_at IS NOT NULL;

CREATE TABLE platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- SESI & KREDENSIAL
-- ============================================================================

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,      -- token mentah tak pernah disimpan
  device_label text,
  last_ip      inet,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx    ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry_idx  ON sessions (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE webauthn_credentials (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id  bytea NOT NULL UNIQUE,
  public_key     bytea NOT NULL,
  sign_count     bigint NOT NULL DEFAULT 0,
  aaguid         bytea,
  device_label   text,
  session_id     uuid REFERENCES sessions(id) ON DELETE SET NULL,  -- dicabut bersama perangkat (§7.2.2)
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz
);
CREATE INDEX webauthn_user_idx ON webauthn_credentials (user_id);

CREATE TABLE user_pins (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pin_hash    text NOT NULL,               -- argon2id
  failed      int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  code_hash   bytea NOT NULL,
  purpose     text NOT NULL,               -- 'claim' | 'device' | 'change_phone'
  attempts    int NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_phone_idx ON otp_codes (phone, created_at DESC);

-- ============================================================================
-- UNDANGAN, KLAIM, TAUTAN QR
-- ============================================================================

CREATE TABLE club_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  purpose     link_purpose NOT NULL DEFAULT 'join',
  token       text NOT NULL UNIQUE,        -- diputar/dicabut → poster lama mati
  label       text,
  active      boolean NOT NULL DEFAULT true,
  expires_at  timestamptz,
  scan_count  bigint NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX club_links_club_idx ON club_links (club_id) WHERE active;

CREATE TABLE invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  token       text NOT NULL UNIQUE,
  phone       text,                        -- diisi kalau undangan per-orang
  target_user uuid REFERENCES users(id),   -- akun bayangan yang mau diklaim
  created_by  uuid REFERENCES users(id),
  used_at     timestamptz,
  used_by     uuid REFERENCES users(id),
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invites_club_idx ON invites (club_id) WHERE used_at IS NULL;

CREATE TABLE claim_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user  uuid REFERENCES users(id),  -- NULL = mendaftar sebagai orang baru
  status       claim_status NOT NULL DEFAULT 'pending',
  decided_by   uuid REFERENCES users(id),
  decided_at   timestamptz,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX claim_requests_pending_idx ON claim_requests (club_id)
  WHERE status = 'pending';

-- ============================================================================
-- IDEMPOTENSI (§3 invarian 3)
-- ============================================================================

CREATE TABLE idempotency_keys (
  key         text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  club_id     uuid REFERENCES clubs(id) ON DELETE CASCADE,
  endpoint    text NOT NULL,
  request_hash bytea NOT NULL,             -- kunci sama + isi beda = 409, bukan hasil lama
  response    jsonb,
  status_code int,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX idempotency_expiry_idx ON idempotency_keys (expires_at);

-- ============================================================================
-- KATALOG KOK & PENGELUARAN
-- ============================================================================

CREATE TABLE kok_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id          uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name             text NOT NULL,
  price_per_person bigint NOT NULL CHECK (price_per_person >= 0),
  price_per_slop   bigint NOT NULL DEFAULT 0 CHECK (price_per_slop >= 0),
  stock            int NOT NULL DEFAULT 0 CHECK (stock >= 0),
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          bigint NOT NULL DEFAULT 1
);
CREATE INDEX kok_types_club_idx ON kok_types (club_id) WHERE active;

CREATE TABLE expenses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  -- Positif = kas keluar, negatif = kas masuk (penyesuaian saldo).
  amount      bigint NOT NULL,
  kok_type_id uuid REFERENCES kok_types(id) ON DELETE SET NULL,
  type_name   text,                       -- snapshot nama saat itu
  slops       int NOT NULL DEFAULT 0,
  note        text,
  recorded_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expenses_club_time_idx ON expenses (club_id, created_at DESC);

-- ============================================================================
-- PERMAINAN
-- ============================================================================

CREATE TABLE games (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  -- Tanggal di ZONA KLUB, bukan zona perangkat (PLAN.md §13).
  played_on   date NOT NULL,
  format      game_format NOT NULL DEFAULT 'ganda',
  notes       text,

  -- Skor OPSIONAL (§8.3). NULL = tidak dicatat, dan mencatat main tanpa skor
  -- harus tetap secepat v2 — ini alur yang paling sering dipakai.
  score_format score_format,
  winner_side  game_side,

  recorded_by uuid REFERENCES users(id),
  recorded_by_name text,                  -- fallback migrasi v2 (teks bebas)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  version     bigint NOT NULL DEFAULT 1,

  CONSTRAINT games_score_pair CHECK (
    (score_format IS NULL AND winner_side IS NULL) OR (score_format IS NOT NULL)
  )
);
-- Daftar main per bulan (§4.2 "dimuat per bulan").
CREATE INDEX games_club_date_idx ON games (club_id, played_on DESC)
  WHERE deleted_at IS NULL;

-- Baris per pemain — jumlahnya bebas (§8). Inilah yang membuat "tagihan si A"
-- jadi satu query berindeks, bukan pemindaian seluruh tabel seperti v2.
CREATE TABLE game_players (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  -- SIAPA MAIN.
  user_id     uuid NOT NULL REFERENCES users(id),
  -- SIAPA NANGGUNG (§8.2). Bawaannya sama dengan user_id. Berbeda kalau
  -- seseorang dibayarin pasangannya, ditraktir, atau kalah taruhan kok.
  payer_id    uuid NOT NULL REFERENCES users(id),
  side        game_side NOT NULL,
  slot        smallint NOT NULL,
  -- Sudah dibulatkan ke atas ke ratusan (§9.5 aturan A).
  amount      bigint NOT NULL CHECK (amount >= 0),
  paid_at     timestamptz,
  paid_by     uuid REFERENCES users(id),
  -- Sanggahan (§9.4) — HAK PEMAIN, bukan penanggung. Yang berhak bilang
  -- "saya tidak ikut main" adalah orang yang namanya dicatat.
  disputed_at timestamptz,
  dispute_note text,
  UNIQUE (game_id, side, slot),
  UNIQUE (game_id, user_id)
);

-- INDEKS PALING PENTING DI SELURUH SKEMA INI.
-- "Tagihanku di klub ini" = satu index scan.
--
-- PERHATIKAN: kolomnya payer_id, BUKAN user_id. Tagihan menempel ke yang
-- menanggung (§8.2). Salah kolom di sini dan seluruh angka tagihan salah —
-- orang yang ditraktir akan tetap ditagih, dan yang mentraktir tidak.
CREATE INDEX game_players_unpaid_idx
  ON game_players (club_id, payer_id)
  WHERE paid_at IS NULL AND disputed_at IS NULL;

CREATE INDEX game_players_game_idx  ON game_players (game_id);
CREATE INDEX game_players_user_idx  ON game_players (user_id);   -- riwayat main
CREATE INDEX game_players_payer_idx ON game_players (payer_id);  -- riwayat bayar

-- Skor per game, kalau dicatat (§8.3). Bentuknya sengaja sama persis dengan
-- match_games supaya turnamen dan main harian berbagi satu model skor.
-- single & rally42 selalu tepat satu baris; bo3 sampai tiga.
CREATE TABLE game_scores (
  game_id  uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  game_no  smallint NOT NULL CHECK (game_no BETWEEN 1 AND 3),
  score_a  smallint NOT NULL CHECK (score_a >= 0),
  score_b  smallint NOT NULL CHECK (score_b >= 0),
  PRIMARY KEY (game_id, game_no)
);

CREATE TABLE game_koks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id          uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  club_id          uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  kok_type_id      uuid REFERENCES kok_types(id) ON DELETE SET NULL,
  -- Snapshot: harga & nama dikunci di dalam game, tidak pernah diambil ulang
  -- dari katalog (semantik v2 yang wajib dipertahankan, PLAN.md §8).
  type_name        text,
  price_per_person bigint NOT NULL CHECK (price_per_person >= 0),
  qty              int NOT NULL DEFAULT 1 CHECK (qty > 0)
);
CREATE INDEX game_koks_game_idx ON game_koks (game_id);

-- ============================================================================
-- TURNAMEN
-- ============================================================================

CREATE TABLE tournaments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name         text NOT NULL,
  starts_on    date NOT NULL,
  ends_on      date,
  format       tournament_format NOT NULL DEFAULT 'knockout',
  size         int NOT NULL CHECK (size BETWEEN 2 AND 32),
  fee          bigint NOT NULL DEFAULT 0 CHECK (fee >= 0),
  score_format score_format NOT NULL DEFAULT 'single',
  notes        text,
  recorded_by  uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  version      bigint NOT NULL DEFAULT 1,
  CONSTRAINT tournaments_date_order CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX tournaments_club_date_idx ON tournaments (club_id, starts_on DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE tournament_pairs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  club_id       uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  slot          int NOT NULL,
  -- NULL = slot BYE. Peserta dari luar klub tetap punya user (unclaimed) §8.1.
  player_a      uuid REFERENCES users(id),
  player_b      uuid REFERENCES users(id),
  UNIQUE (tournament_id, slot)
);
CREATE INDEX tournament_pairs_tour_idx ON tournament_pairs (tournament_id);

CREATE TABLE matches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  club_id       uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  round         int NOT NULL,
  idx           int NOT NULL,
  pair_a        uuid REFERENCES tournament_pairs(id) ON DELETE SET NULL,
  pair_b        uuid REFERENCES tournament_pairs(id) ON DELETE SET NULL,
  winner_side   game_side,
  auto_win      boolean NOT NULL DEFAULT false,
  score_format  score_format,
  played_on     date,
  version       bigint NOT NULL DEFAULT 1,
  UNIQUE (tournament_id, round, idx)
);
CREATE INDEX matches_tour_idx ON matches (tournament_id);

CREATE TABLE match_games (
  match_id  uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  game_no   smallint NOT NULL,
  score_a   smallint NOT NULL CHECK (score_a >= 0),
  score_b   smallint NOT NULL CHECK (score_b >= 0),
  PRIMARY KEY (match_id, game_no)
);

CREATE TABLE match_koks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id          uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  tournament_id    uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  -- NULL = kok umum turnamen. Di v2 kok seperti ini tidak pernah ditagih ke
  -- siapa pun (lubang yang diakui di v2/lib/domain/types.ts). Di v3 wajib
  -- punya penanggung — lihat match_kok_charges.
  match_id         uuid REFERENCES matches(id) ON DELETE CASCADE,
  kok_type_id      uuid REFERENCES kok_types(id) ON DELETE SET NULL,
  type_name        text,
  price_per_person bigint NOT NULL CHECK (price_per_person >= 0),
  qty              int NOT NULL DEFAULT 1 CHECK (qty > 0),
  used_on          date
);
CREATE INDEX match_koks_tour_idx  ON match_koks (tournament_id);
CREATE INDEX match_koks_match_idx ON match_koks (match_id);

-- Tagihan kok turnamen per orang. Menutup lubang kok lepas: kok umum dibagi
-- rata ke seluruh peserta, kok partai ditagih ke pemain partai itu.
CREATE TABLE match_kok_charges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id       uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  match_id      uuid REFERENCES matches(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id),
  amount        bigint NOT NULL CHECK (amount >= 0),
  paid_at       timestamptz,
  paid_by       uuid REFERENCES users(id),
  disputed_at   timestamptz,
  charged_on    date NOT NULL
);
CREATE INDEX match_kok_charges_unpaid_idx
  ON match_kok_charges (club_id, user_id)
  WHERE paid_at IS NULL AND disputed_at IS NULL;

CREATE TABLE tournament_fees (
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  club_id       uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id),
  amount        bigint NOT NULL CHECK (amount >= 0),
  paid_at       timestamptz,
  paid_by       uuid REFERENCES users(id),
  PRIMARY KEY (tournament_id, user_id)
);
CREATE INDEX tournament_fees_unpaid_idx ON tournament_fees (club_id, user_id)
  WHERE paid_at IS NULL;

-- ============================================================================
-- UANG
-- ============================================================================

CREATE TABLE payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id),
  amount       bigint NOT NULL CHECK (amount > 0),
  status       payment_status NOT NULL DEFAULT 'verified',
  method       payment_method,
  claimed_at   timestamptz,
  claimed_by   uuid REFERENCES users(id),
  verified_at  timestamptz,
  verified_by  uuid REFERENCES users(id),
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  version      bigint NOT NULL DEFAULT 1
);
CREATE INDEX payments_club_time_idx ON payments (club_id, created_at DESC);
-- Antrean verifikator + pengingat klaim menganggur > 3 hari (§9.3).
CREATE INDEX payments_pending_idx ON payments (club_id, claimed_at)
  WHERE status = 'pending';

-- Baris tagihan yang ditutup satu pembayaran. Dipakai juga untuk mengunci
-- tagihan yang sedang diklaim dari potong otomatis (§9.5 aturan E).
CREATE TABLE payment_allocations (
  payment_id       uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  game_player_id   uuid REFERENCES game_players(id) ON DELETE CASCADE,
  match_charge_id  uuid REFERENCES match_kok_charges(id) ON DELETE CASCADE,
  tournament_id    uuid,
  fee_user_id      uuid,
  amount           bigint NOT NULL CHECK (amount > 0),
  CONSTRAINT payment_alloc_one_target CHECK (
    (game_player_id  IS NOT NULL)::int +
    (match_charge_id IS NOT NULL)::int +
    (tournament_id   IS NOT NULL)::int = 1
  ),
  FOREIGN KEY (tournament_id, fee_user_id)
    REFERENCES tournament_fees(tournament_id, user_id) ON DELETE CASCADE
);
CREATE INDEX payment_alloc_payment_idx ON payment_allocations (payment_id);
CREATE UNIQUE INDEX payment_alloc_gp_idx ON payment_allocations (game_player_id)
  WHERE game_player_id IS NOT NULL;
CREATE UNIQUE INDEX payment_alloc_mc_idx ON payment_allocations (match_charge_id)
  WHERE match_charge_id IS NOT NULL;

-- Ledger dompet, append-only. Saldo = SUM(amount) per (club_id, user_id).
-- Kolom saldo di tempat lain hanya cache; ini kebenarannya (§9.1).
CREATE TABLE wallet_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id),
  kind        wallet_kind NOT NULL,
  -- Positif menambah saldo, negatif mengurangi. Larangan minus ditegakkan di
  -- domain + trigger di bawah, bukan cuma di kode aplikasi.
  amount      bigint NOT NULL CHECK (amount <> 0),
  payment_id  uuid REFERENCES payments(id) ON DELETE SET NULL,
  note        text,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallet_entries_balance_idx ON wallet_entries (club_id, user_id);
CREATE INDEX wallet_entries_time_idx    ON wallet_entries (club_id, created_at DESC);

-- Saldo tidak boleh minus (§9.1). Ditegakkan di DB supaya jalur mana pun —
-- termasuk skrip perbaikan manual — tidak bisa melanggarnya.
CREATE OR REPLACE FUNCTION wallet_no_negative() RETURNS trigger AS $$
DECLARE bal bigint;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO bal
    FROM wallet_entries
   WHERE club_id = NEW.club_id AND user_id = NEW.user_id;
  IF bal < 0 THEN
    RAISE EXCEPTION 'saldo deposit tidak boleh minus (club=% user=% saldo=%)',
      NEW.club_id, NEW.user_id, bal;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER wallet_no_negative_trg
  AFTER INSERT ON wallet_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION wallet_no_negative();

-- ============================================================================
-- TARUHAN BARANG (§8.4)
-- ============================================================================
-- SENGAJA TIDAK PUNYA KOLOM RUPIAH.
--
-- Begitu taruhan dinilai rupiah dan masuk tagihan, uang kas klub tercampur
-- urusan pribadi antar pemain — persis pencampuran yang membuat pembukuan v2
-- membingungkan, dan di sini akibatnya lebih parah karena menyangkut orang lain.
--
-- Tabel ini tidak boleh muncul di laporan keuangan mana pun, tidak menyentuh
-- wallet_entries maupun payments, dan tidak pernah memicu pengingat WA.
-- Taruhan KOK bukan urusan tabel ini — itu cuma preset payer_id di game_players.

CREATE TABLE side_bets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  game_id     uuid REFERENCES games(id) ON DELETE SET NULL,
  -- Yang kalah berutang ke yang menang.
  debtor_id   uuid NOT NULL REFERENCES users(id),
  creditor_id uuid NOT NULL REFERENCES users(id),
  item        text NOT NULL CHECK (length(btrim(item)) > 0),  -- "2 Pocari"
  status      bet_status NOT NULL DEFAULT 'open',
  settled_at  timestamptz,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT side_bets_not_self CHECK (debtor_id <> creditor_id)
);
CREATE INDEX side_bets_open_idx ON side_bets (club_id, debtor_id)
  WHERE status = 'open';

-- ============================================================================
-- NOTIFIKASI & MEDIA
-- ============================================================================

CREATE TABLE push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  failed     int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_ok_at timestamptz
);
CREATE INDEX push_subs_user_idx ON push_subscriptions (user_id);

CREATE TABLE notification_prefs (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL = preferensi bawaan orang itu di semua klub; terisi = khusus satu klub.
  club_id     uuid REFERENCES clubs(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  push_on     boolean NOT NULL DEFAULT true,
  wa_on       boolean NOT NULL DEFAULT true,
  -- NULLS NOT DISTINCT (PG15+) supaya baris "bawaan" (club_id NULL) tetap unik.
  -- PRIMARY KEY tidak bisa dipakai di sini karena kolomnya boleh NULL.
  UNIQUE NULLS NOT DISTINCT (user_id, club_id, kind)
);

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  club_id     uuid REFERENCES clubs(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  channel     notif_channel NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      notif_status NOT NULL DEFAULT 'queued',
  attempts    int NOT NULL DEFAULT 0,
  send_after  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  read_at     timestamptz,               -- pusat notifikasi in-app (§10.1)
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Pekerja antrean: ambil yang siap kirim, urut waktu.
CREATE INDEX notifications_queue_idx ON notifications (channel, send_after)
  WHERE status = 'queued';
CREATE INDEX notifications_inbox_idx ON notifications (user_id, created_at DESC);
-- Kuota WA per klub per hari (§12.1).
CREATE INDEX notifications_wa_quota_idx ON notifications (club_id, sent_at)
  WHERE channel = 'wa' AND status = 'sent';

CREATE TABLE media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid REFERENCES clubs(id) ON DELETE CASCADE,
  path        text NOT NULL UNIQUE,       -- nama ter-hash di volume disk
  mime        text NOT NULL,
  bytes       bigint NOT NULL,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users
  ADD CONSTRAINT users_photo_fk FOREIGN KEY (photo_id) REFERENCES media(id) ON DELETE SET NULL;

-- ============================================================================
-- AUDIT
-- ============================================================================

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  club_id     uuid REFERENCES clubs(id) ON DELETE SET NULL,  -- tetap ada walau klub dihapus (§12.2)
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL,
  target_type text,
  target_id   uuid,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason      text,
  visible_to_members boolean NOT NULL DEFAULT false,   -- mis. pemindahan nomor (§7.2.1)
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_club_time_idx ON audit_log (club_id, created_at DESC);

-- ============================================================================
-- ROW-LEVEL SECURITY (PLAN.md §6.2)
-- ============================================================================
-- Aplikasi WAJIB membuka transaksi lalu menjalankan
--   SET LOCAL app.club_id = '<uuid>';
-- sebelum query apa pun. SET LOCAL hilang sendiri saat transaksi selesai, jadi
-- koneksi yang dipakai ulang tidak mewarisi klub milik permintaan sebelumnya.

CREATE OR REPLACE FUNCTION current_club() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.club_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'kok_types','expenses','games','game_players','game_koks',
    'tournaments','tournament_pairs','matches','match_koks','match_kok_charges',
    'tournament_fees','payments','wallet_entries','club_links','invites',
    'claim_requests','user_aliases','memberships','audit_log','media',
    'side_bets'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_tenant ON %I USING (club_id = current_club()) '
      'WITH CHECK (club_id = current_club())', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO kok_app', t);
  END LOOP;
END $$;

-- Tabel lintas klub: tidak ber-RLS, dilindungi di lapisan aplikasi.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, sessions, webauthn_credentials, user_pins, otp_codes,
  push_subscriptions, notification_prefs, notifications,
  idempotency_keys, clubs, platform_admins, match_games, game_scores,
  payment_allocations
  TO kok_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kok_app;

COMMIT;

-- ============================================================================
-- CATATAN UNTUK PENGEKSEKUSI
-- ============================================================================
--
-- 1. Pecah berkas ini jadi beberapa migrasi goose berurutan. Jangan
--    menjalankannya sebagai satu migrasi raksasa — perubahan berikutnya akan
--    sulit ditinjau.
--
-- 2. Jalankan migrasi sebagai kok_migrate (BYPASSRLS), jalankan aplikasi
--    sebagai kok_app. Kalau aplikasi memakai pemilik tabel, RLS tidak berlaku
--    dan lapisan pengaman ketiga hilang tanpa ada yang sadar.
--
-- 3. Indeks yang paling menentukan: game_players_unpaid_idx dan
--    match_kok_charges_unpaid_idx. Keduanya yang membuat "tagihanku" jadi satu
--    index scan. Jangan dihapus saat menyederhanakan skema.
--    game_players_unpaid_idx memakai payer_id, bukan user_id — lihat §8.2.
--
-- 3b. side_bets sengaja tanpa kolom rupiah, dan itu bukan kelalaian. Kalau ada
--    permintaan "sekalian dinilai rupiah biar gampang ditagih", baca §8.4 dulu
--    sebelum menambahkannya.
--
-- 4. Nilai bawaan settings/quotas ada di PLAN.md §17. Isi lewat kode saat klub
--    dibuat, bukan lewat DEFAULT SQL — supaya perubahannya terlihat di riwayat
--    kode dan bisa diuji.
--
-- 5. Belum ada di sini dan memang belum perlu: partisi tabel, materialized view
--    saldo, dan cache saldo. Target skala ~10 klub/~300 orang (PLAN.md §4.2)
--    tidak membutuhkannya. Tambahkan hanya setelah pengukuran menunjukkan perlu.
