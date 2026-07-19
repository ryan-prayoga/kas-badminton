function $(sel, root) {
  return (root || document).querySelector(sel);
}

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

function fmtDate(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return escapeHtml(iso);
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return Number(m[3]) + ' ' + months[Number(m[2]) - 1] + ' ' + m[1];
}

function emptyState(icon, text) {
  return (
    '<div class="grid place-items-center gap-1.5 rounded-xl border border-dashed border-line bg-sunken py-7 text-soft">' +
      '<iconify-icon icon="' + icon + '" width="26"></iconify-icon>' +
      '<span class="text-sm">' + escapeHtml(text) + '</span>' +
    '</div>'
  );
}

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

function renderStats(games, debtSummary) {
  var strip = $('#statStrip');
  if (!strip) return;
  var totalDebt = debtSummary.reduce(function (s, d) { return s + d.total; }, 0);
  strip.innerHTML =
    statCard({
      icon: 'mdi:cash-multiple',
      iconClass: 'text-warn',
      label: 'Belum bayar',
      value: fmt(totalDebt),
      valueClass: totalDebt ? 'text-warn' : 'text-ok',
      sub: debtSummary.length ? debtSummary.length + ' orang' : 'Semua lunas',
    }) +
    statCard({
      icon: 'mdi:badminton',
      iconClass: 'text-brand',
      label: 'Total main',
      value: String(games.length),
      sub: games.length ? 'game tercatat' : 'belum ada',
    });
}

function playerChip(g, p) {
  if (!p) p = { name: '—', paid: false };
  var cls = p.paid
    ? 'border-ok/30 bg-ok/10 text-ok'
    : 'border-warn/30 bg-warn/10 text-warn';
  return (
    '<div class="flex items-center justify-between gap-2 rounded-lg border ' + cls + ' px-2.5 py-2">' +
      '<span class="min-w-0 truncate text-sm font-medium">' + escapeHtml(p.name) + '</span>' +
      '<span class="flex shrink-0 items-center gap-1 font-mono text-xs">' +
        '<iconify-icon icon="' + (p.paid ? 'mdi:check-circle' : 'mdi:clock-outline') + '" width="14"></iconify-icon>' +
        fmt(g.cost.perPerson) +
      '</span>' +
    '</div>'
  );
}

function matchSide(label, score, chips) {
  return (
    '<div class="grid gap-2 rounded-xl border border-line bg-sunken p-2.5">' +
      '<div class="flex items-center justify-between gap-2">' +
        '<span class="text-[11px] font-bold uppercase tracking-wider text-muted">' + escapeHtml(label) + '</span>' +
        '<span class="font-mono text-lg font-extrabold leading-none ' + (score ? 'text-ink50' : 'text-soft') + '">' + (score ? escapeHtml(score) : '—') + '</span>' +
      '</div>' +
      '<div class="grid gap-1.5">' + chips + '</div>' +
    '</div>'
  );
}

function gameCard(g, hideDate) {
  var scoreA = (g.pairs && g.pairs.a && g.pairs.a.score) || (g.scores && g.scores.a) || '';
  var scoreB = (g.pairs && g.pairs.b && g.pairs.b.score) || (g.scores && g.scores.b) || '';
  var statusBadge = g.summary.allPaid
    ? '<span class="inline-flex items-center gap-1 rounded-full bg-ok/12 px-2 py-0.5 text-[11px] font-semibold text-ok"><iconify-icon icon="mdi:check-circle" width="13"></iconify-icon>Lunas</span>'
    : '<span class="inline-flex items-center gap-1 rounded-full bg-warn/12 px-2 py-0.5 text-[11px] font-semibold text-warn"><iconify-icon icon="mdi:alert-circle-outline" width="13"></iconify-icon>' + g.summary.unpaidCount + ' belum</span>';

  var head = hideDate
    ? '<div class="flex items-center gap-1.5 text-xs text-muted">' +
        '<iconify-icon icon="game-icons:shuttlecock" width="13" class="text-soft"></iconify-icon>' +
        g.cost.kokCount + ' kok · ' + fmt(g.cost.perPerson) + ' / orang · total ' + fmt(g.cost.total) +
      '</div>'
    : '<div class="flex items-center gap-1.5 font-semibold">' +
        '<iconify-icon icon="mdi:calendar-blank-outline" width="16" class="text-soft"></iconify-icon>' +
        fmtDate(g.date) +
      '</div>' +
      '<div class="mt-0.5 text-xs text-muted">' +
        g.cost.kokCount + ' kok · ' + fmt(g.cost.perPerson) + ' / orang · total ' + fmt(g.cost.total) +
      '</div>';

  return (
    '<article class="rounded-xl2 border border-line bg-elevated p-3.5 shadow-card">' +
      '<div class="mb-3 flex items-start justify-between gap-3">' +
        '<div class="min-w-0">' + head + '</div>' +
        '<div class="flex flex-col items-end gap-1 text-right">' +
          statusBadge +
          '<span class="font-mono text-xs text-soft">' + fmt(g.summary.paidTotal) + ' / ' + fmt(g.cost.total) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="grid items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr]">' +
        matchSide('Pair A', scoreA, playerChip(g, g.players[0]) + playerChip(g, g.players[1])) +
        '<div class="grid place-items-center py-0.5 sm:py-0"><span class="grid h-7 w-7 place-items-center rounded-full border border-line bg-surface text-[10px] font-bold tracking-wider text-soft">VS</span></div>' +
        matchSide('Pair B', scoreB, playerChip(g, g.players[2]) + playerChip(g, g.players[3])) +
      '</div>' +
      (g.notes
        ? '<div class="mt-3 flex items-start gap-1.5 rounded-lg border border-line bg-sunken px-2.5 py-2 text-xs text-muted">' +
            '<iconify-icon icon="mdi:note-text-outline" width="14" class="mt-0.5 shrink-0 text-soft"></iconify-icon>' +
            '<span class="min-w-0">' + escapeHtml(g.notes) + '</span>' +
          '</div>'
        : '') +
    '</article>'
  );
}

function groupDebtItems(items) {
  var map = {};
  var order = [];
  (items || []).forEach(function (it) {
    if (!map[it.date]) {
      map[it.date] = { date: it.date, total: 0, count: 0, koks: 0 };
      order.push(it.date);
    }
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
        '<span class="flex items-center gap-1.5 text-xs font-medium text-muted">' +
          '<iconify-icon icon="mdi:calendar-blank-outline" width="13" class="text-soft"></iconify-icon>' +
          fmtDate(g.date) +
        '</span>' +
        '<span class="font-mono text-sm font-semibold text-warn">' + fmt(g.total) + '</span>' +
      '</div>' +
      '<div class="mt-1 flex items-center gap-3 text-[11px] text-soft">' +
        '<span class="flex items-center gap-1">' +
          '<iconify-icon icon="mdi:badminton" width="13"></iconify-icon>' + g.count + ' main' +
        '</span>' +
        '<span class="flex items-center gap-1">' +
          '<iconify-icon icon="game-icons:shuttlecock" width="12"></iconify-icon>' + g.koks + ' kok' +
        '</span>' +
      '</div>' +
    '</div>'
  );
}

function debtCard(d) {
  var grouped = groupDebtItems(d.items);
  return (
    '<details class="debt rounded-xl2 border border-warn/25 bg-warn/[0.06] p-3.5 animate-rise">' +
      '<summary class="flex select-none items-center justify-between gap-3">' +
        '<div class="flex min-w-0 items-center gap-2.5">' +
          '<div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-warn/15 font-bold text-warn">' +
            escapeHtml((d.name || '?').slice(0, 1).toUpperCase()) +
          '</div>' +
          '<div class="min-w-0">' +
            '<div class="truncate font-semibold">' + escapeHtml(d.name) + '</div>' +
            '<div class="debt-count text-xs text-muted">' + d.items.length + ' game belum lunas</div>' +
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
    '</details>'
  );
}

function renderDebt(debtSummary) {
  var list = $('#debtList');
  var meta = $('#debtMeta');
  if (!list || !meta) return;

  var total = debtSummary.reduce(function (s, d) { return s + d.total; }, 0);
  meta.textContent = debtSummary.length
    ? debtSummary.length + ' orang · ' + fmt(total)
    : 'Semua lunas';

  if (!debtSummary.length) {
    list.innerHTML = emptyState('mdi:emoticon-happy-outline', 'Semua sudah bayar 🎉');
    return;
  }

  list.innerHTML = debtSummary.map(debtCard).join('');
}

function groupGamesByDate(games) {
  var map = {};
  var order = [];
  games.forEach(function (g) {
    if (!map[g.date]) {
      map[g.date] = { date: g.date, games: [], total: 0, paidTotal: 0, unpaidCount: 0 };
      order.push(g.date);
    }
    var grp = map[g.date];
    grp.games.push(g);
    grp.total += g.cost.total;
    grp.paidTotal += g.summary.paidTotal;
    grp.unpaidCount += g.summary.unpaidCount;
  });
  return order.map(function (dt) { return map[dt]; });
}

function historyGroup(grp, open) {
  var allPaid = grp.unpaidCount === 0;
  var statusBadge = allPaid
    ? '<span class="inline-flex items-center gap-1 rounded-full bg-ok/12 px-2 py-0.5 text-[11px] font-semibold text-ok"><iconify-icon icon="mdi:check-circle" width="13"></iconify-icon>Lunas</span>'
    : '<span class="inline-flex items-center gap-1 rounded-full bg-warn/12 px-2 py-0.5 text-[11px] font-semibold text-warn"><iconify-icon icon="mdi:alert-circle-outline" width="13"></iconify-icon>' + grp.unpaidCount + ' belum</span>';

  return (
    '<details class="history overflow-hidden rounded-xl2 border border-line bg-surface shadow-card"' + (open ? ' open' : '') + '>' +
      '<summary class="flex select-none items-center justify-between gap-3 p-3.5">' +
        '<div class="min-w-0">' +
          '<div class="flex items-center gap-1.5 font-semibold">' +
            '<iconify-icon icon="mdi:calendar-blank-outline" width="16" class="text-soft"></iconify-icon>' +
            fmtDate(grp.date) +
          '</div>' +
          '<div class="mt-0.5 flex items-center gap-1.5 text-xs text-muted">' +
            '<iconify-icon icon="mdi:badminton" width="13"></iconify-icon>' + grp.games.length + ' main · total ' + fmt(grp.total) +
          '</div>' +
        '</div>' +
        '<div class="flex shrink-0 items-center gap-2">' +
          statusBadge +
          '<iconify-icon icon="mdi:chevron-down" width="20" class="debt-chevron text-soft"></iconify-icon>' +
        '</div>' +
      '</summary>' +
      '<div class="grid gap-3 border-t border-line p-3.5">' +
        grp.games.map(function (g) { return gameCard(g, true); }).join('') +
      '</div>' +
    '</details>'
  );
}

function renderGames(games) {
  var list = $('#gameList');
  var meta = $('#historyMeta');
  if (!list || !meta) return;

  meta.textContent = games.length ? games.length + ' game' : 'Kosong';

  if (!games.length) {
    list.innerHTML = emptyState('mdi:badminton', 'Belum ada catatan.');
    return;
  }

  var groups = groupGamesByDate(games);
  list.innerHTML = groups.map(function (grp, i) { return historyGroup(grp, i === 0); }).join('');
}

fetch('/api/bootstrap')
  .then(function (res) { return res.json(); })
  .then(function (data) {
    var games = data.games || [];
    var debtSummary = data.debtSummary || [];
    renderStats(games, debtSummary);
    renderDebt(debtSummary);
    renderGames(games);
  })
  .catch(function (err) {
    console.error(err);
    $('#gameList').innerHTML = emptyState('mdi:alert-circle-outline', 'Gagal load data.');
    $('#debtList').innerHTML = emptyState('mdi:alert-circle-outline', 'Gagal load data.');
  });
