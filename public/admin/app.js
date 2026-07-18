const state = {
  settings: { defaultPricePerPerson: 3000 },
  players: [],
  games: [],
  debtSummary: [],
  formKoks: [{ pricePerPerson: 3000 }],
  edit: null,
};

function $(sel, root) {
  return (root || document).querySelector(sel);
}
function $$(sel, root) {
  return Array.prototype.slice.call((root || document).querySelectorAll(sel));
}

function fmt(n) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function todayLocal() {
  var d = new Date();
  var off = d.getTimezoneOffset();
  var local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

function escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function api(path, options) {
  options = options || {};
  var headers = { 'Content-Type': 'application/json' };
  if (options.headers) {
    for (var k in options.headers) headers[k] = options.headers[k];
  }
  return fetch(path, {
    method: options.method || 'GET',
    headers: headers,
    body: options.body,
  }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (res.status === 401 && path !== '/api/login') {
        showLock();
        throw new Error(data.error || 'Sesi habis, login lagi');
      }
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return data;
    });
  });
}

// --- Lockscreen (PIN gate) ---
var pinBuffer = '';

function updateLockClock() {
  var el = $('#lockClock');
  if (!el) return;
  var d = new Date();
  var hh = String(d.getHours()).padStart(2, '0');
  var mm = String(d.getMinutes()).padStart(2, '0');
  el.textContent = hh + ':' + mm;
}

function renderLockDots() {
  var dots = $$('#lockDots .dot');
  dots.forEach(function (dot, i) {
    dot.classList.toggle('filled', i < pinBuffer.length);
  });
}

function showLock(errMsg) {
  pinBuffer = '';
  renderLockDots();
  $('#appRoot').hidden = true;
  $('#lockScreen').hidden = false;
  var errEl = $('#lockError');
  if (errEl) errEl.textContent = errMsg || ' ';
  if (errMsg) {
    var dots = $('#lockDots');
    dots.classList.remove('shake');
    void dots.offsetWidth;
    dots.classList.add('shake');
  }
}

function showApp() {
  $('#lockScreen').hidden = true;
  $('#appRoot').hidden = false;
}

function submitPin() {
  var pin = pinBuffer;
  pinBuffer = '';
  api('/api/login', {
    method: 'POST',
    body: JSON.stringify({ pin: pin }),
  }).then(function () {
    showApp();
    startApp();
  }).catch(function () {
    renderLockDots();
    showLock('PIN salah');
  });
}

function wireLock() {
  updateLockClock();
  setInterval(updateLockClock, 15000);

  $('#lockKeypad').onclick = function (e) {
    var btn = e.target.closest('button[data-key]');
    if (!btn) return;
    var key = btn.getAttribute('data-key');
    if (key === 'back') {
      pinBuffer = pinBuffer.slice(0, -1);
    } else if (pinBuffer.length < 6) {
      pinBuffer += key;
    }
    renderLockDots();
    var errEl = $('#lockError');
    if (errEl) errEl.textContent = ' ';
    if (pinBuffer.length === 6) submitPin();
  };

  document.addEventListener('keydown', function (e) {
    if ($('#lockScreen').hidden) return;
    if (/^[0-9]$/.test(e.key) && pinBuffer.length < 6) {
      pinBuffer += e.key;
      renderLockDots();
      if (pinBuffer.length === 6) submitPin();
    } else if (e.key === 'Backspace') {
      pinBuffer = pinBuffer.slice(0, -1);
      renderLockDots();
    }
  });

  var logoutBtn = $('#logoutBtn');
  if (logoutBtn) {
    logoutBtn.onclick = function () {
      api('/api/logout', { method: 'POST' }).finally(function () {
        location.reload();
      });
    };
  }
}

function ensureDatalist() {
  var dl = $('#player-suggest');
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = 'player-suggest';
    document.body.appendChild(dl);
  }
  dl.innerHTML = state.players.map(function (p) {
    return '<option value="' + escapeAttr(p) + '"></option>';
  }).join('');
}

function pairCardHtml(opts) {
  var pairKey = opts.pairKey;
  var label = opts.label;
  var p1Name = opts.p1Name || '';
  var p2Name = opts.p2Name || '';
  var score = opts.score || '';
  var namePrefix = opts.namePrefix || 'player';
  var i1 = pairKey === 'a' ? 0 : 2;
  var i2 = pairKey === 'a' ? 1 : 3;
  return (
    '<div class="pair-card" data-pair="' + pairKey + '">' +
      '<div class="pair-head">' +
        '<div class="pair-badge">' + escapeHtml(label) + '</div>' +
        '<div class="score-field">' +
          '<span>Skor</span>' +
          '<input type="text" inputmode="numeric" name="score' + pairKey.toUpperCase() + '" value="' + escapeAttr(score) + '" placeholder="21" maxlength="20" autocomplete="off" />' +
        '</div>' +
      '</div>' +
      '<div class="pair-players">' +
        '<div class="player-field">' +
          '<div class="label">Pemain 1</div>' +
          '<input type="text" name="' + namePrefix + i1 + '" list="player-suggest" value="' + escapeAttr(p1Name) + '" placeholder="Nama" autocomplete="off" required maxlength="40" />' +
        '</div>' +
        '<div class="player-field">' +
          '<div class="label">Pemain 2</div>' +
          '<input type="text" name="' + namePrefix + i2 + '" list="player-suggest" value="' + escapeAttr(p2Name) + '" placeholder="Nama" autocomplete="off" required maxlength="40" />' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function readPairsFrom(container, namePrefix) {
  namePrefix = namePrefix || 'player';
  var names = [0, 1, 2, 3].map(function (i) {
    var el = container.querySelector('input[name="' + namePrefix + i + '"]');
    return el ? el.value.trim() : '';
  });
  var scoreAEl = container.querySelector('input[name="scoreA"]');
  var scoreBEl = container.querySelector('input[name="scoreB"]');
  return {
    pairs: {
      a: [names[0], names[1]],
      b: [names[2], names[3]],
    },
    scores: {
      a: scoreAEl ? scoreAEl.value.trim() : '',
      b: scoreBEl ? scoreBEl.value.trim() : '',
    },
    names: names,
  };
}

function updateFormCostHint() {
  var el = $('#formCostHint');
  if (!el) return;
  var totalPer = state.formKoks.reduce(function (s, k) {
    return s + Number(k.pricePerPerson || 0);
  }, 0);
  el.textContent = state.formKoks.length + ' kok · ' + fmt(totalPer) + ' / orang · total ' + fmt(totalPer * 4);
}

function renderFormKoks() {
  var list = $('#kokList');
  if (!list) return;
  list.innerHTML = state.formKoks.map(function (k, i) {
    return (
      '<div class="kok-row" data-i="' + i + '">' +
        '<div class="tag">Kok ' + (i + 1) + '</div>' +
        '<input type="number" inputmode="numeric" min="0" step="500" value="' + Number(k.pricePerPerson || 0) + '" data-role="price" />' +
        '<button type="button" class="btn ghost sm" data-role="remove"' + (state.formKoks.length === 1 ? ' disabled' : '') + '>Hapus</button>' +
      '</div>'
    );
  }).join('');
  updateFormCostHint();
}

function bindFormKoks() {
  var list = $('#kokList');
  if (!list) return;
  list.onclick = function (e) {
    var btn = e.target.closest('[data-role="remove"]');
    if (!btn) return;
    var row = btn.closest('.kok-row');
    if (!row) return;
    var i = Number(row.getAttribute('data-i'));
    if (state.formKoks.length <= 1) return;
    state.formKoks.splice(i, 1);
    renderFormKoks();
  };
  list.oninput = function (e) {
    if (!e.target || e.target.getAttribute('data-role') !== 'price') return;
    var row = e.target.closest('.kok-row');
    if (!row) return;
    var i = Number(row.getAttribute('data-i'));
    state.formKoks[i].pricePerPerson = Number(e.target.value || 0);
    updateFormCostHint();
  };
}

function renderDebt() {
  var list = $('#debtList');
  var meta = $('#debtMeta');
  if (!list || !meta) return;

  var total = state.debtSummary.reduce(function (s, d) { return s + d.total; }, 0);
  meta.textContent = state.debtSummary.length
    ? state.debtSummary.length + ' orang · total ' + fmt(total)
    : 'Semua lunas';

  if (!state.debtSummary.length) {
    list.className = 'debt-list empty-state';
    list.textContent = 'Semua sudah bayar.';
    return;
  }

  list.className = 'debt-list';
  list.innerHTML = state.debtSummary.map(function (d) {
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

function playerChip(g, p, index) {
  if (!p) p = { name: '—', paid: false };
  return (
    '<div class="chip ' + (p.paid ? 'paid' : 'unpaid') + '">' +
      '<span>' + escapeHtml(p.name) + '</span>' +
      '<span class="amount">' + fmt(g.cost.perPerson) + '</span>' +
      '<button type="button" data-action="toggle-paid" data-id="' + g.id + '" data-index="' + index + '">' +
        (p.paid ? 'batal' : 'bayar') +
      '</button>' +
    '</div>'
  );
}

function renderGames() {
  var list = $('#gameList');
  var meta = $('#historyMeta');
  if (!list || !meta) return;

  meta.textContent = state.games.length ? state.games.length + ' game' : 'Kosong';

  if (!state.games.length) {
    list.className = 'game-list empty-state';
    list.textContent = 'Belum ada catatan.';
    return;
  }

  list.className = 'game-list';
  list.innerHTML = state.games.map(function (g) {
    var scoreA = (g.pairs && g.pairs.a && g.pairs.a.score) || (g.scores && g.scores.a) || '';
    var scoreB = (g.pairs && g.pairs.b && g.pairs.b.score) || (g.scores && g.scores.b) || '';
    var kokDetail = (g.koks || []).map(function (k, i) {
      return 'k' + (i + 1) + ':' + fmt(k.pricePerPerson);
    }).join(' · ');

    return (
      '<article class="game-card" data-id="' + g.id + '">' +
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
              playerChip(g, g.players[0], 0) +
              playerChip(g, g.players[1], 1) +
            '</div>' +
          '</div>' +
          '<div class="vs-inline" aria-hidden="true">VS</div>' +
          '<div class="match-side">' +
            '<div class="match-side-head">' +
              '<span class="pair-badge">Pair B</span>' +
              '<span class="match-score ' + (scoreB ? '' : 'empty') + '">' + (scoreB ? escapeHtml(scoreB) : '—') + '</span>' +
            '</div>' +
            '<div class="chip-col">' +
              playerChip(g, g.players[2], 2) +
              playerChip(g, g.players[3], 3) +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="actions">' +
          '<button class="btn sm ' + (g.summary.allPaid ? 'ghost' : 'ok') + '" data-action="mark-all" data-id="' + g.id + '" data-paid="' + (g.summary.allPaid ? 'false' : 'true') + '">' +
            (g.summary.allPaid ? 'Tandai semua belum' : 'Tandai semua bayar') +
          '</button>' +
          '<button class="btn sm ghost" data-action="add-kok" data-id="' + g.id + '">+ Kok</button>' +
          '<button class="btn sm ghost" data-action="edit" data-id="' + g.id + '">Edit</button>' +
        '</div>' +
      '</article>'
    );
  }).join('');
}

function refresh() {
  return api('/api/bootstrap').then(function (data) {
    state.settings = data.settings;
    state.players = data.players || [];
    state.games = data.games || [];
    state.debtSummary = data.debtSummary || [];
    var priceEl = $('#defaultPrice');
    if (priceEl) priceEl.value = data.settings.defaultPricePerPerson;
    ensureDatalist();
    renderDebt();
    renderGames();
  });
}

function openEdit(game) {
  state.edit = JSON.parse(JSON.stringify(game));
  $('#editId').value = game.id;
  $('#editDate').value = game.date;
  $('#editNotes').value = game.notes || '';

  var scores = game.scores || {};
  var root = $('#editPairs');
  root.innerHTML = [
    pairCardHtml({
      pairKey: 'a',
      label: 'Pair A',
      p1Name: game.players[0] && game.players[0].name,
      p2Name: game.players[1] && game.players[1].name,
      score: scores.a || (game.pairs && game.pairs.a && game.pairs.a.score) || '',
      namePrefix: 'editPlayer',
    }),
    '<div class="vs-divider">vs</div>',
    pairCardHtml({
      pairKey: 'b',
      label: 'Pair B',
      p1Name: game.players[2] && game.players[2].name,
      p2Name: game.players[3] && game.players[3].name,
      score: scores.b || (game.pairs && game.pairs.b && game.pairs.b.score) || '',
      namePrefix: 'editPlayer',
    }),
  ].join('');

  renderEditKoks();
  $('#editDialog').showModal();
}

function renderEditKoks() {
  var list = $('#editKoks');
  list.innerHTML =
    '<div class="section-label row-between">' +
      '<span>Kok (snapshot)</span>' +
      '<button type="button" class="btn ghost sm" id="editAddKok">+ Kok</button>' +
    '</div>' +
    state.edit.koks.map(function (k, i) {
      return (
        '<div class="kok-row" data-i="' + i + '">' +
          '<div class="tag">Kok ' + (i + 1) + '</div>' +
          '<input type="number" inputmode="numeric" min="0" step="500" value="' + Number(k.pricePerPerson || 0) + '" data-role="price" />' +
          '<button type="button" class="btn ghost sm" data-role="remove"' + (state.edit.koks.length === 1 ? ' disabled' : '') + '>Hapus</button>' +
        '</div>'
      );
    }).join('');

  $('#editAddKok').onclick = function () {
    state.edit.koks.push({
      id: null,
      pricePerPerson: state.settings.defaultPricePerPerson,
    });
    renderEditKoks();
  };

  list.onclick = function (e) {
    var btn = e.target.closest('[data-role="remove"]');
    if (!btn) return;
    var row = btn.closest('.kok-row');
    if (!row) return;
    if (state.edit.koks.length <= 1) return;
    state.edit.koks.splice(Number(row.getAttribute('data-i')), 1);
    renderEditKoks();
  };

  list.oninput = function (e) {
    if (!e.target || e.target.getAttribute('data-role') !== 'price') return;
    var row = e.target.closest('.kok-row');
    if (!row) return;
    state.edit.koks[Number(row.getAttribute('data-i'))].pricePerPerson = Number(e.target.value || 0);
  };
}

function clearFormPairs() {
  [0, 1, 2, 3].forEach(function (i) {
    var el = $('#gameForm input[name="player' + i + '"]');
    if (el) el.value = '';
  });
  var sa = $('#gameForm input[name="scoreA"]');
  var sb = $('#gameForm input[name="scoreB"]');
  if (sa) sa.value = '';
  if (sb) sb.value = '';
}

function wire() {
  // keep static pair HTML — only sync kok defaults
  state.formKoks = [{ pricePerPerson: state.settings.defaultPricePerPerson || 3000 }];
  renderFormKoks();
  bindFormKoks();

  $('#addKok').onclick = function () {
    state.formKoks.push({
      pricePerPerson: Number($('#defaultPrice').value) || state.settings.defaultPricePerPerson || 3000,
    });
    renderFormKoks();
  };

  $('#savePrice').onclick = function () {
    var defaultPricePerPerson = Number($('#defaultPrice').value);
    api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ defaultPricePerPerson: defaultPricePerPerson }),
    }).then(function (data) {
      state.settings = data.settings;
      alert('Default harga disimpan. Catatan lama tetap pakai harga snapshot-nya.');
    }).catch(function (err) {
      alert(err.message);
    });
  };

  $('#gameForm').onsubmit = function (e) {
    e.preventDefault();
    var parsed = readPairsFrom($('#gameForm'));
    api('/api/games', {
      method: 'POST',
      body: JSON.stringify({
        date: $('#date').value,
        notes: $('#notes').value,
        pairs: parsed.pairs,
        scores: parsed.scores,
        koks: state.formKoks.map(function (k) {
          return { pricePerPerson: Number(k.pricePerPerson) || 0 };
        }),
      }),
    }).then(function () {
      $('#notes').value = '';
      clearFormPairs();
      state.formKoks = [{ pricePerPerson: Number($('#defaultPrice').value) || 3000 }];
      renderFormKoks();
      return refresh();
    }).catch(function (err) {
      alert(err.message);
    });
  };

  $('#gameList').onclick = function (e) {
    var btn = e.target.closest('button[data-action]');
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    var action = btn.getAttribute('data-action');
    var p;

    if (action === 'toggle-paid') {
      var game = state.games.filter(function (g) { return g.id === id; })[0];
      var index = Number(btn.getAttribute('data-index'));
      var paid = !(game.players[index] && game.players[index].paid);
      p = api('/api/games/' + id + '/players/' + index + '/paid', {
        method: 'PATCH',
        body: JSON.stringify({ paid: paid }),
      });
    } else if (action === 'mark-all') {
      p = api('/api/games/' + id + '/mark-all-paid', {
        method: 'POST',
        body: JSON.stringify({ paid: btn.getAttribute('data-paid') === 'true' }),
      });
    } else if (action === 'add-kok') {
      p = api('/api/games/' + id + '/koks', {
        method: 'POST',
        body: JSON.stringify({ pricePerPerson: Number($('#defaultPrice').value) }),
      });
    } else if (action === 'edit') {
      openEdit(state.games.filter(function (g) { return g.id === id; })[0]);
      return;
    }

    if (p) {
      p.then(function () { return refresh(); }).catch(function (err) {
        alert(err.message);
      });
    }
  };

  $('#cancelEdit').onclick = function () {
    $('#editDialog').close();
  };

  $('#deleteGame').onclick = function () {
    if (!confirm('Hapus game ini?')) return;
    api('/api/games/' + $('#editId').value, { method: 'DELETE' })
      .then(function () {
        $('#editDialog').close();
        return refresh();
      })
      .catch(function (err) { alert(err.message); });
  };

  $('#editForm').onsubmit = function (e) {
    e.preventDefault();
    var id = $('#editId').value;
    var parsed = readPairsFrom($('#editForm'), 'editPlayer');
    var players = parsed.names.map(function (name, idx) {
      return {
        name: name,
        paid: !!(state.edit.players[idx] && state.edit.players[idx].paid),
      };
    });
    api('/api/games/' + id, {
      method: 'PATCH',
      body: JSON.stringify({
        date: $('#editDate').value,
        notes: $('#editNotes').value,
        pairs: {
          a: players.slice(0, 2),
          b: players.slice(2, 4),
        },
        scores: parsed.scores,
        koks: state.edit.koks.map(function (k) {
          return {
            id: k.id || undefined,
            pricePerPerson: Number(k.pricePerPerson) || 0,
          };
        }),
      }),
    }).then(function () {
      $('#editDialog').close();
      return refresh();
    }).catch(function (err) {
      alert(err.message);
    });
  };
}

var appStarted = false;

function startApp() {
  if (appStarted) return;
  appStarted = true;
  try {
    var dateEl = $('#date');
    if (dateEl) dateEl.value = todayLocal();
    wire();
    refresh()
      .then(function () {
        if (state.formKoks.length === 1) {
          state.formKoks[0].pricePerPerson = state.settings.defaultPricePerPerson;
          renderFormKoks();
        }
      })
      .catch(function (err) {
        console.error(err);
        alert('Gagal load data: ' + err.message);
      });
  } catch (err) {
    console.error(err);
    alert('Gagal init UI: ' + err.message);
  }
}

(function init() {
  wireLock();
  fetch('/api/me')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.isAdmin) {
        showApp();
        startApp();
      } else {
        showLock();
      }
    })
    .catch(function () {
      showLock();
    });
})();
