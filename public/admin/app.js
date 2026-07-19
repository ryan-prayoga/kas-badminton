const state = {
  settings: { defaultPricePerPerson: 3000 },
  players: [],
  kokTypes: [],
  games: [],
  debtSummary: [],
  formKoks: [{ typeId: null, typeName: null, pricePerPerson: 3000 }],
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

function emptyState(icon, text) {
  return (
    '<div class="grid place-items-center gap-1.5 rounded-xl border border-dashed border-line bg-sunken py-7 text-soft">' +
      '<iconify-icon icon="' + icon + '" width="26"></iconify-icon>' +
      '<span class="text-sm">' + escapeHtml(text) + '</span>' +
    '</div>'
  );
}

// --- Toast + confirm dialog (replace alert()/confirm()) ---
function toast(message, type) {
  type = type === 'success' ? 'success' : 'error';
  var stack = $('#toastStack');
  if (!stack) return;
  var icon = type === 'success' ? 'mdi:check-circle' : 'mdi:alert-circle-outline';
  var cls = type === 'success' ? 'border-ok/30 bg-ok/10 text-ok' : 'border-danger/30 bg-danger/10 text-danger';
  var el = document.createElement('div');
  el.className = 'pointer-events-auto flex items-center gap-2 rounded-xl border ' + cls + ' px-3.5 py-3 text-sm font-medium shadow-card animate-rise transition duration-300';
  el.innerHTML = '<iconify-icon icon="' + icon + '" width="18" class="shrink-0"></iconify-icon><span class="min-w-0 flex-1">' + escapeHtml(message) + '</span>';
  stack.appendChild(el);
  setTimeout(function () {
    el.classList.add('opacity-0', '-translate-y-1');
    setTimeout(function () { el.remove(); }, 300);
  }, 2800);
}

function askConfirm(message) {
  return new Promise(function (resolve) {
    var dlg = $('#confirmDialog');
    $('#confirmMessage').textContent = message;
    function cleanup(result) {
      dlg.close();
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    var okBtn = $('#confirmOk');
    var cancelBtn = $('#confirmCancel');
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    dlg.showModal();
  });
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
    var on = i < pinBuffer.length;
    dot.classList.toggle('bg-brand', on);
    dot.classList.toggle('border-brand', on);
    dot.classList.toggle('scale-110', on);
    dot.classList.toggle('border-soft', !on);
  });
}

function showLock(errMsg) {
  pinBuffer = '';
  renderLockDots();
  $('#appRoot').hidden = true;
  $('#fabAdd').hidden = true;
  $('#lockScreen').hidden = false;
  var errEl = $('#lockError');
  if (errEl) errEl.textContent = errMsg || ' ';
  if (errMsg) {
    var dots = $('#lockDots');
    dots.classList.remove('animate-shake');
    void dots.offsetWidth;
    dots.classList.add('animate-shake');
  }
}

function showApp() {
  $('#lockScreen').hidden = true;
  $('#appRoot').hidden = false;
  $('#fabAdd').hidden = false;
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
    if (errEl) errEl.textContent = ' ';
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

var FIELD_CLS = 'w-full rounded-xl border border-line bg-ink px-3 py-2.5 text-base outline-none transition focus:border-brand/60';

function pairCardHtml(opts) {
  var pairKey = opts.pairKey;
  var label = opts.label;
  var p1Name = opts.p1Name || '';
  var p2Name = opts.p2Name || '';
  var score = opts.score || '';
  var namePrefix = opts.namePrefix || 'player';
  var i1 = pairKey === 'a' ? 0 : 2;
  var i2 = pairKey === 'a' ? 1 : 3;
  var badge = pairKey === 'a' ? 'bg-brand/10 text-brand' : 'bg-ok/10 text-ok';
  return (
    '<div class="rounded-xl border border-line bg-elevated p-3" data-pair="' + pairKey + '">' +
      '<div class="mb-3 flex items-center justify-between gap-2">' +
        '<span class="inline-flex items-center rounded-md ' + badge + ' px-2 py-1 text-xs font-bold uppercase tracking-wide">' + escapeHtml(label) + '</span>' +
        '<div class="flex items-center gap-2">' +
          '<span class="text-xs text-soft">Skor</span>' +
          '<input type="text" inputmode="numeric" name="score' + pairKey.toUpperCase() + '" value="' + escapeAttr(score) + '" placeholder="21" maxlength="20" autocomplete="off" class="w-16 rounded-lg border border-line bg-ink px-2 py-2 text-center font-mono text-base outline-none transition focus:border-brand/60" />' +
        '</div>' +
      '</div>' +
      '<div class="grid gap-2 sm:grid-cols-2">' +
        '<input type="text" name="' + namePrefix + i1 + '" list="player-suggest" value="' + escapeAttr(p1Name) + '" placeholder="Pemain 1" autocomplete="off" required maxlength="40" class="' + FIELD_CLS + '" />' +
        '<input type="text" name="' + namePrefix + i2 + '" list="player-suggest" value="' + escapeAttr(p2Name) + '" placeholder="Pemain 2" autocomplete="off" required maxlength="40" class="' + FIELD_CLS + '" />' +
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

function activeKokTypes() {
  return (state.kokTypes || []).filter(function (t) {
    return t.active !== false;
  });
}

function defaultKokEntry() {
  var types = activeKokTypes();
  if (types.length) {
    return {
      typeId: types[0].id,
      typeName: types[0].name,
      pricePerPerson: Number(types[0].pricePerPerson) || 0,
    };
  }
  return {
    typeId: null,
    typeName: null,
    pricePerPerson: Number(state.settings.defaultPricePerPerson) || 3000,
  };
}

function typeOptionsHtml(selectedId, snapshotName) {
  var types = activeKokTypes();
  var opts =
    '<option value="">' +
    (types.length ? '— Manual —' : 'Manual (isi harga)') +
    '</option>';
  types.forEach(function (t) {
    var stock = Number(t.stock) || 0;
    opts +=
      '<option value="' +
      escapeAttr(t.id) +
      '"' +
      (selectedId === t.id ? ' selected' : '') +
      '>' +
      escapeHtml(t.name) +
      ' · ' +
      fmt(t.pricePerPerson) +
      ' · stok ' +
      stock +
      '</option>';
  });
  if (selectedId && !types.some(function (t) { return t.id === selectedId; }) && snapshotName) {
    opts +=
      '<option value="' +
      escapeAttr(selectedId) +
      '" selected>' +
      escapeHtml(snapshotName) +
      ' (lama)</option>';
  }
  return opts;
}

function kokRowHtml(i, kok, disableRemove) {
  kok = kok || {};
  return (
    '<div class="grid gap-2 rounded-xl border border-line bg-sunken p-2" data-i="' + i + '">' +
      '<div class="flex items-center gap-2">' +
        '<span class="w-12 shrink-0 pl-1 font-mono text-xs text-soft">Kok ' + (i + 1) + '</span>' +
        '<select data-role="type" class="min-w-0 flex-1 rounded-lg border border-line bg-ink px-2 py-2 text-sm outline-none">' +
          typeOptionsHtml(kok.typeId, kok.typeName) +
        '</select>' +
        '<button type="button" data-role="remove"' + (disableRemove ? ' disabled' : '') + ' class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-soft transition active:scale-95 hover:text-danger disabled:opacity-40">' +
          '<iconify-icon icon="mdi:close" width="16"></iconify-icon>' +
        '</button>' +
      '</div>' +
      '<div class="flex items-center gap-1.5 rounded-lg border border-line bg-ink px-2.5">' +
        '<span class="font-mono text-xs text-soft">Rp</span>' +
        '<input type="number" inputmode="numeric" min="0" step="500" value="' + Number(kok.pricePerPerson || 0) + '" data-role="price" class="min-w-0 flex-1 bg-transparent py-2 text-base outline-none" />' +
        '<span class="shrink-0 text-[11px] text-soft">/org</span>' +
      '</div>' +
    '</div>'
  );
}

function updateFormCostHint() {
  var el = $('#formCostHint');
  if (!el) return;
  var totalPer = state.formKoks.reduce(function (s, k) {
    return s + Number(k.pricePerPerson || 0);
  }, 0);
  el.textContent = state.formKoks.length + ' kok · ' + fmt(totalPer) + ' / orang · total ' + fmt(totalPer * 4);
}

function applyTypeToKok(kok, typeId) {
  if (!typeId) {
    kok.typeId = null;
    kok.typeName = null;
    return;
  }
  var t = (state.kokTypes || []).filter(function (x) { return x.id === typeId; })[0];
  if (t) {
    kok.typeId = t.id;
    kok.typeName = t.name;
    kok.pricePerPerson = Number(t.pricePerPerson) || 0;
  } else {
    kok.typeId = typeId;
  }
}

function renderFormKoks() {
  var list = $('#kokList');
  if (!list) return;
  list.innerHTML = state.formKoks.map(function (k, i) {
    return kokRowHtml(i, k, state.formKoks.length === 1);
  }).join('');
  updateFormCostHint();
}

function bindFormKoks() {
  var list = $('#kokList');
  if (!list) return;
  list.onclick = function (e) {
    var btn = e.target.closest('[data-role="remove"]');
    if (!btn) return;
    var row = btn.closest('[data-i]');
    if (!row) return;
    var i = Number(row.getAttribute('data-i'));
    if (state.formKoks.length <= 1) return;
    state.formKoks.splice(i, 1);
    renderFormKoks();
  };
  list.onchange = function (e) {
    if (!e.target || e.target.getAttribute('data-role') !== 'type') return;
    var row = e.target.closest('[data-i]');
    if (!row) return;
    var i = Number(row.getAttribute('data-i'));
    applyTypeToKok(state.formKoks[i], e.target.value || null);
    renderFormKoks();
  };
  list.oninput = function (e) {
    if (!e.target || e.target.getAttribute('data-role') !== 'price') return;
    var row = e.target.closest('[data-i]');
    if (!row) return;
    var i = Number(row.getAttribute('data-i'));
    state.formKoks[i].pricePerPerson = Number(e.target.value || 0);
    updateFormCostHint();
  };
}

function resetKokTypeForm() {
  $('#kokTypeEditId').value = '';
  $('#kokTypeName').value = '';
  $('#kokTypePrice').value = state.settings.defaultPricePerPerson || 3000;
  var stockEl = $('#kokTypeStock');
  if (stockEl) stockEl.value = 0;
  $('#kokTypeFormCancel').hidden = true;
  var submit = $('#kokTypeFormSubmit');
  if (submit) {
    submit.innerHTML = '<iconify-icon icon="mdi:plus" width="16"></iconify-icon> Tambah';
  }
}

function stockBadgeClass(stock) {
  if (stock <= 0) return 'bg-danger/12 text-danger';
  if (stock <= 3) return 'bg-warn/12 text-warn';
  return 'bg-ok/12 text-ok';
}

function renderKokTypeList() {
  var list = $('#kokTypeList');
  if (!list) return;
  var types = state.kokTypes || [];
  if (!types.length) {
    list.innerHTML = emptyState('game-icons:shuttlecock', 'Belum ada jenis kok');
    return;
  }
  list.innerHTML = types.map(function (t) {
    var inactive = t.active === false;
    var stock = Number(t.stock) || 0;
    return (
      '<div class="flex items-center gap-2 rounded-xl border border-line bg-elevated p-3' + (inactive ? ' opacity-60' : '') + '" data-id="' + escapeAttr(t.id) + '">' +
        '<div class="min-w-0 flex-1">' +
          '<p class="truncate text-sm font-semibold text-ink50">' + escapeHtml(t.name) + '</p>' +
          '<p class="mt-0.5 font-mono text-xs text-muted">' + fmt(t.pricePerPerson) + ' / orang' +
            (inactive ? ' · nonaktif' : '') +
          '</p>' +
          '<div class="mt-1.5 flex flex-wrap items-center gap-1.5">' +
            '<span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ' + stockBadgeClass(stock) + '">' +
              '<iconify-icon icon="mdi:package-variant" width="12"></iconify-icon>stok ' + stock +
            '</span>' +
            '<button type="button" data-role="stock-plus" class="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] font-medium text-muted transition active:scale-95 hover:text-ink50" title="Tambah stok +1">+1</button>' +
            '<button type="button" data-role="stock-plus12" class="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] font-medium text-muted transition active:scale-95 hover:text-ink50" title="Tambah 1 tube (+12)">+12</button>' +
            '<button type="button" data-role="stock-minus" class="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] font-medium text-muted transition active:scale-95 hover:text-ink50" title="Kurangi stok -1">−1</button>' +
          '</div>' +
        '</div>' +
        '<button type="button" data-role="edit-type" class="grid h-9 w-9 place-items-center rounded-lg border border-line text-muted transition active:scale-95 hover:text-ink50" title="Edit">' +
          '<iconify-icon icon="mdi:pencil-outline" width="16"></iconify-icon>' +
        '</button>' +
        '<button type="button" data-role="toggle-type" class="grid h-9 w-9 place-items-center rounded-lg border border-line text-muted transition active:scale-95 hover:text-ink50" title="' + (inactive ? 'Aktifkan' : 'Nonaktifkan') + '">' +
          '<iconify-icon icon="' + (inactive ? 'mdi:eye-off-outline' : 'mdi:eye-outline') + '" width="16"></iconify-icon>' +
        '</button>' +
        '<button type="button" data-role="delete-type" class="grid h-9 w-9 place-items-center rounded-lg border border-line text-soft transition active:scale-95 hover:text-danger" title="Hapus">' +
          '<iconify-icon icon="mdi:trash-can-outline" width="16"></iconify-icon>' +
        '</button>' +
      '</div>'
    );
  }).join('');
}

function syncKokTypesFromResponse(data) {
  if (data && Array.isArray(data.kokTypes)) {
    state.kokTypes = data.kokTypes;
  }
}

function openKokTypesDialog() {
  resetKokTypeForm();
  renderKokTypeList();
  $('#kokTypesDialog').showModal();
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
    '<details class="debt rounded-xl2 border border-warn/25 bg-warn/[0.06] p-3.5">' +
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

function renderDebt() {
  var list = $('#debtList');
  var meta = $('#debtMeta');
  if (!list || !meta) return;

  var total = state.debtSummary.reduce(function (s, d) { return s + d.total; }, 0);
  meta.textContent = state.debtSummary.length
    ? state.debtSummary.length + ' orang · ' + fmt(total)
    : 'Semua lunas';

  if (!state.debtSummary.length) {
    list.innerHTML = emptyState('mdi:emoticon-happy-outline', 'Semua sudah bayar 🎉');
    return;
  }

  list.innerHTML = state.debtSummary.map(debtCard).join('');
}

function playerChip(g, p, index) {
  if (!p) p = { name: '—', paid: false };
  var paid = !!p.paid;
  var cls = paid
    ? 'border-ok/30 bg-ok/10 text-ok'
    : 'border-warn/30 bg-warn/10 text-warn';
  return (
    '<button type="button" data-action="toggle-paid" data-id="' + g.id + '" data-index="' + index + '" class="flex w-full min-w-0 items-center gap-2 rounded-lg border ' + cls + ' px-2.5 py-3 text-left transition active:scale-[0.98]">' +
      '<iconify-icon icon="' + (paid ? 'mdi:check-circle' : 'mdi:clock-outline') + '" width="18" class="shrink-0"></iconify-icon>' +
      '<span class="min-w-0 flex-1 truncate text-sm font-medium">' + escapeHtml(p.name) + '</span>' +
    '</button>'
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

function kokSummaryLabel(g) {
  var names = [];
  var seen = {};
  (g.koks || []).forEach(function (k) {
    var n = k && k.typeName ? String(k.typeName).trim() : '';
    if (n && !seen[n]) {
      seen[n] = true;
      names.push(n);
    }
  });
  var base = g.cost.kokCount + ' kok · ' + fmt(g.cost.perPerson) + '/org';
  if (!names.length) return base;
  if (names.length === 1) return base + ' · ' + names[0];
  return base + ' · ' + names.length + ' jenis';
}

function adminGameCard(g) {
  var scoreA = (g.pairs && g.pairs.a && g.pairs.a.score) || (g.scores && g.scores.a) || '';
  var scoreB = (g.pairs && g.pairs.b && g.pairs.b.score) || (g.scores && g.scores.b) || '';
  var statusBadge = g.summary.allPaid
    ? '<span class="inline-flex items-center gap-1 rounded-full bg-ok/12 px-2 py-0.5 text-[11px] font-semibold text-ok"><iconify-icon icon="mdi:check-circle" width="13"></iconify-icon>Lunas</span>'
    : '<span class="inline-flex items-center gap-1 rounded-full bg-warn/12 px-2 py-0.5 text-[11px] font-semibold text-warn"><iconify-icon icon="mdi:alert-circle-outline" width="13"></iconify-icon>' + g.summary.unpaidCount + ' belum</span>';

  var markAllCls = g.summary.allPaid
    ? 'border-line bg-elevated text-muted'
    : 'border-ok/40 bg-ok/10 text-ok';

  return (
    '<article class="rounded-xl2 bg-elevated p-3.5" data-id="' + g.id + '">' +
      '<div class="flex items-center justify-between gap-3">' +
        '<div class="flex min-w-0 items-center gap-1.5 text-xs text-muted">' +
          '<iconify-icon icon="game-icons:shuttlecock" width="13" class="shrink-0 text-soft"></iconify-icon>' +
          '<span class="truncate">' + escapeHtml(kokSummaryLabel(g)) + '</span>' +
        '</div>' +
        '<div class="shrink-0">' + statusBadge + '</div>' +
      '</div>' +
      (function () {
        var hasScore = !!(scoreA || scoreB);
        return (
          '<div class="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-1.5 sm:gap-x-2.5">' +
            pairGroup(scoreA, hasScore, playerChip(g, g.players[0], 0) + playerChip(g, g.players[1], 1)) +
            '<div class="text-center text-[10px] font-bold uppercase tracking-wider text-soft">vs</div>' +
            pairGroup(scoreB, hasScore, playerChip(g, g.players[2], 2) + playerChip(g, g.players[3], 3)) +
          '</div>'
        );
      })() +
      (g.notes
        ? '<div class="mt-2.5 flex items-start gap-1.5 rounded-lg bg-sunken px-2.5 py-2 text-xs text-muted">' +
            '<iconify-icon icon="mdi:note-text-outline" width="14" class="mt-0.5 shrink-0 text-soft"></iconify-icon>' +
            '<span class="min-w-0">' + escapeHtml(g.notes) + '</span>' +
          '</div>'
        : '') +
      '<div class="mt-3 grid grid-cols-2 gap-2">' +
        '<button data-action="mark-all" data-id="' + g.id + '" data-paid="' + (g.summary.allPaid ? 'false' : 'true') + '" class="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-xl border ' + markAllCls + ' px-3 py-2.5 text-sm font-medium transition active:scale-95">' +
          '<iconify-icon icon="' + (g.summary.allPaid ? 'mdi:restore' : 'mdi:check-all') + '" width="16"></iconify-icon>' +
          (g.summary.allPaid ? 'Tandai semua belum' : 'Tandai semua bayar') +
        '</button>' +
        '<button data-action="add-kok" data-id="' + g.id + '" class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-line bg-elevated px-3 py-2.5 text-sm font-medium transition active:scale-95">' +
          '<iconify-icon icon="mdi:plus" width="16"></iconify-icon> Kok' +
        '</button>' +
        '<button data-action="edit" data-id="' + g.id + '" class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-line bg-elevated px-3 py-2.5 text-sm font-medium transition active:scale-95">' +
          '<iconify-icon icon="mdi:pencil-outline" width="16"></iconify-icon> Edit' +
        '</button>' +
      '</div>' +
    '</article>'
  );
}

function groupGamesByDate(games) {
  var map = {};
  var order = [];
  games.forEach(function (g) {
    if (!map[g.date]) {
      map[g.date] = { date: g.date, games: [], total: 0, unpaidCount: 0 };
      order.push(g.date);
    }
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
        grp.games.map(function (g) { return adminGameCard(g); }).join('') +
      '</div>' +
    '</details>'
  );
}

function renderGames() {
  var list = $('#gameList');
  var meta = $('#historyMeta');
  if (!list || !meta) return;

  meta.textContent = state.games.length ? state.games.length + ' game' : 'Kosong';

  if (!state.games.length) {
    list.innerHTML = emptyState('mdi:badminton', 'Belum ada catatan.');
    return;
  }

  var groups = groupGamesByDate(state.games);
  list.innerHTML = groups.map(function (grp, i) { return historyGroup(grp, i === 0); }).join('');
}

function refresh() {
  return api('/api/bootstrap').then(function (data) {
    state.settings = data.settings;
    state.players = data.players || [];
    state.kokTypes = data.kokTypes || [];
    state.games = data.games || [];
    state.debtSummary = data.debtSummary || [];
    var priceEl = $('#defaultPrice');
    if (priceEl) priceEl.value = data.settings.defaultPricePerPerson;
    ensureDatalist();
    renderDebt();
    renderGames();
    if ($('#kokTypesDialog') && $('#kokTypesDialog').open) {
      renderKokTypeList();
    }
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
    '<div class="grid place-items-center"><span class="grid h-7 w-7 place-items-center rounded-full border border-line bg-surface text-[10px] font-bold tracking-wider text-soft">VS</span></div>',
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
    '<div class="flex items-center justify-between">' +
      '<span class="text-xs font-medium text-muted">Kok (snapshot)</span>' +
      '<button type="button" id="editAddKok" class="inline-flex items-center gap-1 rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs font-medium transition active:scale-95">' +
        '<iconify-icon icon="mdi:plus" width="14"></iconify-icon> Kok' +
      '</button>' +
    '</div>' +
    state.edit.koks.map(function (k, i) {
      return kokRowHtml(i, k, state.edit.koks.length === 1);
    }).join('');

  $('#editAddKok').onclick = function () {
    state.edit.koks.push(defaultKokEntry());
    renderEditKoks();
  };

  list.onclick = function (e) {
    var btn = e.target.closest('[data-role="remove"]');
    if (!btn) return;
    var row = btn.closest('[data-i]');
    if (!row) return;
    if (state.edit.koks.length <= 1) return;
    state.edit.koks.splice(Number(row.getAttribute('data-i')), 1);
    renderEditKoks();
  };

  list.onchange = function (e) {
    if (!e.target || e.target.getAttribute('data-role') !== 'type') return;
    var row = e.target.closest('[data-i]');
    if (!row) return;
    var i = Number(row.getAttribute('data-i'));
    applyTypeToKok(state.edit.koks[i], e.target.value || null);
    renderEditKoks();
  };

  list.oninput = function (e) {
    if (!e.target || e.target.getAttribute('data-role') !== 'price') return;
    var row = e.target.closest('[data-i]');
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

function openGameDialog() {
  var dateEl = $('#date');
  if (dateEl && !dateEl.value) dateEl.value = todayLocal();
  $('#gameDialog').showModal();
}

function payloadKoks(list) {
  return (list || []).map(function (k) {
    return {
      id: k.id || undefined,
      typeId: k.typeId || null,
      typeName: k.typeName || null,
      pricePerPerson: Number(k.pricePerPerson) || 0,
    };
  });
}

function wire() {
  state.formKoks = [defaultKokEntry()];
  renderFormKoks();
  bindFormKoks();

  $('#fabAdd').onclick = function () {
    openGameDialog();
  };

  $('#cancelGameForm').onclick = function () {
    $('#gameDialog').close();
  };

  $('#addKok').onclick = function () {
    state.formKoks.push(defaultKokEntry());
    renderFormKoks();
  };

  $('#kokTypesBtn').onclick = function () {
    openKokTypesDialog();
  };

  $('#closeKokTypes').onclick = function () {
    $('#kokTypesDialog').close();
  };

  $('#kokTypeFormCancel').onclick = function () {
    resetKokTypeForm();
  };

  $('#kokTypeForm').onsubmit = function (e) {
    e.preventDefault();
    var editId = $('#kokTypeEditId').value;
    var body = {
      name: $('#kokTypeName').value,
      pricePerPerson: Number($('#kokTypePrice').value),
      stock: Number($('#kokTypeStock').value || 0),
    };
    var req = editId
      ? api('/api/kok-types/' + editId, { method: 'PATCH', body: JSON.stringify(body) })
      : api('/api/kok-types', { method: 'POST', body: JSON.stringify(body) });
    req
      .then(function (data) {
        syncKokTypesFromResponse(data);
        resetKokTypeForm();
        renderKokTypeList();
        renderFormKoks();
        if (state.edit) renderEditKoks();
        toast(editId ? 'Jenis kok diupdate.' : 'Jenis kok ditambah.', 'success');
      })
      .catch(function (err) {
        toast(err.message, 'error');
      });
  };

  $('#kokTypeList').onclick = function (e) {
    var btn = e.target.closest('button[data-role]');
    if (!btn) return;
    var row = btn.closest('[data-id]');
    if (!row) return;
    var id = row.getAttribute('data-id');
    var type = (state.kokTypes || []).filter(function (t) { return t.id === id; })[0];
    if (!type) return;
    var role = btn.getAttribute('data-role');

    if (role === 'edit-type') {
      $('#kokTypeEditId').value = type.id;
      $('#kokTypeName').value = type.name;
      $('#kokTypePrice').value = type.pricePerPerson;
      $('#kokTypeStock').value = Number(type.stock) || 0;
      $('#kokTypeFormCancel').hidden = false;
      $('#kokTypeFormSubmit').innerHTML =
        '<iconify-icon icon="mdi:content-save-outline" width="16"></iconify-icon> Simpan';
      $('#kokTypeName').focus();
      return;
    }

    if (role === 'stock-plus' || role === 'stock-plus12' || role === 'stock-minus') {
      var delta = role === 'stock-plus' ? 1 : role === 'stock-plus12' ? 12 : -1;
      api('/api/kok-types/' + id + '/stock', {
        method: 'POST',
        body: JSON.stringify({ delta: delta }),
      })
        .then(function (data) {
          syncKokTypesFromResponse(data);
          renderKokTypeList();
          renderFormKoks();
          if (state.edit) renderEditKoks();
          toast('Stok diupdate.', 'success');
        })
        .catch(function (err) {
          toast(err.message, 'error');
        });
      return;
    }

    if (role === 'toggle-type') {
      api('/api/kok-types/' + id, {
        method: 'PATCH',
        body: JSON.stringify({ active: type.active === false }),
      })
        .then(function (data) {
          syncKokTypesFromResponse(data);
          renderKokTypeList();
          renderFormKoks();
          if (state.edit) renderEditKoks();
          toast(type.active === false ? 'Jenis diaktifkan.' : 'Jenis dinonaktifkan.', 'success');
        })
        .catch(function (err) {
          toast(err.message, 'error');
        });
      return;
    }

    if (role === 'delete-type') {
      askConfirm('Hapus jenis "' + type.name + '"? History game tetap pakai snapshot nama lama.').then(function (ok) {
        if (!ok) return;
        api('/api/kok-types/' + id, { method: 'DELETE' })
          .then(function (data) {
            syncKokTypesFromResponse(data);
            resetKokTypeForm();
            renderKokTypeList();
            renderFormKoks();
            if (state.edit) renderEditKoks();
            toast('Jenis kok dihapus.', 'success');
          })
          .catch(function (err) {
            toast(err.message, 'error');
          });
      });
    }
  };

  $('#settingsBtn').onclick = function () {
    $('#defaultPrice').value = state.settings.defaultPricePerPerson;
    $('#settingsDialog').showModal();
  };

  $('#cancelSettings').onclick = function () {
    $('#settingsDialog').close();
  };

  $('#settingsForm').onsubmit = function (e) {
    e.preventDefault();
    var defaultPricePerPerson = Number($('#defaultPrice').value);
    api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ defaultPricePerPerson: defaultPricePerPerson }),
    }).then(function (data) {
      state.settings = data.settings;
      $('#settingsDialog').close();
      toast('Default harga disimpan.', 'success');
    }).catch(function (err) {
      toast(err.message, 'error');
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
        koks: payloadKoks(state.formKoks),
      }),
    }).then(function () {
      $('#gameDialog').close();
      $('#notes').value = '';
      clearFormPairs();
      state.formKoks = [defaultKokEntry()];
      renderFormKoks();
      toast('Game tersimpan.', 'success');
      return refresh();
    }).catch(function (err) {
      toast(err.message, 'error');
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
      var entry = defaultKokEntry();
      p = api('/api/games/' + id + '/koks', {
        method: 'POST',
        body: JSON.stringify({
          typeId: entry.typeId,
          typeName: entry.typeName,
          pricePerPerson: entry.pricePerPerson,
        }),
      });
    } else if (action === 'edit') {
      openEdit(state.games.filter(function (g) { return g.id === id; })[0]);
      return;
    }

    if (p) {
      p.then(function (data) {
        syncKokTypesFromResponse(data);
        return refresh();
      }).catch(function (err) {
        toast(err.message, 'error');
      });
    }
  };

  $('#cancelEdit').onclick = function () {
    $('#editDialog').close();
  };

  $('#deleteGame').onclick = function () {
    askConfirm('Hapus game ini? Data tidak bisa dikembalikan.').then(function (ok) {
      if (!ok) return;
      api('/api/games/' + $('#editId').value, { method: 'DELETE' })
        .then(function () {
          $('#editDialog').close();
          toast('Game dihapus.', 'success');
          return refresh();
        })
        .catch(function (err) { toast(err.message, 'error'); });
    });
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
        koks: payloadKoks(state.edit.koks),
      }),
    }).then(function () {
      $('#editDialog').close();
      toast('Perubahan disimpan.', 'success');
      return refresh();
    }).catch(function (err) {
      toast(err.message, 'error');
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
        if (state.formKoks.length === 1 && !state.formKoks[0].typeId) {
          state.formKoks = [defaultKokEntry()];
          renderFormKoks();
        }
      })
      .catch(function (err) {
        console.error(err);
        toast('Gagal load data: ' + err.message, 'error');
      });
  } catch (err) {
    console.error(err);
    toast('Gagal init UI: ' + err.message, 'error');
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
