require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT) || 8200;
const DATA_DIR = path.join(__dirname, 'data');
const LEGACY_DATA_FILE = path.join(DATA_DIR, 'db.json');
const ADMIN_PIN_FILE = path.join(DATA_DIR, 'admin-pin.txt');
const PIN_LENGTH = 6;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari
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

const sessions = new Map(); // token -> expiresAt

function isValidSession(token) {
  if (!token) return false;
  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function requireAdmin(req, res, next) {
  if (isValidSession(req.cookies?.[SESSION_COOKIE])) return next();
  res.status(401).json({ error: 'Perlu login admin' });
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

function cleanScore(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, 20);
}

/** Migrate old flat score/players shape → pairs + scores */
function normalizeStoredGame(game) {
  if (!game || typeof game !== 'object') return game;

  let players = Array.isArray(game.players) ? game.players.slice(0, 4) : [];
  while (players.length < 4) players.push({ name: '', paid: false });
  players = players.map((p) => ({
    name: normalizeName(typeof p === 'string' ? p : p?.name),
    paid: Boolean(typeof p === 'object' && p ? p.paid : false),
  }));

  let scores = game.scores;
  if (!scores || typeof scores !== 'object') {
    // old single score string like "21-19" or free text
    const legacy = cleanScore(game.score);
    let a = '';
    let b = '';
    if (legacy) {
      const m = legacy.match(/^(\d+)\s*[-:]\s*(\d+)/);
      if (m) {
        a = m[1];
        b = m[2];
      } else {
        a = legacy;
      }
    }
    scores = { a, b };
  } else {
    scores = { a: cleanScore(scores.a), b: cleanScore(scores.b) };
  }

  return {
    ...game,
    players,
    scores,
    // keep legacy score field for display fallback only
    score: game.score || '',
  };
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

function scoreLabel(scores) {
  const a = cleanScore(scores?.a);
  const b = cleanScore(scores?.b);
  if (!a && !b) return '';
  if (a && b) return `${a}-${b}`;
  return a || b;
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
    a: { players: [players[0], players[1]], score: cleanScore(g.scores?.a) },
    b: { players: [players[2], players[3]], score: cleanScore(g.scores?.b) },
  };
  return {
    ...g,
    players,
    pairs,
    scoreLabel: scoreLabel(g.scores),
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
  const set = new Set(db.players.map((n) => n.toLowerCase()));
  for (const n of names) {
    const name = normalizeName(n);
    if (!name) continue;
    if (!set.has(name.toLowerCase())) {
      db.players.push(name);
      set.add(name.toLowerCase());
    }
  }
  db.players.sort((a, b) => a.localeCompare(b, 'id'));
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

function parseScoresFromBody(body) {
  if (body.scores && typeof body.scores === 'object') {
    return {
      a: cleanScore(body.scores.a),
      b: cleanScore(body.scores.b),
    };
  }
  // legacy single score "21-19"
  const legacy = cleanScore(body.score);
  if (!legacy) return { a: '', b: '' };
  const m = legacy.match(/^(\d+)\s*[-:]\s*(\d+)/);
  if (m) return { a: m[1], b: m[2] };
  return { a: legacy, b: '' };
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

function buildKoks(body, defaultPrice) {
  let koks = Array.isArray(body.koks) ? body.koks : null;
  if (!koks || koks.length === 0) {
    const count = Math.max(1, Math.min(50, Number(body.kokCount) || 1));
    return Array.from({ length: count }, () => ({
      id: uid(),
      pricePerPerson: Number.isFinite(Number(body.pricePerPerson))
        ? Math.round(Number(body.pricePerPerson))
        : defaultPrice,
    }));
  }
  koks = koks.slice(0, 50).map((k) => ({
    id: k.id || uid(),
    pricePerPerson: Number.isFinite(Number(k?.pricePerPerson))
      ? Math.round(Number(k.pricePerPerson))
      : defaultPrice,
  }));
  if (koks.length === 0) koks = [{ id: uid(), pricePerPerson: defaultPrice }];
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
    scores: r.scores,
    koks: r.koks,
    notes: r.notes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  });
}

async function loadDb() {
  const [settingsRes, playersRes, gamesRes] = await Promise.all([
    pool.query('SELECT default_price_per_person FROM settings WHERE id = 1'),
    pool.query('SELECT name FROM players ORDER BY name'),
    pool.query('SELECT id, date, players, scores, koks, notes, created_at, updated_at FROM games'),
  ]);
  return {
    settings: {
      defaultPricePerPerson: Number(settingsRes.rows[0]?.default_price_per_person) || 3000,
    },
    players: playersRes.rows.map((r) => r.name),
    games: gamesRes.rows.map(rowToGame),
  };
}

async function saveDb(db) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE settings SET default_price_per_person = $1 WHERE id = 1', [
      db.settings.defaultPricePerPerson,
    ]);
    await client.query('DELETE FROM players');
    for (const name of db.players) {
      await client.query('INSERT INTO players (name) VALUES ($1)', [name]);
    }
    await client.query('DELETE FROM games');
    for (const g of db.games) {
      await client.query(
        `INSERT INTO games (id, date, players, scores, koks, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          g.id,
          g.date,
          JSON.stringify(g.players),
          JSON.stringify(g.scores),
          JSON.stringify(g.koks),
          g.notes,
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
          JSON.stringify(g.scores),
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
  res.json({ isAdmin: isValidSession(req.cookies?.[SESSION_COOKIE]) });
});

app.post('/api/login', loginRateLimit, (req, res) => {
  const pin = String(req.body?.pin ?? '');
  if (!timingSafeEqualStr(pin, ADMIN_PIN)) {
    return res.status(401).json({ error: 'PIN salah' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: SESSION_TTL_MS,
  });
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) sessions.delete(token);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.get('/api/bootstrap', async (_req, res, next) => {
  try {
    const db = await loadDb();
    const games = db.games
      .slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(enrichGame);

    const unpaid = [];
    for (const g of games) {
      for (const p of g.players) {
        if (!p.paid) {
          unpaid.push({
            gameId: g.id,
            date: g.date,
            name: p.name,
            amount: g.cost.perPerson,
            score: g.scoreLabel || null,
          });
        }
      }
    }

    const byName = {};
    for (const u of unpaid) {
      if (!byName[u.name]) byName[u.name] = { name: u.name, total: 0, items: [] };
      byName[u.name].total += u.amount;
      byName[u.name].items.push(u);
    }

    res.json({
      settings: db.settings,
      players: db.players,
      games,
      debtSummary: Object.values(byName).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'id')),
    });
  } catch (err) {
    next(err);
  }
});

app.put('/api/settings', requireAdmin, async (req, res, next) => {
  try {
    const price = Number(req.body?.defaultPricePerPerson);
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: 'defaultPricePerPerson harus angka >= 0' });
    }
    const db = await loadDb();
    db.settings.defaultPricePerPerson = Math.round(price);
    await saveDb(db);
    res.json({ settings: db.settings });
  } catch (err) {
    next(err);
  }
});

app.post('/api/games', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const parsed = parsePlayersFromBody(body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const err = validatePlayers(parsed.players);
    if (err) return res.status(400).json({ error: err });

    const db = await loadDb();
    const scores = parseScoresFromBody(body);
    const koks = buildKoks(body, db.settings.defaultPricePerPerson);

    const game = {
      id: uid(),
      date: body.date || todayWIB(),
      players: parsed.players,
      scores,
      koks,
      notes: body.notes ? String(body.notes).trim() : '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    rememberPlayers(db, parsed.players.map((p) => p.name));
    db.games.unshift(game);
    await saveDb(db);
    res.status(201).json({ game: enrichGame(game) });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/games/:id', requireAdmin, async (req, res, next) => {
  try {
    const db = await loadDb();
    const idx = db.games.findIndex((g) => g.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Game tidak ditemukan' });

    const body = req.body || {};
    const game = normalizeStoredGame(db.games[idx]);

    if (body.date) game.date = String(body.date);
    if (body.notes !== undefined) game.notes = String(body.notes || '').trim();

    if (body.scores !== undefined || body.score !== undefined) {
      game.scores = parseScoresFromBody(body);
    }

    if (body.pairs || (Array.isArray(body.players) && body.players.length === 4)) {
      const parsed = parsePlayersFromBody(body, game.players);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const err = validatePlayers(parsed.players);
      if (err) return res.status(400).json({ error: err });
      game.players = parsed.players;
      rememberPlayers(db, parsed.players.map((p) => p.name));
    }

    if (Array.isArray(body.koks) && body.koks.length > 0) {
      game.koks = body.koks.slice(0, 50).map((k) => ({
        id: k.id || uid(),
        pricePerPerson: Number.isFinite(Number(k.pricePerPerson))
          ? Math.round(Number(k.pricePerPerson))
          : db.settings.defaultPricePerPerson,
      }));
    }

    game.updatedAt = new Date().toISOString();
    db.games[idx] = game;
    await saveDb(db);
    res.json({ game: enrichGame(game) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/games/:id/koks', requireAdmin, async (req, res, next) => {
  try {
    const db = await loadDb();
    const idx = db.games.findIndex((g) => g.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Game tidak ditemukan' });

    const price = Number(req.body?.pricePerPerson);
    const pricePerPerson = Number.isFinite(price)
      ? Math.round(price)
      : db.settings.defaultPricePerPerson;

    const kok = { id: uid(), pricePerPerson };
    db.games[idx] = normalizeStoredGame(db.games[idx]);
    db.games[idx].koks.push(kok);
    db.games[idx].updatedAt = new Date().toISOString();
    await saveDb(db);
    res.status(201).json({ game: enrichGame(db.games[idx]), kok });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/games/:id/koks/:kokId', requireAdmin, async (req, res, next) => {
  try {
    const db = await loadDb();
    const idx = db.games.findIndex((g) => g.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Game tidak ditemukan' });

    const game = normalizeStoredGame(db.games[idx]);
    if (game.koks.length <= 1) {
      return res.status(400).json({ error: 'Minimal 1 kok per game' });
    }
    const before = game.koks.length;
    game.koks = game.koks.filter((k) => k.id !== req.params.kokId);
    if (game.koks.length === before) return res.status(404).json({ error: 'Kok tidak ditemukan' });
    game.updatedAt = new Date().toISOString();
    db.games[idx] = game;
    await saveDb(db);
    res.json({ game: enrichGame(game) });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/games/:id/koks/:kokId', requireAdmin, async (req, res, next) => {
  try {
    const db = await loadDb();
    const idx = db.games.findIndex((g) => g.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Game tidak ditemukan' });

    const game = normalizeStoredGame(db.games[idx]);
    const kok = game.koks.find((k) => k.id === req.params.kokId);
    if (!kok) return res.status(404).json({ error: 'Kok tidak ditemukan' });

    const price = Number(req.body?.pricePerPerson);
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: 'pricePerPerson harus angka >= 0' });
    }
    kok.pricePerPerson = Math.round(price);
    game.updatedAt = new Date().toISOString();
    db.games[idx] = game;
    await saveDb(db);
    res.json({ game: enrichGame(game) });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/games/:id/players/:index/paid', requireAdmin, async (req, res, next) => {
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
    res.json({ game: enrichGame(db.games[idx]) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/games/:id/mark-all-paid', requireAdmin, async (req, res, next) => {
  try {
    const db = await loadDb();
    const idx = db.games.findIndex((g) => g.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Game tidak ditemukan' });
    const paid = req.body?.paid !== false;
    db.games[idx] = normalizeStoredGame(db.games[idx]);
    db.games[idx].players = db.games[idx].players.map((p) => ({ ...p, paid }));
    db.games[idx].updatedAt = new Date().toISOString();
    await saveDb(db);
    res.json({ game: enrichGame(db.games[idx]) });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/games/:id', requireAdmin, async (req, res, next) => {
  try {
    const db = await loadDb();
    const before = db.games.length;
    db.games = db.games.filter((g) => g.id !== req.params.id);
    if (db.games.length === before) return res.status(404).json({ error: 'Game tidak ditemukan' });
    await saveDb(db);
    res.json({ ok: true });
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
  await migrateLegacyJsonIfNeeded();
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`kok-badminton on http://127.0.0.1:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Gagal start:', err);
  process.exit(1);
});
