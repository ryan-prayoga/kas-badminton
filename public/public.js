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
    '<div class="flex min-w-0 items-center gap-2 rounded-lg border ' + cls + ' px-2.5 py-2">' +
      '<iconify-icon icon="' + (p.paid ? 'mdi:check-circle' : 'mdi:clock-outline') + '" width="15" class="shrink-0"></iconify-icon>' +
      '<span class="min-w-0 truncate text-sm font-medium">' + escapeHtml(p.name) + '</span>' +
    '</div>'
  );
}

function pairGroup(score, showScoreRow, chips) {
  return (
    '<div class="grid min-w-0 gap-1.5">' +
      (showScoreRow
        ? '<div class="min-h-[1.25rem] text-center font-mono text-sm font-bold leading-5 text-ink50">' + escapeHtml(score) + '</div>'
        : '') +
      chips +
    '</div>'
  );
}

function gameCard(g) {
  var scoreA = (g.pairs && g.pairs.a && g.pairs.a.score) || (g.scores && g.scores.a) || '';
  var scoreB = (g.pairs && g.pairs.b && g.pairs.b.score) || (g.scores && g.scores.b) || '';
  var statusBadge = g.summary.allPaid
    ? '<span class="inline-flex items-center gap-1 rounded-full bg-ok/12 px-2 py-0.5 text-[11px] font-semibold text-ok"><iconify-icon icon="mdi:check-circle" width="13"></iconify-icon>Lunas</span>'
    : '<span class="inline-flex items-center gap-1 rounded-full bg-warn/12 px-2 py-0.5 text-[11px] font-semibold text-warn"><iconify-icon icon="mdi:alert-circle-outline" width="13"></iconify-icon>' + g.summary.unpaidCount + ' belum</span>';

  return (
    '<div class="rounded-xl2 bg-elevated p-3.5">' +
      '<div class="flex items-center justify-between gap-3">' +
        '<div class="flex min-w-0 items-center gap-1.5 text-xs text-muted">' +
          '<iconify-icon icon="game-icons:shuttlecock" width="13" class="shrink-0 text-soft"></iconify-icon>' +
          '<span class="truncate">' + g.cost.kokCount + ' kok · ' + fmt(g.cost.perPerson) + '/org</span>' +
        '</div>' +
        '<div class="shrink-0">' + statusBadge + '</div>' +
      '</div>' +
      (function () {
        var hasScore = !!(scoreA || scoreB);
        return (
          '<div class="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-1.5 sm:gap-x-2.5">' +
            pairGroup(scoreA, hasScore, playerChip(g, g.players[0]) + playerChip(g, g.players[1])) +
            '<div class="text-center text-[10px] font-bold uppercase tracking-wider text-soft">vs</div>' +
            pairGroup(scoreB, hasScore, playerChip(g, g.players[2]) + playerChip(g, g.players[3])) +
          '</div>'
        );
      })() +
      (g.notes
        ? '<div class="mt-2.5 flex items-start gap-1.5 rounded-lg bg-sunken px-2.5 py-2 text-xs text-muted">' +
            '<iconify-icon icon="mdi:note-text-outline" width="14" class="mt-0.5 shrink-0 text-soft"></iconify-icon>' +
            '<span class="min-w-0">' + escapeHtml(g.notes) + '</span>' +
          '</div>'
        : '') +
    '</div>'
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
        '<span class="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted">' +
          '<iconify-icon icon="mdi:calendar-blank-outline" width="13" class="shrink-0 text-soft"></iconify-icon>' +
          '<span class="truncate">' + fmtDate(g.date) + '</span>' +
        '</span>' +
        '<span class="shrink-0 font-mono text-sm font-semibold text-warn">' + fmt(g.total) + '</span>' +
      '</div>' +
      '<div class="mt-1 flex items-center gap-3 text-[11px] text-soft">' +
        '<span class="flex items-center gap-1">' +
          '<iconify-icon icon="mdi:badminton" width="13"></iconify-icon>' + g.count + ' main' +
        '</span>' +
        '<span class="flex items-center gap-1">' +
          '<iconify-icon icon="game-icons:shuttlecock" width="12"></iconify-icon>' + g.koks + ' kok' +
        '</span>' +
        dateBadge(g.date) +
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
            '<iconify-icon icon="mdi:calendar-blank-outline" width="16" class="text-soft shrink-0"></iconify-icon>' +
            '<span class="truncate">' + fmtDate(grp.date) + '</span>' +
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
        grp.games.map(function (g) { return gameCard(g); }).join('') +
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

var lastUpdatedAt = null;

function updateLastUpdatedLabel() {
  var el = $('#lastUpdated');
  if (!el || !lastUpdatedAt) return;
  el.textContent = 'Diperbarui ' + humanAgo(Date.now() - lastUpdatedAt);
}

function loadData() {
  var btn = $('#refreshBtn');
  if (btn) btn.classList.add('animate-spin');
  return fetch('/api/bootstrap')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var games = data.games || [];
      var debtSummary = data.debtSummary || [];
      renderStats(games, debtSummary);
      renderDebt(debtSummary);
      renderGames(games);
      lastUpdatedAt = Date.now();
      updateLastUpdatedLabel();
    })
    .catch(function (err) {
      console.error(err);
      $('#gameList').innerHTML = emptyState('mdi:alert-circle-outline', 'Gagal load data.');
      $('#debtList').innerHTML = emptyState('mdi:alert-circle-outline', 'Gagal load data.');
    })
    .finally(function () {
      if (btn) btn.classList.remove('animate-spin');
    });
}

var refreshBtn = $('#refreshBtn');
if (refreshBtn) refreshBtn.onclick = loadData;
setInterval(updateLastUpdatedLabel, 30000);
loadData();
