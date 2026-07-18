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

function renderDebt(debtSummary) {
  var list = $('#debtList');
  var meta = $('#debtMeta');
  if (!list || !meta) return;

  var total = debtSummary.reduce(function (s, d) { return s + d.total; }, 0);
  meta.textContent = debtSummary.length
    ? debtSummary.length + ' orang · total ' + fmt(total)
    : 'Semua lunas';

  if (!debtSummary.length) {
    list.className = 'debt-list empty-state';
    list.textContent = 'Semua sudah bayar.';
    return;
  }

  list.className = 'debt-list';
  list.innerHTML = debtSummary.map(function (d) {
    return (
      '<div class="debt-card">' +
        '<div class="debt-top">' +
          '<div><strong>' + escapeHtml(d.name) + '</strong>' +
          '<div class="meta">' + d.items.length + ' game belum lunas</div></div>' +
          '<div class="amount">' + fmt(d.total) + '</div>' +
        '</div>' +
        '<div class="debt-items">' +
          d.items.map(function (it) {
            return '<div>' + escapeHtml(it.date) + ' · ' + fmt(it.amount) +
              (it.score ? ' · ' + escapeHtml(it.score) : '') + '</div>';
          }).join('') +
        '</div>' +
      '</div>'
    );
  }).join('');
}

function playerChip(g, p) {
  if (!p) p = { name: '—', paid: false };
  return (
    '<div class="chip ' + (p.paid ? 'paid' : 'unpaid') + '">' +
      '<span>' + escapeHtml(p.name) + '</span>' +
      '<span class="amount">' + fmt(g.cost.perPerson) + '</span>' +
      '<span>' + (p.paid ? 'lunas' : 'belum') + '</span>' +
    '</div>'
  );
}

function renderGames(games) {
  var list = $('#gameList');
  var meta = $('#historyMeta');
  if (!list || !meta) return;

  meta.textContent = games.length ? games.length + ' game' : 'Kosong';

  if (!games.length) {
    list.className = 'game-list empty-state';
    list.textContent = 'Belum ada catatan.';
    return;
  }

  list.className = 'game-list';
  list.innerHTML = games.map(function (g) {
    var scoreA = (g.pairs && g.pairs.a && g.pairs.a.score) || (g.scores && g.scores.a) || '';
    var scoreB = (g.pairs && g.pairs.b && g.pairs.b.score) || (g.scores && g.scores.b) || '';
    var kokDetail = (g.koks || []).map(function (k, i) {
      return 'k' + (i + 1) + ':' + fmt(k.pricePerPerson);
    }).join(' · ');

    return (
      '<article class="game-card">' +
        '<div class="game-top">' +
          '<div><strong>' + escapeHtml(g.date) + '</strong>' +
            '<div class="meta">' +
              g.cost.kokCount + ' kok · ' + fmt(g.cost.perPerson) + ' / orang · total ' + fmt(g.cost.total) +
              (g.notes ? '<br>' + escapeHtml(g.notes) : '') +
              (kokDetail ? '<br><span style="color:var(--soft)">' + escapeHtml(kokDetail) + '</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="meta" style="text-align:right">' +
            (g.summary.allPaid
              ? '<span style="color:var(--ok)">Lunas</span>'
              : '<span style="color:var(--warn)">' + g.summary.unpaidCount + ' belum</span>') +
            '<div class="amount">' + fmt(g.summary.paidTotal) + ' / ' + fmt(g.cost.total) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="match-board">' +
          '<div class="match-side">' +
            '<div class="match-side-head">' +
              '<span class="pair-badge">Pair A</span>' +
              '<span class="match-score ' + (scoreA ? '' : 'empty') + '">' + (scoreA ? escapeHtml(scoreA) : '—') + '</span>' +
            '</div>' +
            '<div class="chip-col">' +
              playerChip(g, g.players[0]) +
              playerChip(g, g.players[1]) +
            '</div>' +
          '</div>' +
          '<div class="vs-inline" aria-hidden="true">VS</div>' +
          '<div class="match-side">' +
            '<div class="match-side-head">' +
              '<span class="pair-badge">Pair B</span>' +
              '<span class="match-score ' + (scoreB ? '' : 'empty') + '">' + (scoreB ? escapeHtml(scoreB) : '—') + '</span>' +
            '</div>' +
            '<div class="chip-col">' +
              playerChip(g, g.players[2]) +
              playerChip(g, g.players[3]) +
            '</div>' +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }).join('');
}

fetch('/api/bootstrap')
  .then(function (res) { return res.json(); })
  .then(function (data) {
    renderDebt(data.debtSummary || []);
    renderGames(data.games || []);
  })
  .catch(function (err) {
    console.error(err);
    $('#gameList').textContent = 'Gagal load data.';
    $('#debtList').textContent = 'Gagal load data.';
  });
