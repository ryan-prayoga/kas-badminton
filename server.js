require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { convertQRIS, validateQRIS, parseTLV, calculateCRC16 } = require('@prasetya/qris');

function addQrisReferenceLabel(payload, referenceLabel) {
  const crcMatch = /6304[0-9A-Fa-f]{4}$/.test(payload);
  if (!crcMatch) return payload;
  if (parseTLV(payload).some((el) => el.tag === '62')) return payload;
  const body = payload.slice(0, -8);
  const labelLen = Buffer.byteLength(referenceLabel, 'utf8');
  const sub = '05' + String(labelLen).padStart(2, '0') + referenceLabel;
  const subLen = Buffer.byteLength(sub, 'utf8');
  const tag62 = '62' + String(subLen).padStart(2, '0') + sub;
  const crcInput = body + tag62 + '6304';
  return crcInput + calculateCRC16(crcInput);
}

const app = express();
const PORT = Number(process.env.PORT) || 8200;
const DATA_DIR = path.join(__dirname, 'data');
const LEGACY_DATA_FILE = path.join(DATA_DIR, 'db.json');
const ADMIN_PIN_FILE = path.join(DATA_DIR, 'admin-pin.txt');
const PIN_LENGTH = 6;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 jam
const SESSION_COOKIE = 'admin_session';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL belum di-set (env atau .env)');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (err) => console.error('[pg] idle client error', err.message));

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function uid() {
  return crypto.randomUUID();
}

function generatePin() {
  let pin = '';
  for (let i = 0; i < PIN_LENGTH; i++) pin += crypto.randomInt(0, 10);
  return pin;
}

function getAdminPin() {
  if (process.env.ADMIN_PIN) return String(process.env.ADMIN_PIN).trim();
  ensureDataDir();
  if (fs.existsSync(ADMIN_PIN_FILE)) {
    return fs.readFileSync(ADMIN_PIN_FILE, 'utf8').trim();
  }
  const generated = generatePin();
  fs.writeFileSync(ADMIN_PIN_FILE, generated);
  console.log(`[admin] PIN admin di-generate: ${generated}`);
  console.log(`[admin] Tersimpan di ${ADMIN_PIN_FILE} — ganti lewat env ADMIN_PIN atau edit file ini lalu restart.`);
  return generated;
}

const ADMIN_PIN = getAdminPin();

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return salt + ':' + hash;
}

function verifyPinHash(pin, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const attempt = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return timingSafeEqualStr(attempt, hash);
}

const sessions = new Map(); // token -> { role: 'admin'|'operator', expiresAt, operatorId?, name? }

function getSession(token) {
  if (!token) return null;
  const sess = sessions.get(token);
  if (!sess || sess.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return sess;
}

function revokeOperatorSessions(operatorId) {
  for (const [token, sess] of sessions) {
    if (sess.operatorId === operatorId) sessions.delete(token);
  }
}

function requireAdmin(req, res, next) {
  const sess = getSession(req.cookies?.[SESSION_COOKIE]);
  if (sess && sess.role === 'admin') { req.session = sess; return next(); }
  res.status(401).json({ error: 'Perlu login admin' });
}

function requireStaff(req, res, next) {
  const sess = getSession(req.cookies?.[SESSION_COOKIE]);
  if (sess) { req.session = sess; return next(); }
  res.status(401).json({ error: 'Perlu login' });
}

const loginAttempts = new Map(); // ip -> { count, resetAt }
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function loginRateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return next();
  }
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Terlalu banyak percobaan, coba lagi nanti' });
  }
  entry.count += 1;
  next();
}

function todayWIB() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

/** Normalisasi bentuk pemain (skor sudah tidak dipakai) */
function normalizeStoredGame(game) {
  if (!game || typeof game !== 'object') return game;

  let players = Array.isArray(game.players) ? game.players.slice(0, 4) : [];
  while (players.length < 4) players.push({ name: '', paid: false });
  players = players.map((p) => ({
    name: normalizeName(typeof p === 'string' ? p : p?.name),
    paid: Boolean(typeof p === 'object' && p ? p.paid : false),
  }));

  const rest = { ...game };
  delete rest.scores;
  delete rest.score;
  return { ...rest, players };
}

function gameCost(game) {
  const koks = Array.isArray(game.koks) ? game.koks : [];
  const perPerson = koks.reduce((s, k) => s + Number(k.pricePerPerson || 0), 0);
  return {
    perPerson,
    total: perPerson * 4,
    kokCount: koks.length,
  };
}

function enrichGame(game) {
  const g = normalizeStoredGame(game);
  const cost = gameCost(g);
  const players = (g.players || []).map((p) => ({
    ...p,
    amount: cost.perPerson,
  }));
  const paidCount = players.filter((p) => p.paid).length;
  const paidTotal = players.filter((p) => p.paid).reduce((s) => s + cost.perPerson, 0);
  const pairs = {
    a: { players: [players[0], players[1]] },
    b: { players: [players[2], players[3]] },
  };
  return {
    ...g,
    players,
    pairs,
    cost,
    summary: {
      paidCount,
      unpaidCount: players.length - paidCount,
      paidTotal,
      unpaidTotal: cost.total - paidTotal,
      allPaid: paidCount === 4,
    },
  };
}

function rememberPlayers(db, names) {
  const set = new Set(db.players.map((p) => p.name.toLowerCase()));
  for (const n of names) {
    const name = normalizeName(n);
    if (!name) continue;
    if (!set.has(name.toLowerCase())) {
      db.players.push({ name, photo: null });
      set.add(name.toLowerCase());
    }
  }
  db.players.sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

function parsePlayersFromBody(body, existing) {
  // Preferred: pairs { a: [p1,p2], b: [p3,p4] } with optional paid flags in objects
  if (body.pairs && typeof body.pairs === 'object') {
    const a = Array.isArray(body.pairs.a) ? body.pairs.a : [];
    const b = Array.isArray(body.pairs.b) ? body.pairs.b : [];
    const raw = [...a, ...b];
    if (raw.length !== 4) return { error: 'Harus 2 pasangan (4 pemain)' };
    const players = raw.map((p, i) => {
      if (typeof p === 'string') {
        return {
          name: normalizeName(p),
          paid: Boolean(existing?.[i]?.paid),
        };
      }
      return {
        name: normalizeName(p?.name),
        paid: p?.paid !== undefined ? Boolean(p.paid) : Boolean(existing?.[i]?.paid),
      };
    });
    return { players };
  }

  if (Array.isArray(body.players) && body.players.length === 4) {
    const players = body.players.map((p, i) => {
      if (typeof p === 'string') {
        return { name: normalizeName(p), paid: Boolean(existing?.[i]?.paid) };
      }
      return {
        name: normalizeName(p?.name),
        paid: p?.paid !== undefined ? Boolean(p.paid) : Boolean(existing?.[i]?.paid),
      };
    });
    return { players };
  }

  return { error: 'Harus isi 4 nama pemain (2 pasangan)' };
}

function validatePlayers(players) {
  if (!players || players.length !== 4 || players.some((p) => !p.name)) {
    return 'Harus isi 4 nama pemain';
  }
  if (new Set(players.map((p) => p.name.toLowerCase())).size !== 4) {
    return 'Nama pemain tidak boleh dobel';
  }
  return null;
}

function normalizeNameType(name) {
  return normalizeName(name).slice(0, 60);
}

function findKokType(db, typeId) {
  if (!typeId) return null;
  return (db.kokTypes || []).find((t) => t.id === typeId) || null;
}

function normalizeKokEntry(raw, defaultPrice, db) {
  const type = findKokType(db, raw?.typeId);
  let price = Number(raw?.pricePerPerson);
  if (!Number.isFinite(price)) {
    price = type ? type.pricePerPerson : defaultPrice;
  }
  let typeName = raw?.typeName != null ? String(raw.typeName).trim().slice(0, 60) : '';
  if (!typeName && type) typeName = type.name;
  return {
    id: raw?.id || uid(),
    typeId: type ? type.id : raw?.typeId || null,
    typeName: typeName || null,
    pricePerPerson: Math.round(price),
  };
}

function buildKoks(body, defaultPrice, db) {
  let koks = Array.isArray(body.koks) ? body.koks : null;
  if (!koks || koks.length === 0) {
    const count = Math.max(1, Math.min(50, Number(body.kokCount) || 1));
    const type = findKokType(db, body.typeId);
    return Array.from({ length: count }, () =>
      normalizeKokEntry(
        {
          typeId: type?.id || null,
          typeName: type?.name || null,
          pricePerPerson: Number.isFinite(Number(body.pricePerPerson))
            ? Math.round(Number(body.pricePerPerson))
            : type
              ? type.pricePerPerson
              : defaultPrice,
        },
        defaultPrice,
        db
      )
    );
  }
  koks = koks.slice(0, 50).map((k) => normalizeKokEntry(k, defaultPrice, db));
  if (koks.length === 0) {
    koks = [normalizeKokEntry({}, defaultPrice, db)];
  }
  return koks;
}

// --- Persistence (Postgres) ---
// Small dataset (personal use, handful of games/week) — whole-table
// read/replace per request keeps every route handler's business logic
// identical to the old flat-file version instead of rewriting each into
// targeted SQL.

function rowToGame(r) {
  return normalizeStoredGame({
    id: r.id,
    date: r.date,
    players: r.players,
    koks: r.koks,
    notes: r.notes,
    recordedBy: r.recorded_by || null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  });
}

function rowToKokType(r) {
  return {
    id: r.id,
    name: r.name,
    pricePerPerson: Number(r.price_per_person) || 0,
    pricePerSlop: Math.max(0, Math.round(Number(r.price_per_slop) || 0)),
    stock: Number.isFinite(Number(r.stock)) ? Math.max(0, Math.round(Number(r.stock))) : 0,
    active: r.active !== false,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  };
}

function parseStock(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

function countKoksByType(koks) {
  const map = new Map();
  for (const k of koks || []) {
    const id = k?.typeId;
    if (!id) continue;
    map.set(id, (map.get(id) || 0) + 1);
  }
  return map;
}

function applyStockDelta(db, typeId, delta) {
  if (!typeId || !delta) return;
  const type = (db.kokTypes || []).find((t) => t.id === typeId);
  if (!type) return;
  type.stock = Math.max(0, (Number(type.stock) || 0) + delta);
  type.updatedAt = new Date().toISOString();
}

function applyKoksStockDiff(db, oldKoks, newKoks) {
  const oldMap = countKoksByType(oldKoks);
  const newMap = countKoksByType(newKoks);
  const ids = new Set([...oldMap.keys(), ...newMap.keys()]);
  for (const id of ids) {
    const delta = (oldMap.get(id) || 0) - (newMap.get(id) || 0);
    applyStockDelta(db, id, delta);
  }
}

/** Cek stok cukup buat selisih oldKoks→newKoks. Balik pesan error atau null. */
function stockDiffError(db, oldKoks, newKoks) {
  const oldMap = countKoksByType(oldKoks);
  const newMap = countKoksByType(newKoks);
  for (const id of newMap.keys()) {
    const need = (newMap.get(id) || 0) - (oldMap.get(id) || 0);
    if (need <= 0) continue;
    const type = (db.kokTypes || []).find((t) => t.id === id);
    if (!type) continue;
    const avail = Math.max(0, Number(type.stock) || 0);
    if (need > avail) {
      return `Stok ${type.name} tidak cukup (butuh ${need}, sisa ${avail})`;
    }
  }
  return null;
}

async function recordPayment(name, amount) {
  const amt = Math.round(Number(amount) || 0);
  if (amt <= 0) return;
  await pool.query('INSERT INTO payments (id, name, amount) VALUES ($1, $2, $3)', [uid(), name, amt]);
}

/** Ringkasan hutang per orang: sisa = max(0, owedGross − carry). */
function buildDebtSummary(games, carryMap) {
  const byName = {};
  for (const g of games) {
    for (const p of g.players) {
      if (p.paid || !p.name) continue;
      if (!byName[p.name]) byName[p.name] = { name: p.name, owedGross: 0, items: [] };
      byName[p.name].owedGross += g.cost.perPerson;
      byName[p.name].items.push({
        gameId: g.id,
        date: g.date,
        name: p.name,
        amount: g.cost.perPerson,
        kokCount: g.cost.kokCount,
      });
    }
  }
  return Object.values(byName)
    .map((e) => {
      const carry = Math.max(0, Number(carryMap?.[e.name]) || 0);
      return { ...e, carry, total: Math.max(0, e.owedGross - carry) };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'id'));
}

/** Payload lengkap (dipakai bootstrap + endpoint mutasi). */
function summarize(db, isAdmin) {
  const games = db.games
    .slice()
    .sort(
      (a, b) =>
        String(b.date).localeCompare(String(a.date)) ||
        String(b.createdAt).localeCompare(String(a.createdAt))
    )
    .map(enrichGame);
  const settings = {
    defaultPricePerPerson: db.settings.defaultPricePerPerson,
    qrisEnabled: Boolean(db.settings.merchantQris),
  };
  if (isAdmin) settings.merchantQris = db.settings.merchantQris || '';
  const payload = {
    settings,
    players: db.players,
    kokTypes: db.kokTypes || [],
    games,
    debtSummary: buildDebtSummary(games, db.carry || {}),
  };
  if (isAdmin) {
    const paid = games.reduce((s, g) => s + (g.summary ? g.summary.paidTotal : 0), 0);
    const expense = Math.max(0, Number(db.totalExpense) || 0);
    payload.kas = { paid, expense, net: paid - expense };
  }
  return payload;
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kok_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price_per_person INT NOT NULL DEFAULT 3000,
      stock INT NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE kok_types
    ADD COLUMN IF NOT EXISTS stock INT NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE kok_types
    ADD COLUMN IF NOT EXISTS price_per_slop INT NOT NULL DEFAULT 0
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS kok_types_name_lower_uidx
    ON kok_types (lower(name))
  `);
  // Pengeluaran beli stok kok (kas keluar)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      type_id TEXT,
      type_name TEXT,
      slops INT NOT NULL DEFAULT 0,
      amount INT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Kolom QRIS statis merchant (settings dibuat manual; ALTER additive aman)
  await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS merchant_qris TEXT`);
  // Ledger cicilan (tabel yang kita kontrol penuh)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      amount INT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_carry (
      name TEXT PRIMARY KEY,
      carry INT NOT NULL DEFAULT 0
    )
  `);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS photo TEXT`);
  await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS recorded_by TEXT`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS operators (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ
    )
  `);
}

async function loadDb() {
  const [settingsRes, playersRes, gamesRes, typesRes, carryRes, expenseRes] = await Promise.all([
    pool.query('SELECT default_price_per_person, merchant_qris FROM settings WHERE id = 1'),
    pool.query('SELECT name, photo FROM players ORDER BY name'),
    pool.query('SELECT id, date, players, koks, notes, recorded_by, created_at, updated_at FROM games'),
    pool.query(
      'SELECT id, name, price_per_person, price_per_slop, stock, active, created_at, updated_at FROM kok_types ORDER BY lower(name)'
    ),
    pool.query('SELECT name, carry FROM player_carry'),
    pool.query('SELECT COALESCE(SUM(amount), 0)::int AS total FROM expenses'),
  ]);
  const carry = {};
  for (const r of carryRes.rows) {
    const c = Math.max(0, Math.round(Number(r.carry) || 0));
    if (c > 0) carry[r.name] = c;
  }
  return {
    settings: {
      defaultPricePerPerson: Number(settingsRes.rows[0]?.default_price_per_person) || 3000,
      merchantQris: settingsRes.rows[0]?.merchant_qris || '',
    },
    players: playersRes.rows.map((r) => ({ name: r.name, photo: r.photo || null })),
    games: gamesRes.rows.map(rowToGame),
    kokTypes: typesRes.rows.map(rowToKokType),
    carry,
    totalExpense: Number(expenseRes.rows[0]?.total) || 0,
  };
}

async function saveDb(db) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE settings SET default_price_per_person = $1, merchant_qris = $2 WHERE id = 1',
      [db.settings.defaultPricePerPerson, db.settings.merchantQris || null]
    );
    await client.query('DELETE FROM player_carry');
    for (const [name, carry] of Object.entries(db.carry || {})) {
      const c = Math.max(0, Math.round(Number(carry) || 0));
      if (c > 0) {
        await client.query('INSERT INTO player_carry (name, carry) VALUES ($1, $2)', [name, c]);
      }
    }
    await client.query('DELETE FROM players');
    for (const p of db.players) {
      await client.query('INSERT INTO players (name, photo) VALUES ($1, $2)', [p.name, p.photo || null]);
    }
    await client.query('DELETE FROM kok_types');
    for (const t of db.kokTypes || []) {
      await client.query(
        `INSERT INTO kok_types (id, name, price_per_person, price_per_slop, stock, active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          t.id,
          t.name,
          t.pricePerPerson,
          Math.max(0, Math.round(Number(t.pricePerSlop) || 0)),
          parseStock(t.stock, 0),
          t.active !== false,
          t.createdAt || new Date().toISOString(),
          t.updatedAt || new Date().toISOString(),
        ]
      );
    }
    await client.query('DELETE FROM games');
    for (const g of db.games) {
      await client.query(
        `INSERT INTO games (id, date, players, scores, koks, notes, recorded_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          g.id,
          g.date,
          JSON.stringify(g.players),
          '{}',
          JSON.stringify(g.koks),
          g.notes,
          g.recordedBy || null,
          g.createdAt,
          g.updatedAt,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function migrateLegacyJsonIfNeeded() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM games');
  if (rows[0].n > 0) return;
  if (!fs.existsSync(LEGACY_DATA_FILE)) return;

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(LEGACY_DATA_FILE, 'utf8'));
  } catch {
    return;
  }
  const players = Array.isArray(raw?.players) ? raw.players : [];
  const games = Array.isArray(raw?.games) ? raw.games.map(normalizeStoredGame) : [];
  const defaultPrice = Number(raw?.settings?.defaultPricePerPerson) || 3000;
  if (!games.length && !players.length) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE settings SET default_price_per_person = $1 WHERE id = 1', [defaultPrice]);
    for (const name of players) {
      await client.query('INSERT INTO players (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
    }
    for (const g of games) {
      await client.query(
        `INSERT INTO games (id, date, players, scores, koks, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [
          g.id,
          g.date,
          JSON.stringify(g.players),
          '{}',
          JSON.stringify(g.koks),
          g.notes,
          g.createdAt || new Date().toISOString(),
          g.updatedAt || new Date().toISOString(),
        ]
      );
    }
    await client.query('COMMIT');
    console.log(`[migrate] Import ${games.length} game dari data/db.json ke Postgres selesai.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] Gagal import data lama:', err.message);
  } finally {
    client.release();
  }
}

app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'kok-badminton' });
});

app.get('/api/me', (req, res) => {
  const sess = getSession(req.cookies?.[SESSION_COOKIE]);
  if (!sess) return res.json({ role: null });
  res.json({
    role: sess.role,
    name: sess.role === 'operator' ? sess.name : undefined,
    expiresAt: sess.role === 'operator' ? new Date(sess.expiresAt).toISOString() : undefined,
  });
});

app.post('/api/login', loginRateLimit, async (req, res, next) => {
  try {
    const pin = String(req.body?.pin ?? '');
    if (timingSafeEqualStr(pin, ADMIN_PIN)) {
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { role: 'admin', expiresAt: Date.now() + SESSION_TTL_MS });
      res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.secure,
        maxAge: SESSION_TTL_MS,
      });
      return res.json({ ok: true });
    }

    const { rows } = await pool.query(
      'SELECT id, name, pin_hash, expires_at FROM operators WHERE revoked_at IS NULL AND expires_at > NOW()'
    );
    const match = rows.find((r) => verifyPinHash(pin, r.pin_hash));
    if (!match) return res.status(401).json({ error: 'PIN salah' });

    const token = crypto.randomBytes(32).toString('hex');
    const sessionExpiresAt = Math.min(Date.now() + SESSION_TTL_MS, new Date(match.expires_at).getTime());
    sessions.set(token, { role: 'operator', operatorId: match.id, name: match.name, expiresAt: sessionExpiresAt });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      maxAge: Math.max(0, sessionExpiresAt - Date.now()),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/logout', (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) sessions.delete(token);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.get('/api/bootstrap', async (req, res, next) => {
  try {
    const db = await loadDb();
    const sess = getSession(req.cookies?.[SESSION_COOKIE]);
    res.json(summarize(db, sess?.role === 'admin'));
  } catch (err) {
    next(err);
  }
});

app.put('/api/settings', requireAdmin, async (req, res, next) => {
  try {
    const db = await loadDb();

    if (req.body?.defaultPricePerPerson !== undefined) {
      const price = Number(req.body.defaultPricePerPerson);
      if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({ error: 'defaultPricePerPerson harus angka >= 0' });
      }
      db.settings.defaultPricePerPerson = Math.round(price);
    }

    if (req.body?.merchantQris !== undefined) {
      const raw = String(req.body.merchantQris || '').trim();
      if (raw) {
        const check = validateQRIS(raw);
        if (!check.valid) {
          return res.status(400).json({ error: 'QRIS statis tidak valid: ' + (check.errors[0] || 'format salah') });
        }
      }
      db.settings.merchantQris = raw;
    }

    await saveDb(db);
    res.json({ settings: { defaultPricePerPerson: db.settings.defaultPricePerPerson, qrisEnabled: Boolean(db.settings.merchantQris), merchantQris: db.settings.merchantQris || '' } });
  } catch (err) {
    next(err);
  }
});

app.post('/api/games', requireStaff, async (req, res, next) => {
  try {
    const body = req.body || {};
    const parsed = parsePlayersFromBody(body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const err = validatePlayers(parsed.players);
    if (err) return res.status(400).json({ error: err });

    const db = await loadDb();
    const koks = buildKoks(body, db.settings.defaultPricePerPerson, db);

    const stockErr = stockDiffError(db, [], koks);
    if (stockErr) return res.status(400).json({ error: stockErr });

    const game = {
      id: uid(),
      date: body.date || todayWIB(),
      players: parsed.players,
      koks,
      notes: body.notes ? String(body.notes).trim() : '',
      recordedBy: req.session.role === 'admin' ? 'Admin' : req.session.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    rememberPlayers(db, parsed.players.map((p) => p.name));
    applyKoksStockDiff(db, [], koks);
    db.games.unshift(game);
    await saveDb(db);
    res.status(201).json(summarize(db, req.session.role === 'admin'));
  } catch (err) {
    next(err);
  }
});

app.patch('/api/games/:id', requireStaff, async (req, res, next) => {
  try {
    const db = await loadDb();
    const idx = db.games.findIndex((g) => g.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Game tidak ditemukan' });

    const body = req.body || {};
    const game = normalizeStoredGame(db.games[idx]);
    const oldKoks = (game.koks || []).slice();

    if (body.date) game.date = String(body.date);
    if (body.notes !== undefined) game.notes = String(body.notes || '').trim();

    if (body.pairs || (Array.isArray(body.players) && body.players.length === 4)) {
      const parsed = parsePlayersFromBody(body, game.players);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const err = validatePlayers(parsed.players);
      if (err) return res.status(400).json({ error: err });
      game.players = parsed.players;
      rememberPlayers(db, parsed.players.map((p) => p.name));
    }

    if (Array.isArray(body.koks) && body.koks.length > 0) {
      const nextKoks = body.koks
        .slice(0, 50)
        .map((k) => normalizeKokEntry(k, db.settings.defaultPricePerPerson, db));
      const stockErr = stockDiffError(db, oldKoks, nextKoks);
      if (stockErr) return res.status(400).json({ error: stockErr });
      game.koks = nextKoks;
      applyKoksStockDiff(db, oldKoks, game.koks);
    }

    game.updatedAt = new Date().toISOString();
    db.games[idx] = game;
    await saveDb(db);
    res.json(summarize(db, req.session.role === 'admin'));
  } catch (err) {
    next(err);
  }
});

app.post('/api/games/:id/koks', requireStaff, async (req, res, next) => {
  try {
    const db = await loadDb();
    const idx = db.games.findIndex((g) => g.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Game tidak ditemukan' });

    const kok = normalizeKokEntry(req.body || {}, db.settings.defaultPricePerPerson, db);
    const stockErr = stockDiffError(db, [], [kok]);
    if (stockErr) return res.status(400).json({ error: stockErr });
    db.games[idx] = normalizeStoredGame(db.games[idx]);
    db.games[idx].koks.push(kok);
    applyStockDelta(db, kok.typeId, -1);
    db.games[idx].updatedAt = new Date().toISOString();
    await saveDb(db);
    res.status(201).json(summarize(db, req.session.role === 'admin'));
  } catch (err) {
    next(err);
  }
});

app.delete('/api/games/:id/koks/:kokId', requireStaff, async (req, res, next) => {
  try {
    const db = await loadDb();
    const idx = db.games.findIndex((g) => g.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Game tidak ditemukan' });

    const game = normalizeStoredGame(db.games[idx]);
    if (game.koks.length <= 1) {
      return res.status(400).json({ error: 'Minimal 1 kok per game' });
    }
    const removed = game.koks.find((k) => k.id === req.params.kokId);
    const before = game.koks.length;
    game.koks = game.koks.filter((k) => k.id !== req.params.kokId);
    if (game.koks.length === before) return res.status(404).json({ error: 'Kok tidak ditemukan' });
    if (removed?.typeId) applyStockDelta(db, removed.typeId, 1);
    game.updatedAt = new Date().toISOString();
    db.games[idx] = game;
    await saveDb(db);
    res.json(summarize(db, req.session.role === 'admin'));
  } catch (err) {
    next(err);
  }
});

app.patch('/api/games/:id/koks/:kokId', requireStaff, async (req, res, next) => {
  try {
    const db = await loadDb();
    const idx = db.games.findIndex((g) => g.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Game tidak ditemukan' });

    const game = normalizeStoredGame(db.games[idx]);
    const kok = game.koks.find((k) => k.id === req.params.kokId);
    if (!kok) return res.status(404).json({ error: 'Kok tidak ditemukan' });

    const body = req.body || {};
    const prevTypeId = kok.typeId || null;
    if (body.typeId !== undefined || body.typeName !== undefined || body.pricePerPerson !== undefined) {
      const merged = normalizeKokEntry(
        {
          id: kok.id,
          typeId: body.typeId !== undefined ? body.typeId : kok.typeId,
          typeName: body.typeName !== undefined ? body.typeName : kok.typeName,
          pricePerPerson:
            body.pricePerPerson !== undefined ? body.pricePerPerson : kok.pricePerPerson,
        },
        db.settings.defaultPricePerPerson,
        db
      );
      Object.assign(kok, merged);
    } else {
      return res.status(400).json({ error: 'Tidak ada field yang diubah' });
    }
    if (!Number.isFinite(Number(kok.pricePerPerson)) || kok.pricePerPerson < 0) {
      return res.status(400).json({ error: 'pricePerPerson harus angka >= 0' });
    }
    if (prevTypeId !== (kok.typeId || null)) {
      const stockErr = stockDiffError(db, [{ typeId: prevTypeId }], [{ typeId: kok.typeId }]);
      if (stockErr) return res.status(400).json({ error: stockErr });
      applyStockDelta(db, prevTypeId, 1);
      applyStockDelta(db, kok.typeId, -1);
    }
    game.updatedAt = new Date().toISOString();
    db.games[idx] = game;
    await saveDb(db);
    res.json(summarize(db, req.session.role === 'admin'));
  } catch (err) {
    next(err);
  }
});

app.get('/api/kok-types', requireAdmin, async (_req, res, next) => {
  try {
    const db = await loadDb();
    res.json({ kokTypes: db.kokTypes || [] });
  } catch (err) {
    next(err);
  }
});

app.post('/api/kok-types', requireAdmin, async (req, res, next) => {
  try {
    const name = normalizeNameType(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Nama jenis kok wajib diisi' });
    const price = Number(req.body?.pricePerPerson);
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: 'pricePerPerson harus angka >= 0' });
    }
    if (req.body?.stock !== undefined && (!Number.isFinite(Number(req.body.stock)) || Number(req.body.stock) < 0)) {
      return res.status(400).json({ error: 'stock harus angka >= 0' });
    }

    const db = await loadDb();
    const dup = (db.kokTypes || []).some((t) => t.name.toLowerCase() === name.toLowerCase());
    if (dup) return res.status(409).json({ error: 'Jenis kok dengan nama itu sudah ada' });

    const now = new Date().toISOString();
    const type = {
      id: uid(),
      name,
      pricePerPerson: Math.round(price),
      pricePerSlop: Math.max(0, Math.round(Number(req.body?.pricePerSlop) || 0)),
      stock: parseStock(req.body?.stock, 0),
      active: req.body?.active === false ? false : true,
      createdAt: now,
      updatedAt: now,
    };
    db.kokTypes = db.kokTypes || [];
    db.kokTypes.push(type);
    db.kokTypes.sort((a, b) => a.name.localeCompare(b.name, 'id'));
    await saveDb(db);
    res.status(201).json({ kokType: type, kokTypes: db.kokTypes });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/kok-types/:id', requireAdmin, async (req, res, next) => {
  try {
    const db = await loadDb();
    const type = (db.kokTypes || []).find((t) => t.id === req.params.id);
    if (!type) return res.status(404).json({ error: 'Jenis kok tidak ditemukan' });

    if (req.body?.name !== undefined) {
      const name = normalizeNameType(req.body.name);
      if (!name) return res.status(400).json({ error: 'Nama jenis kok wajib diisi' });
      const dup = db.kokTypes.some(
        (t) => t.id !== type.id && t.name.toLowerCase() === name.toLowerCase()
      );
      if (dup) return res.status(409).json({ error: 'Jenis kok dengan nama itu sudah ada' });
      type.name = name;
    }
    if (req.body?.pricePerPerson !== undefined) {
      const price = Number(req.body.pricePerPerson);
      if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({ error: 'pricePerPerson harus angka >= 0' });
      }
      type.pricePerPerson = Math.round(price);
    }
    if (req.body?.pricePerSlop !== undefined) {
      const ps = Number(req.body.pricePerSlop);
      if (!Number.isFinite(ps) || ps < 0) {
        return res.status(400).json({ error: 'pricePerSlop harus angka >= 0' });
      }
      type.pricePerSlop = Math.round(ps);
    }
    if (req.body?.stock !== undefined) {
      const stock = Number(req.body.stock);
      if (!Number.isFinite(stock) || stock < 0) {
        return res.status(400).json({ error: 'stock harus angka >= 0' });
      }
      type.stock = Math.round(stock);
    }
    if (req.body?.active !== undefined) {
      type.active = Boolean(req.body.active);
    }
    type.updatedAt = new Date().toISOString();
    db.kokTypes.sort((a, b) => a.name.localeCompare(b.name, 'id'));
    await saveDb(db);
    res.json({ kokType: type, kokTypes: db.kokTypes });
  } catch (err) {
    next(err);
  }
});

app.post('/api/kok-types/:id/stock', requireAdmin, async (req, res, next) => {
  try {
    const db = await loadDb();
    const type = (db.kokTypes || []).find((t) => t.id === req.params.id);
    if (!type) return res.status(404).json({ error: 'Jenis kok tidak ditemukan' });

    const delta = Number(req.body?.delta);
    if (!Number.isFinite(delta) || !Number.isInteger(delta) || delta === 0) {
      return res.status(400).json({ error: 'delta harus integer non-zero (mis. +12 atau -1)' });
    }
    const nextStock = (Number(type.stock) || 0) + delta;
    if (nextStock < 0) {
      return res.status(400).json({ error: 'Stok tidak cukup' });
    }
    type.stock = nextStock;
    type.updatedAt = new Date().toISOString();
    await saveDb(db);
    res.json({ kokType: type, kokTypes: db.kokTypes });
  } catch (err) {
    next(err);
  }
});

// Beli stok per slop (1 slop = 12 kok) → tambah stok + catat pengeluaran (kas keluar)
app.post('/api/kok-types/:id/buy', requireAdmin, async (req, res, next) => {
  try {
    const db = await loadDb();
    const type = (db.kokTypes || []).find((t) => t.id === req.params.id);
    if (!type) return res.status(404).json({ error: 'Jenis kok tidak ditemukan' });

    const slops = Number(req.body?.slops);
    if (!Number.isFinite(slops) || !Number.isInteger(slops) || slops <= 0) {
      return res.status(400).json({ error: 'Jumlah slop harus angka bulat > 0' });
    }
    // Harga slop per-pembelian (bisa beda tiap beli walau merek sama).
    // Fallback ke harga tersimpan kalau tidak dikirim.
    var pricePerSlop = req.body?.pricePerSlop !== undefined
      ? Number(req.body.pricePerSlop)
      : Number(type.pricePerSlop) || 0;
    if (!Number.isFinite(pricePerSlop) || pricePerSlop < 0) {
      return res.status(400).json({ error: 'Harga per slop harus angka >= 0' });
    }
    pricePerSlop = Math.round(pricePerSlop);
    const amount = slops * pricePerSlop;

    type.stock = (Number(type.stock) || 0) + slops * 12;
    // ingat harga terakhir sebagai default pembelian berikutnya
    type.pricePerSlop = pricePerSlop;
    type.updatedAt = new Date().toISOString();
    await saveDb(db);
    await pool.query(
      'INSERT INTO expenses (id, type_id, type_name, slops, amount) VALUES ($1,$2,$3,$4,$5)',
      [uid(), type.id, type.name, slops, amount]
    );
    db.totalExpense = (Number(db.totalExpense) || 0) + amount;
    res.json(summarize(db, true));
  } catch (err) {
    next(err);
  }
});

app.delete('/api/kok-types/:id', requireAdmin, async (req, res, next) => {
  try {
    const db = await loadDb();
    const before = (db.kokTypes || []).length;
    db.kokTypes = (db.kokTypes || []).filter((t) => t.id !== req.params.id);
    if (db.kokTypes.length === before) {
      return res.status(404).json({ error: 'Jenis kok tidak ditemukan' });
    }
    await saveDb(db);
    res.json({ ok: true, kokTypes: db.kokTypes });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/games/:id', requireStaff, async (req, res, next) => {
  try {
    const db = await loadDb();
    const idx = db.games.findIndex((g) => g.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Game tidak ditemukan' });
    const game = normalizeStoredGame(db.games[idx]);
    applyKoksStockDiff(db, game.koks, []);
    db.games.splice(idx, 1);
    await saveDb(db);
    res.json(summarize(db, req.session.role === 'admin'));
  } catch (err) {
    next(err);
  }
});

app.patch('/api/games/:id/players/:index/paid', requireStaff, async (req, res, next) => {
  try {
    const db = await loadDb();
    const idx = db.games.findIndex((g) => g.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Game tidak ditemukan' });

    const pIdx = Number(req.params.index);
    if (!Number.isInteger(pIdx) || pIdx < 0 || pIdx > 3) {
      return res.status(400).json({ error: 'Index pemain 0-3' });
    }

    const paid = req.body?.paid;
    if (typeof paid !== 'boolean') {
      return res.status(400).json({ error: 'paid harus boolean' });
    }

    db.games[idx] = normalizeStoredGame(db.games[idx]);
    db.games[idx].players[pIdx].paid = paid;
    db.games[idx].updatedAt = new Date().toISOString();
    await saveDb(db);
    res.json(summarize(db, req.session.role === 'admin'));
  } catch (err) {
    next(err);
  }
});

app.post('/api/games/:id/mark-all-paid', requireStaff, async (req, res, next) => {
  try {
    const db = await loadDb();
    const idx = db.games.findIndex((g) => g.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Game tidak ditemukan' });
    const paid = req.body?.paid !== false;
    db.games[idx] = normalizeStoredGame(db.games[idx]);
    db.games[idx].players = db.games[idx].players.map((p) => ({ ...p, paid }));
    db.games[idx].updatedAt = new Date().toISOString();
    await saveDb(db);
    res.json(summarize(db, req.session.role === 'admin'));
  } catch (err) {
    next(err);
  }
});

// --- Kelola pemain: rename (cascade ke riwayat) + foto profil ---

app.patch('/api/players/:name', requireAdmin, async (req, res, next) => {
  try {
    const original = normalizeName(req.params.name);
    const db = await loadDb();
    const player = db.players.find((p) => p.name === original);
    if (!player) return res.status(404).json({ error: 'Pemain tidak ditemukan' });

    if (req.body?.name !== undefined) {
      const newName = normalizeName(req.body.name).slice(0, 60);
      if (!newName) return res.status(400).json({ error: 'Nama wajib diisi' });
      if (newName.toLowerCase() !== original.toLowerCase()) {
        const dup = db.players.some((p) => p !== player && p.name.toLowerCase() === newName.toLowerCase());
        if (dup) return res.status(409).json({ error: 'Nama pemain sudah dipakai' });

        for (const g of db.games) {
          let touched = false;
          for (const p of g.players) {
            if (p.name === original) { p.name = newName; touched = true; }
          }
          if (touched) g.updatedAt = new Date().toISOString();
        }
        if (db.carry && db.carry[original] !== undefined) {
          db.carry[newName] = Math.max(0, Number(db.carry[newName]) || 0) + Math.max(0, Number(db.carry[original]) || 0);
          delete db.carry[original];
        }
        await pool.query('UPDATE payments SET name = $1 WHERE name = $2', [newName, original]);
        player.name = newName;
      }
    }

    if (req.body?.photo !== undefined) {
      const photo = req.body.photo;
      if (photo === null) {
        player.photo = null;
      } else if (typeof photo === 'string') {
        if (!/^data:image\/(png|jpe?g|webp);base64,/.test(photo)) {
          return res.status(400).json({ error: 'Format foto tidak didukung' });
        }
        if (photo.length > 700000) {
          return res.status(400).json({ error: 'Ukuran foto terlalu besar' });
        }
        player.photo = photo;
      }
    }

    db.players.sort((a, b) => a.name.localeCompare(b.name, 'id'));
    await saveDb(db);
    res.json(summarize(db, true));
  } catch (err) {
    next(err);
  }
});

// --- Delegasi (penanggung jawab sementara): PIN terbatas waktu buat catat main ---

app.get('/api/operators', requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, expires_at, created_at, revoked_at FROM operators ORDER BY created_at DESC'
    );
    const now = Date.now();
    res.json({
      operators: rows.map((r) => ({
        id: r.id,
        name: r.name,
        expiresAt: r.expires_at.toISOString(),
        createdAt: r.created_at.toISOString(),
        revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
        active: !r.revoked_at && r.expires_at.getTime() > now,
      })),
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/operators', requireAdmin, async (req, res, next) => {
  try {
    const name = normalizeName(req.body?.name).slice(0, 60);
    if (!name) return res.status(400).json({ error: 'Nama wajib diisi' });

    const expiresAt = new Date(req.body?.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      return res.status(400).json({ error: 'Masa aktif tidak valid' });
    }
    if (expiresAt.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Masa aktif harus di masa depan' });
    }
    if (expiresAt.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: 'Masa aktif maksimal 1 tahun' });
    }

    let pin = generatePin();
    while (timingSafeEqualStr(pin, ADMIN_PIN)) pin = generatePin();

    const id = uid();
    await pool.query(
      'INSERT INTO operators (id, name, pin_hash, expires_at) VALUES ($1,$2,$3,$4)',
      [id, name, hashPin(pin), expiresAt.toISOString()]
    );
    res.status(201).json({
      operator: { id, name, expiresAt: expiresAt.toISOString() },
      pin,
    });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/operators/:id', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'UPDATE operators SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL RETURNING id',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Delegasi tidak ditemukan / sudah dicabut' });
    revokeOperatorSessions(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// --- Cicilan / lunasin per orang + QRIS ---

app.post('/api/players/settle', requireAdmin, async (req, res, next) => {
  try {
    const name = normalizeName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Nama wajib diisi' });

    const db = await loadDb();
    const carryBefore = Math.max(0, Number(db.carry[name]) || 0);
    let settled = 0;
    for (const g of db.games) {
      const cost = gameCost(g);
      for (const p of g.players) {
        if (p.name === name && !p.paid) {
          p.paid = true;
          settled += cost.perPerson;
          g.updatedAt = new Date().toISOString();
        }
      }
    }
    delete db.carry[name];
    await saveDb(db);
    // yang dianggap dibayar tunai = sisa (settled − carry yang sudah dititip)
    await recordPayment(name, Math.max(0, settled - carryBefore));
    res.json(summarize(db, true));
  } catch (err) {
    next(err);
  }
});

app.post('/api/players/pay', requireAdmin, async (req, res, next) => {
  try {
    const name = normalizeName(req.body?.name);
    const amount = Number(req.body?.amount);
    if (!name) return res.status(400).json({ error: 'Nama wajib diisi' });
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Nominal harus angka bulat > 0' });
    }

    const db = await loadDb();
    let credit = Math.max(0, Number(db.carry[name]) || 0) + amount;

    const refs = [];
    for (const g of db.games) {
      for (let i = 0; i < g.players.length; i++) {
        if (g.players[i].name === name && !g.players[i].paid) {
          refs.push({ g, i, perPerson: gameCost(g).perPerson });
        }
      }
    }
    refs.sort(
      (a, b) =>
        String(a.g.date).localeCompare(String(b.g.date)) ||
        String(a.g.createdAt).localeCompare(String(b.g.createdAt))
    );
    for (const r of refs) {
      if (credit >= r.perPerson) {
        r.g.players[r.i].paid = true;
        r.g.updatedAt = new Date().toISOString();
        credit -= r.perPerson;
      } else {
        break;
      }
    }
    if (credit > 0) db.carry[name] = credit;
    else delete db.carry[name];

    await saveDb(db);
    await recordPayment(name, amount);
    res.json(summarize(db, true));
  } catch (err) {
    next(err);
  }
});

app.post('/api/qris', async (req, res, next) => {
  try {
    const db = await loadDb();
    const merchant = db.settings.merchantQris;
    if (!merchant) return res.status(400).json({ error: 'QRIS belum diatur admin' });
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Nominal harus angka bulat > 0' });
    }
    try {
      const referenceLabel = 'KOK' + Date.now().toString(36).toUpperCase();
      const payload = addQrisReferenceLabel(convertQRIS(merchant, { amount }), referenceLabel);
      res.json({ payload, amount });
    } catch (e) {
      return res.status(400).json({ error: 'Gagal buat QRIS: ' + (e?.message || 'invalid') });
    }
  } catch (err) {
    next(err);
  }
});

// Express 5: bare '*' is invalid path-to-regexp syntax
app.get('/{*path}', (req, res) => {
  const file = req.path.startsWith('/admin') ? 'admin/index.html' : 'index.html';
  res.sendFile(path.join(__dirname, 'public', file));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

async function main() {
  ensureDataDir();
  await ensureSchema();
  await migrateLegacyJsonIfNeeded();
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`kok-badminton on http://127.0.0.1:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Gagal start:', err);
  process.exit(1);
});
