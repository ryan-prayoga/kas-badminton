function $(sel, root) {
  return (root || document).querySelector(sel);
}
function $$(sel, root) {
  return Array.prototype.slice.call((root || document).querySelectorAll(sel));
}

var state = { games: [], debtSummary: [], kokTypes: [], players: [], period: 'all' };

function fmt(n) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function todayLocal() {
  var d = new Date();
  var off = d.getTimezoneOffset();
  var local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

function relativeDay(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  var target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  var t = /^(\d{4})-(\d{2})-(\d{2})/.exec(todayLocal());
  var today = Date.UTC(Number(t[1]), Number(t[2]) - 1, Number(t[3]));
  var diffDays = Math.round((today - target) / 86400000);
  if (diffDays === 0) return 'Hari ini';
  if (diffDays === 1) return 'Kemarin';
  if (diffDays > 1 && diffDays < 7) return diffDays + ' hari lalu';
  return '';
}

function fmtDate(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return escapeHtml(iso);
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return Number(m[3]) + ' ' + months[Number(m[2]) - 1] + ' ' + m[1];
}

function dateBadge(iso) {
  var rel = relativeDay(iso);
  return rel
    ? '<span class="shrink-0 rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand">' + rel + '</span>'
    : '';
}

function humanAgo(ms) {
  var s = Math.floor(ms / 1000);
  if (s < 10) return 'barusan';
  if (s < 60) return s + ' detik lalu';
  var m = Math.floor(s / 60);
  if (m < 60) return m + ' menit lalu';
  var h = Math.floor(m / 60);
  return h + ' jam lalu';
}

function emptyState(icon, text) {
  return (
    '<div class="grid place-items-center gap-1.5 rounded-xl border border-dashed border-line bg-sunken py-7 text-soft">' +
      '<iconify-icon icon="' + icon + '" width="26"></iconify-icon>' +
      '<span class="text-sm">' + escapeHtml(text) + '</span>' +
    '</div>'
  );
}

function toast(message, type) {
  type = type === 'success' ? 'success' : type === 'error' ? 'error' : 'info';
  var stack = $('#toastStack');
  if (!stack) return;
  var icon = type === 'success' ? 'mdi:check-circle' : type === 'error' ? 'mdi:alert-circle-outline' : 'mdi:information-outline';
  var cls = type === 'success' ? 'border-ok/30 bg-ok/10 text-ok' : type === 'error' ? 'border-danger/30 bg-danger/10 text-danger' : 'border-line bg-elevated text-ink50';
  var el = document.createElement('div');
  el.className = 'pointer-events-auto flex items-center gap-2 rounded-xl border ' + cls + ' px-3.5 py-3 text-sm font-medium shadow-card animate-rise transition duration-300';
  el.innerHTML = '<iconify-icon icon="' + icon + '" width="18" class="shrink-0"></iconify-icon><span class="min-w-0 flex-1">' + escapeHtml(message) + '</span>';
  stack.appendChild(el);
  setTimeout(function () {
    el.classList.add('opacity-0', '-translate-y-1');
    setTimeout(function () { el.remove(); }, 300);
  }, 2600);
}

// --- Filter periode ---
var MONTHS_FULL = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function periodKey(iso) {
  var m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
  return m ? m[1] + '-' + m[2] : '';
}

function periodLabel(key) {
  var m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  return MONTHS_FULL[Number(m[2]) - 1] + ' ' + m[1];
}

function gamesInPeriod(games) {
  if (state.period === 'all') return games;
  return games.filter(function (g) { return periodKey(g.date) === state.period; });
}

function renderPeriodFilter() {
  var keys = {};
  state.games.forEach(function (g) { var k = periodKey(g.date); if (k) keys[k] = true; });
  var opts = Object.keys(keys).sort().reverse();
  if (state.period !== 'all' && opts.indexOf(state.period) === -1) state.period = 'all';
  var html = '<option value="all">Semua waktu</option>' +
    opts.map(function (k) { return '<option value="' + k + '">' + periodLabel(k) + '</option>'; }).join('');
  $$('.periodFilter').forEach(function (sel) {
    if (sel.innerHTML !== html) sel.innerHTML = html;
    sel.value = state.period;
  });
}

function wirePeriodFilter() {
  document.addEventListener('change', function (e) {
    if (!e.target.classList || !e.target.classList.contains('periodFilter')) return;
    state.period = e.target.value;
    renderPeriodFilter();
    renderStats();
    renderStatPlayers();
    renderGames();
  });
}

// --- Stats ---
function statCard(opts) {
  return (
    '<div class="rounded-xl2 border border-line bg-surface shadow-card p-3.5 animate-rise">' +
      '<div class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-soft">' +
        '<iconify-icon icon="' + opts.icon + '" width="15" class="' + opts.iconClass + '"></iconify-icon>' +
        escapeHtml(opts.label) +
      '</div>' +
      '<div class="mt-1.5 font-mono text-xl font-bold tracking-tight ' + (opts.valueClass || '') + '">' + opts.value + '</div>' +
      (opts.sub ? '<div class="mt-0.5 text-xs text-soft">' + escapeHtml(opts.sub) + '</div>' : '') +
    '</div>'
  );
}

function renderStats() {
  var strip = $('#statStrip');
  if (!strip) return;
  var games = gamesInPeriod(state.games);
  var totalDebt = state.debtSummary.reduce(function (s, d) { return s + d.total; }, 0);
  var totalKok = games.reduce(function (s, g) { return s + (g.cost ? g.cost.kokCount : 0); }, 0);
  var types = state.kokTypes || [];
  var stockLeft = types.reduce(function (s, t) { return s + Math.max(0, Number(t.stock) || 0); }, 0);
  var typesWithStock = types.filter(function (t) { return (Number(t.stock) || 0) > 0; }).length;
  // Total kas sengaja TIDAK ditampilkan di publik (admin-only).
  strip.innerHTML =
    statCard({
      icon: 'mdi:cash-multiple', iconClass: 'text-warn', label: 'Belum bayar',
      value: fmt(totalDebt), valueClass: totalDebt ? 'text-warn' : 'text-ok',
      sub: state.debtSummary.length ? state.debtSummary.length + ' orang' : 'Semua lunas',
    }) +
    statCard({
      icon: 'mdi:badminton', iconClass: 'text-brand', label: 'Total main',
      value: String(games.length), sub: games.length ? 'game tercatat' : 'belum ada',
    }) +
    statCard({
      icon: 'game-icons:shuttlecock', iconClass: 'text-brand', label: 'Kok terpakai',
      value: String(totalKok), sub: 'total kok',
    }) +
    statCard({
      icon: 'mdi:package-variant', iconClass: stockLeft > 0 ? 'text-ok' : 'text-danger', label: 'Stok kok sisa',
      value: String(stockLeft), valueClass: stockLeft > 0 ? '' : 'text-danger',
      sub: stockLeft > 0 ? typesWithStock + ' jenis tersedia' : 'stok habis',
    });
}

function computePlayerStats() {
  var map = {};
  gamesInPeriod(state.games).forEach(function (g) {
    (g.players || []).forEach(function (p) {
      if (!p.name) return;
      if (!map[p.name]) map[p.name] = { name: p.name, main: 0, keluar: 0, lunas: 0, nunggak: 0 };
      var s = map[p.name];
      s.main += 1;
      s.keluar += g.cost.perPerson;
      if (p.paid) s.lunas += g.cost.perPerson;
      else s.nunggak += g.cost.perPerson;
    });
  });
  return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
    return b.nunggak - a.nunggak || b.main - a.main || a.name.localeCompare(b.name, 'id');
  });
}

function renderStatPlayers() {
  var list = $('#statPlayers');
  if (!list) return;
  var rows = computePlayerStats();
  if (!rows.length) {
    list.innerHTML = emptyState('mdi:account-off-outline', 'Belum ada pemain.');
    return;
  }
  var photoMap = playerPhotoMap();
  list.innerHTML = rows.map(function (s) {
    return (
      '<div class="flex items-center gap-3 rounded-xl border border-line bg-elevated p-3">' +
        avatarHtml(s.name, photoMap[s.name], 'h-9 w-9') +
        '<div class="min-w-0 flex-1">' +
          '<div class="truncate font-semibold">' + escapeHtml(s.name) + '</div>' +
          '<div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-soft">' +
            '<span>' + s.main + ' main</span>' +
            '<span>keluar ' + fmt(s.keluar) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="shrink-0 text-right">' +
          (s.nunggak > 0
            ? '<div class="font-mono text-sm font-bold text-warn">' + fmt(s.nunggak) + '</div><div class="text-[10px] text-soft">nunggak</div>'
            : '<div class="font-mono text-sm font-bold text-ok">Lunas</div>') +
        '</div>' +
      '</div>'
    );
  }).join('');
}

// --- Avatar (foto profil / inisial) ---
function playerPhotoMap() {
  var map = {};
  (state.players || []).forEach(function (p) { if (p && p.name && p.photo) map[p.name] = p.photo; });
  return map;
}

function avatarHtml(name, photo, sizeClass, colorClass) {
  sizeClass = sizeClass || 'h-9 w-9';
  colorClass = colorClass || 'bg-brand/15 text-brand';
  if (photo) {
    return '<img src="' + escapeHtml(photo) + '" alt="" class="' + sizeClass + ' shrink-0 rounded-full border border-line object-cover" />';
  }
  return '<div class="grid ' + sizeClass + ' shrink-0 place-items-center rounded-full ' + colorClass + ' font-bold">' + escapeHtml((name || '?').slice(0, 1).toUpperCase()) + '</div>';
}

// --- Riwayat cards ---
function playerChip(p) {
  if (!p) p = { name: '—', paid: false };
  var cls = p.paid ? 'border-ok/30 bg-ok/10 text-ok' : 'border-warn/30 bg-warn/10 text-warn';
  return (
    '<div class="flex min-w-0 items-center gap-2 rounded-lg border ' + cls + ' px-2 py-2">' +
      avatarHtml(p.name, playerPhotoMap()[p.name], 'h-6 w-6') +
      '<span class="min-w-0 flex-1 truncate text-sm font-medium">' + escapeHtml(p.name) + '</span>' +
      '<iconify-icon icon="' + (p.paid ? 'mdi:check-circle' : 'mdi:clock-outline') + '" width="15" class="shrink-0"></iconify-icon>' +
    '</div>'
  );
}

function pairGroup(chips) {
  return '<div class="grid min-w-0 gap-1.5">' + chips + '</div>';
}

function kokSummaryLabel(g) {
  var names = [];
  var seen = {};
  (g.koks || []).forEach(function (k) {
    var n = k && k.typeName ? String(k.typeName).trim() : '';
    if (n && !seen[n]) { seen[n] = true; names.push(n); }
  });
  var base = g.cost.kokCount + ' kok · ' + fmt(g.cost.perPerson) + '/org';
  if (!names.length) return base;
  if (names.length === 1) return base + ' · ' + names[0];
  return base + ' · ' + names.length + ' jenis';
}

function gameCard(g) {
  var statusBadge = g.summary.allPaid
    ? '<span class="inline-flex items-center gap-1 rounded-full bg-ok/15 px-2 py-0.5 text-[11px] font-semibold text-ok"><iconify-icon icon="mdi:check-circle" width="13"></iconify-icon>Lunas</span>'
    : '<span class="inline-flex items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn"><iconify-icon icon="mdi:alert-circle-outline" width="13"></iconify-icon>' + g.summary.unpaidCount + ' belum</span>';

  return (
    '<div class="rounded-xl2 bg-elevated p-3.5">' +
      '<div class="flex items-center justify-between gap-3">' +
        '<div class="flex min-w-0 items-center gap-1.5 text-xs text-muted">' +
          '<iconify-icon icon="game-icons:shuttlecock" width="13" class="shrink-0 text-soft"></iconify-icon>' +
          '<span class="truncate">' + escapeHtml(kokSummaryLabel(g)) + '</span>' +
        '</div>' +
        '<div class="shrink-0">' + statusBadge + '</div>' +
      '</div>' +
      '<div class="mt-1 flex items-center gap-1 text-[11px] text-soft">' +
        '<iconify-icon icon="mdi:pencil-outline" width="11" class="shrink-0"></iconify-icon>' +
        '<span class="truncate">dicatat oleh ' + escapeHtml(g.recordedBy || 'Admin') + '</span>' +
      '</div>' +
      '<div class="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-1.5 sm:gap-x-2.5">' +
        pairGroup(playerChip(g.players[0]) + playerChip(g.players[1])) +
        '<div class="text-center text-[10px] font-bold uppercase tracking-wider text-soft">vs</div>' +
        pairGroup(playerChip(g.players[2]) + playerChip(g.players[3])) +
      '</div>' +
      (g.notes
        ? '<div class="mt-2.5 flex items-start gap-1.5 rounded-lg bg-sunken px-2.5 py-2 text-xs text-muted">' +
            '<iconify-icon icon="mdi:note-text-outline" width="14" class="mt-0.5 shrink-0 text-soft"></iconify-icon>' +
            '<span class="min-w-0">' + escapeHtml(g.notes) + '</span>' +
          '</div>'
        : '') +
    '</div>'
  );
}

// --- Belum bayar ---
function groupDebtItems(items) {
  var map = {};
  var order = [];
  (items || []).forEach(function (it) {
    if (!map[it.date]) { map[it.date] = { date: it.date, total: 0, count: 0, koks: 0 }; order.push(it.date); }
    map[it.date].total += Number(it.amount) || 0;
    map[it.date].count += 1;
    map[it.date].koks += Number(it.kokCount) || 0;
  });
  return order.map(function (dt) { return map[dt]; });
}

function debtRow(g) {
  return (
    '<div class="px-3 py-2 odd:bg-white/[0.02]">' +
      '<div class="flex items-center justify-between gap-2">' +
        '<span class="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted">' +
          '<iconify-icon icon="mdi:calendar-blank-outline" width="13" class="shrink-0 text-soft"></iconify-icon>' +
          '<span class="truncate">' + fmtDate(g.date) + '</span>' +
        '</span>' +
        '<span class="shrink-0 font-mono text-sm font-semibold text-warn">' + fmt(g.total) + '</span>' +
      '</div>' +
      '<div class="mt-1 flex items-center gap-3 text-[11px] text-soft">' +
        '<span class="flex items-center gap-1"><iconify-icon icon="mdi:badminton" width="13"></iconify-icon>' + g.count + ' main</span>' +
        '<span class="flex items-center gap-1"><iconify-icon icon="game-icons:shuttlecock" width="12"></iconify-icon>' + g.koks + ' kok</span>' +
        dateBadge(g.date) +
      '</div>' +
    '</div>'
  );
}

function debtCard(d) {
  var grouped = groupDebtItems(d.items);
  var carryLine = d.carry > 0
    ? '<div class="mt-0.5 text-[11px] text-ok">sudah dicicil ' + fmt(d.carry) + ' dari ' + fmt(d.owedGross) + '</div>'
    : '';
  return (
    '<details class="debt rounded-xl2 border border-warn/25 bg-warn/[0.06] p-3.5 animate-rise">' +
      '<summary class="flex select-none items-center justify-between gap-3">' +
        '<div class="flex min-w-0 items-center gap-2.5">' +
          avatarHtml(d.name, playerPhotoMap()[d.name], 'h-9 w-9', 'bg-warn/15 text-warn') +
          '<div class="min-w-0">' +
            '<div class="truncate font-semibold">' + escapeHtml(d.name) + '</div>' +
            '<div class="debt-count text-xs text-muted">' + d.items.length + ' game belum lunas</div>' +
            carryLine +
          '</div>' +
        '</div>' +
        '<div class="flex shrink-0 items-center gap-2">' +
          '<span class="font-mono text-base font-bold text-warn">' + fmt(d.total) + '</span>' +
          '<iconify-icon icon="mdi:chevron-down" width="20" class="debt-chevron text-soft"></iconify-icon>' +
        '</div>' +
      '</summary>' +
      '<div class="mt-3 grid gap-px overflow-hidden rounded-lg border border-warn/15 bg-sunken">' +
        grouped.map(debtRow).join('') +
      '</div>' +
      '<div class="mt-3 grid grid-cols-1 gap-2">' +
        '<button type="button" data-action="share" data-name="' + escapeHtml(d.name) + '" class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-line bg-elevated px-3 py-2.5 text-sm font-medium transition active:scale-95 focus-visible:ring-2 focus-visible:ring-brand/60">' +
          '<iconify-icon icon="mdi:share-variant-outline" width="16"></iconify-icon> Share tagihan</button>' +
      '</div>' +
    '</details>'
  );
}

function renderDebt() {
  var list = $('#debtList');
  var meta = $('#debtMeta');
  if (!list || !meta) return;
  var total = state.debtSummary.reduce(function (s, d) { return s + d.total; }, 0);
  meta.innerHTML = state.debtSummary.length
    ? '<span class="inline-flex items-center gap-1"><iconify-icon icon="mdi:account-multiple-outline" width="13"></iconify-icon>' + state.debtSummary.length + ' orang</span>' +
      '<span class="text-line">·</span>' +
      '<span class="inline-flex items-center gap-1 font-mono font-semibold text-warn"><iconify-icon icon="mdi:cash-multiple" width="13"></iconify-icon>' + fmt(total) + '</span>'
    : 'Semua lunas';
  if (!state.debtSummary.length) {
    list.innerHTML = emptyState('mdi:emoticon-happy-outline', 'Semua sudah bayar 🎉');
    return;
  }
  list.innerHTML = state.debtSummary.map(debtCard).join('');
}

function groupGamesByDate(games) {
  var map = {};
  var order = [];
  games.forEach(function (g) {
    if (!map[g.date]) { map[g.date] = { date: g.date, games: [], total: 0, unpaidCount: 0 }; order.push(g.date); }
    var grp = map[g.date];
    grp.games.push(g);
    grp.total += g.cost.total;
    grp.unpaidCount += g.summary.unpaidCount;
  });
  return order.map(function (dt) { return map[dt]; });
}

function historyGroup(grp, open) {
  var allPaid = grp.unpaidCount === 0;
  var statusBadge = allPaid
    ? '<span class="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-ok/15 px-1.5 py-0.5 text-[11px] font-semibold text-ok"><iconify-icon icon="mdi:check-circle" width="13"></iconify-icon>Lunas</span>'
    : '<span class="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-warn/15 px-1.5 py-0.5 text-[11px] font-semibold text-warn"><iconify-icon icon="mdi:alert-circle-outline" width="13"></iconify-icon>' + grp.unpaidCount + ' belum</span>';

  return (
    '<details class="history overflow-hidden rounded-xl2 border border-line bg-surface shadow-card" data-date="' + escapeHtml(grp.date) + '"' + (open ? ' open' : '') + '>' +
      '<summary class="flex select-none items-center justify-between gap-2 p-3.5">' +
        '<div class="min-w-0">' +
          '<div class="flex items-center gap-1.5 font-semibold">' +
            '<iconify-icon icon="mdi:calendar-blank-outline" width="16" class="text-soft shrink-0"></iconify-icon>' +
            '<span class="truncate">' + fmtDate(grp.date) + '</span>' +
          '</div>' +
          '<div class="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted">' +
            '<span class="inline-flex items-center gap-1"><iconify-icon icon="mdi:badminton" width="13"></iconify-icon>' + grp.games.length + ' main</span>' +
            '<span class="inline-flex items-center gap-1 font-mono"><iconify-icon icon="mdi:cash-multiple" width="13"></iconify-icon>' + fmt(grp.total) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="flex shrink-0 items-center gap-1.5">' +
          statusBadge +
          '<iconify-icon icon="mdi:chevron-down" width="20" class="debt-chevron text-soft shrink-0"></iconify-icon>' +
        '</div>' +
      '</summary>' +
      '<div class="grid gap-3 border-t border-line p-3.5">' +
        grp.games.map(function (g) { return gameCard(g); }).join('') +
      '</div>' +
    '</details>'
  );
}

function renderGames() {
  var list = $('#gameList');
  var meta = $('#historyMeta');
  if (!list || !meta) return;
  var games = gamesInPeriod(state.games);
  meta.innerHTML = '<iconify-icon icon="mdi:badminton" width="12"></iconify-icon>' + (games.length ? games.length + ' game' : 'Kosong');
  if (!games.length) {
    list.innerHTML = emptyState('mdi:badminton', 'Belum ada catatan.');
    return;
  }
  // preserve which date groups were open
  var openDates = {};
  $$('#gameList details.history[open]').forEach(function (el) {
    openDates[el.getAttribute('data-date')] = true;
  });
  var hadAny = Object.keys(openDates).length > 0;
  var groups = groupGamesByDate(games);
  list.innerHTML = groups.map(function (grp, i) {
    var open = hadAny ? !!openDates[grp.date] : i === 0;
    return historyGroup(grp, open);
  }).join('');
}

// --- Share ---
function debtShareText(d) {
  var lines = ['Tagihan kok badminton — ' + d.name, 'Sisa: ' + fmt(d.total)];
  if (d.carry > 0) lines.push('(sudah dicicil ' + fmt(d.carry) + ' dari ' + fmt(d.owedGross) + ')');
  groupDebtItems(d.items).forEach(function (g) {
    lines.push('• ' + fmtDate(g.date) + ' — ' + fmt(g.total) + ' (' + g.count + ' main)');
  });
  return lines.join('\n');
}

function shareAllText() {
  if (!state.debtSummary.length) return 'Semua sudah lunas 🎉';
  var total = state.debtSummary.reduce(function (s, d) { return s + d.total; }, 0);
  var lines = ['Rekap tagihan kok badminton', 'Total belum bayar: ' + fmt(total), ''];
  state.debtSummary.forEach(function (d) { lines.push('• ' + d.name + ': ' + fmt(d.total)); });
  return lines.join('\n');
}

function doShare(text) {
  if (navigator.share) {
    navigator.share({ text: text }).catch(function () {});
    return;
  }
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { toast('Disalin.', 'success'); }, function () { toast('Gagal salin.', 'error'); });
  } else {
    toast('Clipboard tidak didukung.', 'error');
  }
}

// --- Tabs ---
function switchTab(name) {
  $$('[data-panel]').forEach(function (el) { el.hidden = el.getAttribute('data-panel') !== name; });
  $$('#bottomNav .navitem').forEach(function (b) {
    b.classList.toggle('is-active', b.getAttribute('data-tab') === name);
  });
  try { sessionStorage.setItem('kok-tab', name); } catch (e) {}
  window.scrollTo(0, 0);
}

function wireTabs() {
  $('#bottomNav').onclick = function (e) {
    var btn = e.target.closest('.navitem');
    if (!btn) return;
    switchTab(btn.getAttribute('data-tab'));
  };
  var saved = 'riwayat';
  try { saved = sessionStorage.getItem('kok-tab') || 'riwayat'; } catch (e) {}
  switchTab(saved);
}

function wireDebtActions() {
  $('#debtList').onclick = function (e) {
    var btn = e.target.closest('button[data-action]');
    if (!btn) return;
    e.preventDefault();
    var action = btn.getAttribute('data-action');
    var name = btn.getAttribute('data-name');
    var d = state.debtSummary.filter(function (x) { return x.name === name; })[0];
    if (action === 'share' && d) doShare(debtShareText(d));
  };
  $('#shareAllBtn').onclick = function () { doShare(shareAllText()); };
}

// --- Data load ---
var lastUpdatedAt = null;

function updateLastUpdatedLabel() {
  var el = $('#lastUpdated');
  if (!el || !lastUpdatedAt) return;
  el.textContent = 'Diperbarui ' + humanAgo(Date.now() - lastUpdatedAt);
}

function applyData(data) {
  state.games = data.games || [];
  state.debtSummary = data.debtSummary || [];
  state.kokTypes = data.kokTypes || [];
  state.players = data.players || [];
  renderPeriodFilter();
  renderStats();
  renderStatPlayers();
  renderDebt();
  renderGames();
  lastUpdatedAt = Date.now();
  updateLastUpdatedLabel();
}

function loadData(silent) {
  var btn = $('#refreshBtn');
  if (btn && !silent) btn.classList.add('animate-spin');
  return fetch('/api/bootstrap')
    .then(function (res) { return res.json(); })
    .then(applyData)
    .catch(function (err) {
      console.error(err);
      if (!silent) {
        $('#gameList').innerHTML = emptyState('mdi:alert-circle-outline', 'Gagal load data.');
        $('#debtList').innerHTML = emptyState('mdi:alert-circle-outline', 'Gagal load data.');
      }
    })
    .finally(function () {
      if (btn) btn.classList.remove('animate-spin');
    });
}

$('#refreshBtn').onclick = function () { loadData(false); };
wireTabs();
wireDebtActions();
wirePeriodFilter();
setInterval(updateLastUpdatedLabel, 30000);
setInterval(function () { if (!document.hidden) loadData(true); }, 45000);
document.addEventListener('visibilitychange', function () { if (!document.hidden) loadData(true); });
loadData(false);
