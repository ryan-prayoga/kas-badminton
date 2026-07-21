const state = {
  settings: { defaultPricePerPerson: 3000 },
  qrisEnabled: false,
  merchantQris: '',
  kas: null,
  players: [],
  kokTypes: [],
  games: [],
  debtSummary: [],
  formKoks: [{ typeId: null, typeName: null, pricePerPerson: 3000 }],
  edit: null,
  period: 'all',
  role: null,
  operatorName: '',
  operatorExpiresAt: '',
  operators: [],
  operatorRevealed: [],
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
    renderGames();
    renderStats();
    renderStatPlayers();
  });
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

// --- Toast + confirm ---
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
  $$('dialog[open]').forEach(function (dlg) { dlg.close(); });
  pinBuffer = '';
  renderLockDots();
  $('#appRoot').hidden = true;
  $('#fabAdd').hidden = true;
  $('#bottomNav').hidden = true;
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
  $('#bottomNav').hidden = false;
}

function applyRole(me) {
  state.role = me.role || null;
  state.operatorName = me.name || '';
  state.operatorExpiresAt = me.expiresAt || '';
}

function loadMe() {
  return fetch('/api/me').then(function (r) { return r.json(); }).then(applyRole);
}

function renderRoleUI() {
  var isOperator = state.role === 'operator';
  var label = $('#roleLabel');
  if (label) label.textContent = isOperator ? ('Delegasi · ' + state.operatorName) : 'Admin';
  $$('[data-admin-only]').forEach(function (el) { el.hidden = isOperator; });
  var info = $('#operatorInfo');
  if (info) {
    info.hidden = !isOperator;
    if (isOperator) {
      $('#operatorInfoText').textContent = state.operatorName + ' · berlaku sampai ' + fmtDate(state.operatorExpiresAt.slice(0, 10)) + ' ' + new Date(state.operatorExpiresAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    }
  }
}

function submitPin() {
  var pin = pinBuffer;
  pinBuffer = '';
  api('/api/login', {
    method: 'POST',
    body: JSON.stringify({ pin: pin }),
  }).then(function () {
    return loadMe();
  }).then(function () {
    renderRoleUI();
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

  function doLogout() {
    api('/api/logout', { method: 'POST' }).finally(function () {
      location.reload();
    });
  }
  var logoutBtn = $('#logoutBtn');
  if (logoutBtn) logoutBtn.onclick = doLogout;
  var logoutBtn2 = $('#logoutBtn2');
  if (logoutBtn2) logoutBtn2.onclick = doLogout;
}

// --- Player autocomplete ---
function playerMatches(query) {
  var q = String(query || '').trim().toLowerCase();
  var names = (state.players || []).map(function (p) { return p.name; });
  if (!q) return names.slice(0, 8);
  return names.filter(function (n) {
    return n.toLowerCase().indexOf(q) !== -1;
  }).slice(0, 8);
}

function closeAllPlayerSuggests() {
  $$('.player-suggest-list').forEach(function (el) { el.remove(); });
}

function showPlayerSuggest(input) {
  closeAllPlayerSuggests();
  var matches = playerMatches(input.value);
  if (!matches.length) return;
  var wrap = input.parentElement;
  var box = document.createElement('div');
  box.className = 'player-suggest-list absolute inset-x-0 top-full z-20 mt-1 max-h-48 overflow-auto rounded-xl border border-line bg-elevated shadow-card';
  box.innerHTML = matches.map(function (name) {
    return '<button type="button" class="block w-full truncate px-3 py-2 text-left text-sm text-ink50 hover:bg-surface active:bg-surface" data-name="' + escapeAttr(name) + '">' + escapeHtml(name) + '</button>';
  }).join('');
  box.onmousedown = function (e) {
    e.preventDefault();
    var btn = e.target.closest('[data-name]');
    if (!btn) return;
    input.value = btn.getAttribute('data-name');
    closeAllPlayerSuggests();
  };
  wrap.appendChild(box);
}

function wirePlayerAutocomplete(input) {
  if (!input || input.dataset.autocompleteWired) return;
  input.dataset.autocompleteWired = '1';
  input.addEventListener('focus', function () { showPlayerSuggest(input); });
  input.addEventListener('input', function () { showPlayerSuggest(input); });
  input.addEventListener('blur', function () {
    setTimeout(closeAllPlayerSuggests, 150);
  });
}

function wireAllPlayerInputs(root) {
  $$('input[data-role="player"]', root || document).forEach(wirePlayerAutocomplete);
}

var FIELD_CLS = 'w-full rounded-xl border border-line bg-ink px-3 py-2.5 text-base outline-none transition focus:border-brand/60';

function pairCardHtml(opts) {
  var pairKey = opts.pairKey;
  var label = opts.label;
  var p1Name = opts.p1Name || '';
  var p2Name = opts.p2Name || '';
  var namePrefix = opts.namePrefix || 'player';
  var i1 = pairKey === 'a' ? 0 : 2;
  var i2 = pairKey === 'a' ? 1 : 3;
  var badge = pairKey === 'a' ? 'bg-brand/10 text-brand' : 'bg-ok/10 text-ok';
  return (
    '<div class="rounded-xl border border-line bg-elevated p-3" data-pair="' + pairKey + '">' +
      '<div class="mb-3 flex items-center gap-2">' +
        '<span class="inline-flex items-center rounded-md ' + badge + ' px-2 py-1 text-xs font-bold uppercase tracking-wide">' + escapeHtml(label) + '</span>' +
      '</div>' +
      '<div class="grid gap-2 sm:grid-cols-2">' +
        '<div class="relative"><input type="text" name="' + namePrefix + i1 + '" data-role="player" value="' + escapeAttr(p1Name) + '" placeholder="Pemain 1" autocomplete="off" required maxlength="40" class="' + FIELD_CLS + '" /></div>' +
        '<div class="relative"><input type="text" name="' + namePrefix + i2 + '" data-role="player" value="' + escapeAttr(p2Name) + '" placeholder="Pemain 2" autocomplete="off" required maxlength="40" class="' + FIELD_CLS + '" /></div>' +
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
  return {
    pairs: { a: [names[0], names[1]], b: [names[2], names[3]] },
    names: names,
  };
}

// --- Kok types ---
function activeKokTypes() {
  return (state.kokTypes || []).filter(function (t) { return t.active !== false; });
}

function defaultKokEntry() {
  var types = activeKokTypes().filter(function (t) { return (Number(t.stock) || 0) > 0; });
  if (!types.length) types = activeKokTypes();
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
    var out = stock <= 0 && selectedId !== t.id;
    opts +=
      '<option value="' + escapeAttr(t.id) + '"' +
      (selectedId === t.id ? ' selected' : '') +
      (out ? ' disabled' : '') +
      '>' +
      escapeHtml(t.name) + ' · ' + fmt(t.pricePerPerson) +
      (stock <= 0 ? ' · habis' : ' · stok ' + stock) +
      '</option>';
  });
  if (selectedId && !types.some(function (t) { return t.id === selectedId; }) && snapshotName) {
    opts +=
      '<option value="' + escapeAttr(selectedId) + '" selected>' +
      escapeHtml(snapshotName) + ' (lama)</option>';
  }
  return opts;
}

function kokRowHtml(i, kok, disableRemove) {
  kok = kok || {};
  return (
    '<div class="grid min-w-0 gap-2 rounded-xl border border-line bg-sunken p-2" data-i="' + i + '">' +
      '<div class="flex min-w-0 items-center gap-2">' +
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
  var totalPer = state.formKoks.reduce(function (s, k) { return s + Number(k.pricePerPerson || 0); }, 0);
  el.textContent = state.formKoks.length + ' kok · ' + fmt(totalPer) + ' / orang · total ' + fmt(totalPer * 4);
}

function applyTypeToKok(kok, typeId) {
  if (!typeId) { kok.typeId = null; kok.typeName = null; return; }
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
  var slopEl = $('#kokTypeSlopPrice');
  if (slopEl) slopEl.value = 0;
  var stockEl = $('#kokTypeStock');
  if (stockEl) stockEl.value = 0;
  $('#kokTypeFormCancel').hidden = true;
  var submit = $('#kokTypeFormSubmit');
  if (submit) submit.innerHTML = '<iconify-icon icon="mdi:plus" width="16"></iconify-icon> Tambah';
}

function stockBadgeClass(stock) {
  if (stock <= 0) return 'bg-danger/15 text-danger';
  if (stock <= 3) return 'bg-warn/15 text-warn';
  return 'bg-ok/15 text-ok';
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
      '<div class="flex items-center gap-1.5 rounded-xl border border-line bg-elevated p-3' + (inactive ? ' opacity-60' : '') + '" data-id="' + escapeAttr(t.id) + '">' +
        '<div class="min-w-0 flex-1">' +
          '<p class="truncate text-sm font-semibold text-ink50">' + escapeHtml(t.name) + '</p>' +
          '<p class="mt-0.5 font-mono text-xs text-muted">' + fmt(t.pricePerPerson) + ' / orang' +
            (Number(t.pricePerSlop) > 0 ? ' · ' + fmt(t.pricePerSlop) + ' / slop' : '') +
            (inactive ? ' · nonaktif' : '') +
          '</p>' +
          '<div class="mt-1.5 flex flex-wrap items-center gap-1">' +
            '<span class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ' + stockBadgeClass(stock) + '">' +
              '<iconify-icon icon="mdi:package-variant" width="12"></iconify-icon>stok ' + stock +
            '</span>' +
            '<button type="button" data-role="buy" class="inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand transition active:scale-95" title="Beli slop (isi 12)"><iconify-icon icon="mdi:cash-register" width="12"></iconify-icon>Beli slop</button>' +
            '<button type="button" data-role="stock-plus" class="rounded-md border border-line bg-surface px-1 py-0.5 text-[11px] font-medium text-muted transition active:scale-95 hover:text-ink50" title="Koreksi stok +1">+1</button>' +
            '<button type="button" data-role="stock-minus" class="rounded-md border border-line bg-surface px-1 py-0.5 text-[11px] font-medium text-muted transition active:scale-95 hover:text-ink50" title="Koreksi stok -1">−1</button>' +
          '</div>' +
        '</div>' +
        '<button type="button" data-role="edit-type" class="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-muted transition active:scale-95 hover:text-ink50" title="Edit">' +
          '<iconify-icon icon="mdi:pencil-outline" width="15"></iconify-icon>' +
        '</button>' +
        '<button type="button" data-role="toggle-type" class="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-muted transition active:scale-95 hover:text-ink50" title="' + (inactive ? 'Aktifkan' : 'Nonaktifkan') + '">' +
          '<iconify-icon icon="' + (inactive ? 'mdi:eye-off-outline' : 'mdi:eye-outline') + '" width="15"></iconify-icon>' +
        '</button>' +
        '<button type="button" data-role="delete-type" class="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-soft transition active:scale-95 hover:text-danger" title="Hapus">' +
          '<iconify-icon icon="mdi:trash-can-outline" width="15"></iconify-icon>' +
        '</button>' +
      '</div>'
    );
  }).join('');
}

function syncKokTypesFromResponse(data) {
  if (data && Array.isArray(data.kokTypes)) state.kokTypes = data.kokTypes;
}

function openKokTypesDialog() {
  resetKokTypeForm();
  renderKokTypeList();
  $('#kokTypesDialog').showModal();
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
    return '<img src="' + escapeAttr(photo) + '" alt="" class="' + sizeClass + ' shrink-0 rounded-full border border-line object-cover" />';
  }
  return '<div class="grid ' + sizeClass + ' shrink-0 place-items-center rounded-full ' + colorClass + ' font-bold">' + escapeHtml((name || '?').slice(0, 1).toUpperCase()) + '</div>';
}

// --- Kelola pemain ---
function resizeImageFile(file, maxDim, quality) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function () { reject(new Error('Gagal baca file')); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { reject(new Error('File bukan gambar valid')); };
      img.onload = function () {
        var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

var pendingPlayerPhoto; // undefined = belum diubah, null = dihapus, string = foto baru

function setPlayerPhotoPreview(photo, name) {
  var img = $('#playerPhotoPreview');
  var initial = $('#playerPhotoInitial');
  var removeBtn = $('#playerRemovePhoto');
  if (photo) {
    img.src = photo;
    img.hidden = false;
    initial.hidden = true;
    removeBtn.hidden = false;
  } else {
    img.hidden = true;
    initial.hidden = false;
    initial.textContent = (name || '?').slice(0, 1).toUpperCase();
    removeBtn.hidden = true;
  }
}

function renderPlayerList() {
  var list = $('#playerList');
  if (!list) return;
  var players = state.players || [];
  if (!players.length) {
    list.innerHTML = emptyState('mdi:account-off-outline', 'Belum ada pemain.');
    return;
  }
  list.innerHTML = players.map(function (p) {
    return (
      '<div class="flex items-center gap-3 rounded-xl border border-line bg-elevated p-3" data-name="' + escapeAttr(p.name) + '">' +
        avatarHtml(p.name, p.photo, 'h-10 w-10') +
        '<div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold text-ink50">' + escapeHtml(p.name) + '</p></div>' +
        '<button type="button" data-role="edit-player" class="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-muted transition active:scale-95 hover:text-ink50" title="Edit">' +
          '<iconify-icon icon="mdi:pencil-outline" width="15"></iconify-icon>' +
        '</button>' +
      '</div>'
    );
  }).join('');
}

function openPlayerEditForm(p) {
  pendingPlayerPhoto = undefined;
  $('#playerEditOriginal').value = p.name;
  $('#playerEditName').value = p.name;
  setPlayerPhotoPreview(p.photo || null, p.name);
  $('#playerEditForm').hidden = false;
  $('#playerEditName').focus();
}

function closePlayerEditForm() {
  $('#playerEditForm').hidden = true;
  $('#playerEditForm').reset();
  pendingPlayerPhoto = undefined;
}

function openPlayersDialog() {
  closePlayerEditForm();
  renderPlayerList();
  $('#playersDialog').showModal();
}

// --- Penanggung jawab sementara (delegasi) ---
function fmtDateTime(iso) {
  if (!iso) return '—';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return fmtDate(d.toISOString().slice(0, 10)) + ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function operatorStatusBadge() {
  return '<span class="inline-flex items-center gap-1 rounded-full bg-ok/15 px-1.5 py-0.5 text-[11px] font-semibold text-ok"><iconify-icon icon="mdi:check-circle" width="12"></iconify-icon>Aktif</span>';
}

function renderOperatorList() {
  var list = $('#operatorList');
  if (!list) return;
  var active = (state.operators || []).filter(function (op) { return op.active; });
  if (!active.length) {
    list.innerHTML = emptyState('mdi:account-clock-outline', 'Belum ada delegasi aktif.');
    return;
  }
  list.innerHTML = active.map(function (op) {
    return (
      '<div class="flex items-center gap-3 rounded-xl border border-line bg-elevated p-3" data-id="' + escapeAttr(op.id) + '">' +
        '<div class="min-w-0 flex-1">' +
          '<div class="flex items-center gap-1.5">' +
            '<span class="truncate font-semibold">' + escapeHtml(op.name) + '</span>' +
            operatorStatusBadge() +
          '</div>' +
          '<div class="mt-0.5 text-[11px] text-soft">sampai ' + fmtDateTime(op.expiresAt) + '</div>' +
        '</div>' +
        '<button type="button" data-role="revoke-operator" class="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-soft transition active:scale-95 hover:text-danger" title="Cabut"><iconify-icon icon="mdi:trash-can-outline" width="15"></iconify-icon></button>' +
      '</div>'
    );
  }).join('');
}

function renderOperatorRevealed() {
  var box = $('#operatorRevealed');
  if (!box) return;
  var activeIds = {};
  (state.operators || []).forEach(function (op) { if (op.active) activeIds[op.id] = true; });
  state.operatorRevealed = state.operatorRevealed.filter(function (r) { return activeIds[r.id]; });
  box.innerHTML = state.operatorRevealed.map(function (r) {
    return (
      '<div class="grid grid-cols-1 gap-2 rounded-xl border border-brand/40 bg-brand/10 p-3.5 text-center">' +
        '<p class="text-xs text-muted">PIN untuk <span class="font-semibold text-ink50">' + escapeHtml(r.name) + '</span></p>' +
        '<p class="font-mono text-3xl font-bold tracking-[0.3em] text-brand">' + escapeHtml(r.pin) + '</p>' +
        '<p class="text-xs text-soft">Berlaku sampai ' + fmtDateTime(r.expiresAt) + '</p>' +
        '<div class="grid grid-cols-2 gap-2">' +
          '<button type="button" data-role="copy-pin" data-pin="' + escapeAttr(r.pin) + '" class="rounded-xl border border-line bg-elevated px-3 py-2 text-sm font-medium transition active:scale-95">Salin PIN</button>' +
          '<button type="button" data-role="share-pin" data-name="' + escapeAttr(r.name) + '" data-pin="' + escapeAttr(r.pin) + '" data-expiry="' + escapeAttr(fmtDateTime(r.expiresAt)) + '" class="rounded-xl border border-line bg-elevated px-3 py-2 text-sm font-medium transition active:scale-95">Share</button>' +
        '</div>' +
      '</div>'
    );
  }).join('');
}

function fetchOperators() {
  return api('/api/operators').then(function (data) {
    state.operators = data.operators || [];
    renderOperatorList();
    renderOperatorRevealed();
  }).catch(function (err) { toast(err.message, 'error'); });
}

function resetOperatorForm() {
  $('#operatorForm').reset();
  $('#operatorCustomDate').hidden = true;
}

function openOperatorsDialog() {
  resetOperatorForm();
  fetchOperators();
  $('#operatorsDialog').showModal();
}

function operatorExpiresAtFromForm() {
  var val = $('#operatorDuration').value;
  if (val === 'custom') {
    var d = $('#operatorCustomDate').value;
    if (!d) return null;
    return new Date(d + 'T23:59:59').toISOString();
  }
  var unit = val.slice(-1);
  var amount = Number(val.slice(0, -1));
  var ms = unit === 'h' ? amount * 3600000 : amount * 86400000;
  return new Date(Date.now() + ms).toISOString();
}

function wireOperators() {
  $('#operatorsBtn').onclick = openOperatorsDialog;
  $('#closeOperators').onclick = function () { $('#operatorsDialog').close(); };
  wirePlayerAutocomplete($('#operatorName'));

  $('#operatorDuration').onchange = function (e) {
    $('#operatorCustomDate').hidden = e.target.value !== 'custom';
  };

  $('#operatorForm').onsubmit = function (e) {
    e.preventDefault();
    var name = $('#operatorName').value;
    var expiresAt = operatorExpiresAtFromForm();
    if (!expiresAt) { toast('Isi tanggal kadaluarsa.', 'error'); return; }
    api('/api/operators', { method: 'POST', body: JSON.stringify({ name: name, expiresAt: expiresAt }) })
      .then(function (data) {
        state.operatorRevealed.unshift({ id: data.operator.id, name: data.operator.name, pin: data.pin, expiresAt: data.operator.expiresAt });
        $('#operatorForm').reset();
        $('#operatorCustomDate').hidden = true;
        fetchOperators();
        toast('PIN delegasi dibuat.', 'success');
      }).catch(function (err) { toast(err.message, 'error'); });
  };

  $('#operatorList').onclick = function (e) {
    var btn = e.target.closest('button[data-role="revoke-operator"]');
    if (!btn) return;
    var row = btn.closest('[data-id]');
    if (!row) return;
    var id = row.getAttribute('data-id');
    var op = state.operators.filter(function (o) { return o.id === id; })[0];
    askConfirm('Cabut akses delegasi "' + (op ? op.name : '') + '"? Sesi yang lagi login langsung ke-logout.').then(function (ok) {
      if (!ok) return;
      api('/api/operators/' + id, { method: 'DELETE' })
        .then(function () { fetchOperators(); toast('Delegasi dicabut.', 'success'); })
        .catch(function (err) { toast(err.message, 'error'); });
    });
  };

  $('#operatorRevealed').onclick = function (e) {
    var copyBtn = e.target.closest('button[data-role="copy-pin"]');
    if (copyBtn) {
      var pin = copyBtn.getAttribute('data-pin');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(pin).then(function () { toast('PIN disalin.', 'success'); }, function () { toast('Gagal salin.', 'error'); });
      } else {
        toast('Clipboard tidak didukung.', 'error');
      }
      return;
    }
    var shareBtn = e.target.closest('button[data-role="share-pin"]');
    if (shareBtn) {
      var name = shareBtn.getAttribute('data-name');
      var sPin = shareBtn.getAttribute('data-pin');
      var expiry = shareBtn.getAttribute('data-expiry');
      var text = 'PIN Kok Badminton buat ' + name + ': ' + sPin + '\nBerlaku sampai ' + expiry + '\nBuka: ' + location.origin + '/admin';
      if (navigator.share) {
        navigator.share({ text: text }).catch(function () {});
      } else {
        window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
      }
    }
  };
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
    ? '<div class="mt-0.5 text-[11px] text-ok">dicicil ' + fmt(d.carry) + ' dari ' + fmt(d.owedGross) + '</div>'
    : '';
  var qrisBtn = state.qrisEnabled
    ? '<button type="button" data-action="qris" data-name="' + escapeAttr(d.name) + '" data-amount="' + d.total + '" class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-line bg-elevated px-3 py-2.5 text-sm font-medium transition active:scale-95"><iconify-icon icon="mdi:qrcode" width="16"></iconify-icon> QRIS</button>'
    : '';
  return (
    '<details class="debt rounded-xl2 border border-warn/25 bg-warn/[0.06] p-3.5">' +
      '<summary class="flex select-none items-center justify-between gap-3">' +
        '<div class="flex min-w-0 items-center gap-2.5">' +
          avatarHtml(d.name, (playerPhotoMap()[d.name]), 'h-9 w-9', 'bg-warn/15 text-warn') +
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
      '<div class="mt-3 grid grid-cols-2 gap-2">' +
        '<button type="button" data-admin-only data-action="pay" data-name="' + escapeAttr(d.name) + '" data-amount="' + d.total + '" class="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand px-3 py-2.5 text-sm font-bold text-ink transition active:scale-95 hover:bg-brand-soft"><iconify-icon icon="mdi:cash-plus" width="16"></iconify-icon> Bayar sebagian</button>' +
        '<button type="button" data-admin-only data-action="settle" data-name="' + escapeAttr(d.name) + '" class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-ok/40 bg-ok/10 px-3 py-2.5 text-sm font-medium text-ok transition active:scale-95"><iconify-icon icon="mdi:check-all" width="16"></iconify-icon> Lunasin semua</button>' +
        qrisBtn +
        '<button type="button" data-action="share" data-name="' + escapeAttr(d.name) + '" class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-line bg-elevated px-3 py-2.5 text-sm font-medium transition active:scale-95"><iconify-icon icon="mdi:share-variant-outline" width="16"></iconify-icon> Share</button>' +
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

// --- Riwayat cards ---
function playerChip(g, p, index) {
  if (!p) p = { name: '—', paid: false };
  var paid = !!p.paid;
  var cls = paid ? 'border-ok/30 bg-ok/10 text-ok' : 'border-warn/30 bg-warn/10 text-warn';
  return (
    '<button type="button" data-action="toggle-paid" data-id="' + g.id + '" data-index="' + index + '" class="flex w-full min-w-0 items-center gap-2 rounded-lg border ' + cls + ' px-2 py-2.5 text-left transition active:scale-[0.98]">' +
      avatarHtml(p.name, playerPhotoMap()[p.name], 'h-6 w-6') +
      '<span class="min-w-0 flex-1 truncate text-sm font-medium">' + escapeHtml(p.name) + '</span>' +
      '<iconify-icon icon="' + (paid ? 'mdi:check-circle' : 'mdi:clock-outline') + '" width="16" class="shrink-0"></iconify-icon>' +
    '</button>'
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

function adminGameCard(g) {
  var statusBadge = g.summary.allPaid
    ? '<span class="inline-flex items-center gap-1 rounded-full bg-ok/15 px-2 py-0.5 text-[11px] font-semibold text-ok"><iconify-icon icon="mdi:check-circle" width="13"></iconify-icon>Lunas</span>'
    : '<span class="inline-flex items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn"><iconify-icon icon="mdi:alert-circle-outline" width="13"></iconify-icon>' + g.summary.unpaidCount + ' belum</span>';

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
      '<div class="mt-1 flex items-center gap-1 text-[11px] text-soft">' +
        '<iconify-icon icon="mdi:pencil-outline" width="11" class="shrink-0"></iconify-icon>' +
        '<span class="truncate">dicatat oleh ' + escapeHtml(g.recordedBy || 'Admin') + '</span>' +
      '</div>' +
      '<div class="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-1.5 sm:gap-x-2.5">' +
        pairGroup(playerChip(g, g.players[0], 0) + playerChip(g, g.players[1], 1)) +
        '<div class="text-center text-[10px] font-bold uppercase tracking-wider text-soft">vs</div>' +
        pairGroup(playerChip(g, g.players[2], 2) + playerChip(g, g.players[3], 3)) +
      '</div>' +
      (g.notes
        ? '<div class="mt-2.5 flex items-start gap-1.5 rounded-lg bg-sunken px-2.5 py-2 text-xs text-muted">' +
            '<iconify-icon icon="mdi:note-text-outline" width="14" class="mt-0.5 shrink-0 text-soft"></iconify-icon>' +
            '<span class="min-w-0">' + escapeHtml(g.notes) + '</span>' +
          '</div>'
        : '') +
      '<div class="mt-2 grid grid-cols-2 gap-2">' +
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
    '<details class="history overflow-hidden rounded-xl2 border border-line bg-surface shadow-card" data-date="' + escapeAttr(grp.date) + '"' + (open ? ' open' : '') + '>' +
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
        grp.games.map(function (g) { return adminGameCard(g); }).join('') +
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

// --- Statistik ---
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
  var kas = state.kas || { paid: 0, expense: 0, net: 0 };
  var types = state.kokTypes || [];
  var stockLeft = types.reduce(function (s, t) { return s + Math.max(0, Number(t.stock) || 0); }, 0);
  var typesWithStock = types.filter(function (t) { return (Number(t.stock) || 0) > 0; }).length;
  strip.innerHTML =
    (state.role === 'admin'
      ? statCard({ icon: 'mdi:cash-register', iconClass: kas.net >= 0 ? 'text-ok' : 'text-danger', label: 'Total kas', value: fmt(kas.net), valueClass: kas.net >= 0 ? 'text-ok' : 'text-danger', sub: 'masuk ' + fmt(kas.paid) + ' · beli ' + fmt(kas.expense) })
      : '') +
    statCard({ icon: 'mdi:cash-multiple', iconClass: 'text-warn', label: 'Belum bayar', value: fmt(totalDebt), valueClass: totalDebt ? 'text-warn' : 'text-ok', sub: state.debtSummary.length ? state.debtSummary.length + ' orang' : 'Semua lunas' }) +
    statCard({ icon: 'mdi:badminton', iconClass: 'text-brand', label: 'Total main', value: String(games.length), sub: games.length ? 'game tercatat' : 'belum ada' }) +
    statCard({ icon: 'game-icons:shuttlecock', iconClass: 'text-brand', label: 'Kok terpakai', value: String(totalKok), sub: 'total kok' }) +
    statCard({ icon: 'mdi:package-variant', iconClass: stockLeft > 0 ? 'text-ok' : 'text-danger', label: 'Stok kok sisa', value: String(stockLeft), valueClass: stockLeft > 0 ? '' : 'text-danger', sub: stockLeft > 0 ? typesWithStock + ' jenis tersedia' : 'stok habis' });
}

function renderStatPlayers() {
  var list = $('#statPlayers');
  if (!list) return;
  var map = {};
  gamesInPeriod(state.games).forEach(function (g) {
    (g.players || []).forEach(function (p) {
      if (!p.name) return;
      if (!map[p.name]) map[p.name] = { name: p.name, main: 0, keluar: 0, nunggak: 0 };
      var s = map[p.name];
      s.main += 1;
      s.keluar += g.cost.perPerson;
      if (!p.paid) s.nunggak += g.cost.perPerson;
    });
  });
  var rows = Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
    return b.nunggak - a.nunggak || b.main - a.main || a.name.localeCompare(b.name, 'id');
  });
  if (!rows.length) { list.innerHTML = emptyState('mdi:account-off-outline', 'Belum ada pemain.'); return; }
  var photoMap = playerPhotoMap();
  list.innerHTML = rows.map(function (s) {
    return (
      '<div class="flex items-center gap-3 rounded-xl border border-line bg-elevated p-3">' +
        avatarHtml(s.name, photoMap[s.name], 'h-9 w-9') +
        '<div class="min-w-0 flex-1">' +
          '<div class="truncate font-semibold">' + escapeHtml(s.name) + '</div>' +
          '<div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-soft">' +
            '<span>' + s.main + ' main</span><span>keluar ' + fmt(s.keluar) + '</span>' +
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

function renderAll() {
  renderPeriodFilter();
  renderDebt();
  renderGames();
  renderStats();
  renderStatPlayers();
  if ($('#kokTypesDialog') && $('#kokTypesDialog').open) renderKokTypeList();
  if ($('#playersDialog') && $('#playersDialog').open) renderPlayerList();
  renderRoleUI();
}

function applyServerState(data) {
  if (!data) return;
  if (data.settings) {
    state.settings = { defaultPricePerPerson: data.settings.defaultPricePerPerson };
    state.qrisEnabled = !!data.settings.qrisEnabled;
    if (data.settings.merchantQris !== undefined) state.merchantQris = data.settings.merchantQris;
  }
  if (data.players) state.players = data.players;
  if (data.kokTypes) state.kokTypes = data.kokTypes;
  if (data.games) state.games = data.games;
  if (data.debtSummary) state.debtSummary = data.debtSummary;
  if (data.kas) state.kas = data.kas;
  renderAll();
}

function refresh() {
  return api('/api/bootstrap').then(applyServerState);
}

// --- Share / QRIS ---
function doShare(text) {
  if (navigator.share) { navigator.share({ text: text }).catch(function () {}); return; }
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { toast('Disalin.', 'success'); }, function () { toast('Gagal salin.', 'error'); });
  } else {
    toast('Clipboard tidak didukung.', 'error');
  }
}

function debtShareText(d) {
  var lines = ['Tagihan kok badminton — ' + d.name, 'Sisa: ' + fmt(d.total)];
  if (d.carry > 0) lines.push('(sudah dicicil ' + fmt(d.carry) + ' dari ' + fmt(d.owedGross) + ')');
  groupDebtItems(d.items).forEach(function (g) {
    lines.push('• ' + fmtDate(g.date) + ' — ' + fmt(g.total) + ' (' + g.count + ' main)');
  });
  if (state.qrisEnabled) lines.push('Bisa bayar QRIS, buka: ' + location.origin);
  return lines.join('\n');
}

function shareAllText() {
  if (!state.debtSummary.length) return 'Semua sudah lunas 🎉';
  var total = state.debtSummary.reduce(function (s, d) { return s + d.total; }, 0);
  var lines = ['Rekap tagihan kok badminton', 'Total belum bayar: ' + fmt(total), ''];
  state.debtSummary.forEach(function (d) { lines.push('• ' + d.name + ': ' + fmt(d.total)); });
  if (state.qrisEnabled) lines.push('', 'Bayar QRIS: ' + location.origin);
  return lines.join('\n');
}

var qrisPayload = '';
var qrisName = '';

function renderQr(container, text) {
  container.innerHTML = '';
  try {
    var qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    container.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 1, scalable: true });
    var svg = container.querySelector('svg');
    if (svg) { svg.style.width = '100%'; svg.style.height = 'auto'; svg.style.maxWidth = '260px'; }
  } catch (e) {
    container.innerHTML = '<span class="text-sm text-danger">Gagal render QR</span>';
  }
}

function openQris(name, amount) {
  qrisPayload = '';
  qrisName = name || '';
  $('#qrisWho').textContent = name ? 'Untuk: ' + name : 'Pembayaran';
  $('#qrisAmount').value = amount > 0 ? amount : '';
  $('#qrisCanvas').innerHTML = '<span class="text-sm text-soft">Isi nominal lalu "Buat QR"</span>';
  $('#qrisDialog').showModal();
  if (amount > 0) generateQris();
}

function generateQris() {
  var amount = Math.round(Number($('#qrisAmount').value) || 0);
  if (!(amount > 0)) { toast('Nominal harus > 0', 'error'); return; }
  var canvas = $('#qrisCanvas');
  canvas.innerHTML = '<iconify-icon icon="svg-spinners:180-ring" width="24" class="text-soft"></iconify-icon>';
  api('/api/qris', { method: 'POST', body: JSON.stringify({ amount: amount }) })
    .then(function (data) {
      qrisPayload = data.payload;
      renderQr(canvas, data.payload);
      $('#qrisHint').textContent = 'Nominal ' + fmt(data.amount) + ' · scan pakai app apapun yang support QRIS.';
    })
    .catch(function (err) {
      canvas.innerHTML = '<span class="text-sm text-danger">' + escapeHtml(err.message) + '</span>';
    });
}

// --- Bayar sebagian ---
function openPay(name, amount) {
  $('#payName').value = name;
  $('#payWho').textContent = name + ' · sisa ' + fmt(amount);
  $('#payAmount').value = amount > 0 ? amount : '';
  $('#payDialog').showModal();
}

function submitPay(name, amount) {
  return api('/api/players/pay', { method: 'POST', body: JSON.stringify({ name: name, amount: amount }) })
    .then(function (data) { applyServerState(data); toast('Pembayaran dicatat.', 'success'); })
    .catch(function (err) { toast(err.message, 'error'); });
}

// --- Decode QRIS dari foto/upload ---
function setQrisStatus(msg, kind) {
  var el = $('#qrisStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'text-xs ' + (kind === 'ok' ? 'text-ok' : kind === 'error' ? 'text-danger' : 'text-soft');
}

function decodeQrisImage(file) {
  if (!window.jsQR) { setQrisStatus('Decoder QR belum siap, reload halaman.', 'error'); return; }
  setQrisStatus('Membaca QR…', 'info');
  var reader = new FileReader();
  reader.onload = function () {
    var img = new Image();
    img.onload = function () {
      var maxDim = 1200;
      var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      var data;
      try { data = ctx.getImageData(0, 0, w, h); } catch (e) { setQrisStatus('Gagal baca gambar.', 'error'); return; }
      var code = null;
      try { code = window.jsQR(data.data, w, h, { inversionAttempts: 'attemptBoth' }); } catch (e) {}
      if (code && code.data) {
        var payload = String(code.data).trim();
        $('#merchantQris').value = payload;
        if (/^0002/.test(payload)) {
          setQrisStatus('✓ QR terbaca. Klik Simpan untuk aktifkan.', 'ok');
        } else {
          setQrisStatus('QR terbaca tapi bukan format QRIS. Cek lagi.', 'error');
        }
      } else {
        setQrisStatus('QR gak kebaca. Coba foto lebih jelas / crop pas ke kotak QR.', 'error');
      }
      renderQrisPreview();
    };
    img.onerror = function () { setQrisStatus('Gagal buka gambar.', 'error'); };
    img.src = reader.result;
  };
  reader.onerror = function () { setQrisStatus('Gagal baca file.', 'error'); };
  reader.readAsDataURL(file);
}

function renderQrisPreview() {
  var val = ($('#merchantQris').value || '').trim();
  var box = $('#qrisPreviewBox');
  var empty = $('#qrisEmptyBox');
  var removeBtn = $('#qrisRemoveBtn');
  if (val) {
    renderQr($('#qrisPreviewCanvas'), val);
    box.hidden = false;
    empty.hidden = true;
    removeBtn.hidden = false;
  } else {
    box.hidden = true;
    empty.hidden = false;
    removeBtn.hidden = true;
  }
}

// --- Beli slop ---
var buyType = null;

function updateBuyHint() {
  var el = $('#buyHint');
  if (!el) return;
  var slops = Math.max(0, Math.round(Number($('#buySlops').value) || 0));
  var price = Math.max(0, Math.round(Number($('#buyPrice').value) || 0));
  var pcs = slops * 12;
  var cost = slops * price;
  el.textContent = '+' + pcs + ' kok · kas −' + fmt(cost) + ' · 1 slop = 12 kok';
}

function openBuy(type) {
  buyType = type;
  $('#buyTypeId').value = type.id;
  $('#buyWho').textContent = type.name + ' · stok ' + (Number(type.stock) || 0);
  $('#buySlops').value = 1;
  $('#buyPrice').value = Number(type.pricePerSlop) || 0;
  updateBuyHint();
  $('#buyDialog').showModal();
}

// --- Tabs ---
function updateFabVisibility() {
  var tab = document.body.getAttribute('data-tab') || 'riwayat';
  $('#fabAdd').hidden = !(tab === 'riwayat' || tab === 'bayar');
}

function switchTab(name) {
  document.body.setAttribute('data-tab', name);
  $$('[data-panel]').forEach(function (el) { el.hidden = el.getAttribute('data-panel') !== name; });
  $$('#bottomNav .navitem').forEach(function (b) {
    b.classList.toggle('is-active', b.getAttribute('data-tab') === name);
  });
  updateFabVisibility();
  try { sessionStorage.setItem('kok-admin-tab', name); } catch (e) {}
  window.scrollTo(0, 0);
}

function wireTabs() {
  $('#bottomNav').onclick = function (e) {
    var btn = e.target.closest('.navitem');
    if (!btn) return;
    switchTab(btn.getAttribute('data-tab'));
  };
  var saved = 'riwayat';
  try { saved = sessionStorage.getItem('kok-admin-tab') || 'riwayat'; } catch (e) {}
  switchTab(saved);
}

// --- Form helpers ---
function clearFormPairs() {
  [0, 1, 2, 3].forEach(function (i) {
    var el = $('#gameForm input[name="player' + i + '"]');
    if (el) el.value = '';
  });
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

function openEdit(game) {
  state.edit = JSON.parse(JSON.stringify(game));
  $('#editId').value = game.id;
  $('#editDate').value = game.date;
  $('#editNotes').value = game.notes || '';

  var root = $('#editPairs');
  root.innerHTML = [
    pairCardHtml({ pairKey: 'a', label: 'Pair A', p1Name: game.players[0] && game.players[0].name, p2Name: game.players[1] && game.players[1].name, namePrefix: 'editPlayer' }),
    '<div class="grid place-items-center"><span class="grid h-7 w-7 place-items-center rounded-full border border-line bg-surface text-[10px] font-bold tracking-wider text-soft">VS</span></div>',
    pairCardHtml({ pairKey: 'b', label: 'Pair B', p1Name: game.players[2] && game.players[2].name, p2Name: game.players[3] && game.players[3].name, namePrefix: 'editPlayer' }),
  ].join('');
  wireAllPlayerInputs(root);

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

function wire() {
  state.formKoks = [defaultKokEntry()];
  renderFormKoks();
  bindFormKoks();
  wireAllPlayerInputs($('#gameForm'));
  wireTabs();
  wirePeriodFilter();
  wireOperators();

  $('#fabAdd').onclick = openGameDialog;
  $('#cancelGameForm').onclick = function () { $('#gameDialog').close(); };
  $('#addKok').onclick = function () { state.formKoks.push(defaultKokEntry()); renderFormKoks(); };

  $('#kokTypesBtn').onclick = openKokTypesDialog;
  $('#closeKokTypes').onclick = function () { $('#kokTypesDialog').close(); };
  $('#kokTypeFormCancel').onclick = resetKokTypeForm;

  $('#kokTypeForm').onsubmit = function (e) {
    e.preventDefault();
    var editId = $('#kokTypeEditId').value;
    var body = {
      name: $('#kokTypeName').value,
      pricePerPerson: Number($('#kokTypePrice').value),
      pricePerSlop: Number($('#kokTypeSlopPrice').value || 0),
      stock: Number($('#kokTypeStock').value || 0),
    };
    var req = editId
      ? api('/api/kok-types/' + editId, { method: 'PATCH', body: JSON.stringify(body) })
      : api('/api/kok-types', { method: 'POST', body: JSON.stringify(body) });
    req.then(function (data) {
      syncKokTypesFromResponse(data);
      resetKokTypeForm();
      renderKokTypeList();
      renderFormKoks();
      if (state.edit) renderEditKoks();
      toast(editId ? 'Jenis kok diupdate.' : 'Jenis kok ditambah.', 'success');
    }).catch(function (err) { toast(err.message, 'error'); });
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

    if (role === 'buy') {
      openBuy(type);
      return;
    }

    if (role === 'edit-type') {
      $('#kokTypeEditId').value = type.id;
      $('#kokTypeName').value = type.name;
      $('#kokTypePrice').value = type.pricePerPerson;
      $('#kokTypeSlopPrice').value = Number(type.pricePerSlop) || 0;
      $('#kokTypeStock').value = Number(type.stock) || 0;
      $('#kokTypeFormCancel').hidden = false;
      $('#kokTypeFormSubmit').innerHTML = '<iconify-icon icon="mdi:content-save-outline" width="16"></iconify-icon> Simpan';
      $('#kokTypeName').focus();
      return;
    }

    if (role === 'stock-plus' || role === 'stock-minus') {
      var delta = role === 'stock-plus' ? 1 : -1;
      api('/api/kok-types/' + id + '/stock', { method: 'POST', body: JSON.stringify({ delta: delta }) })
        .then(function (data) {
          syncKokTypesFromResponse(data);
          renderKokTypeList();
          renderFormKoks();
          if (state.edit) renderEditKoks();
          toast('Stok dikoreksi.', 'success');
        }).catch(function (err) { toast(err.message, 'error'); });
      return;
    }

    if (role === 'toggle-type') {
      api('/api/kok-types/' + id, { method: 'PATCH', body: JSON.stringify({ active: type.active === false }) })
        .then(function (data) {
          syncKokTypesFromResponse(data);
          renderKokTypeList();
          renderFormKoks();
          if (state.edit) renderEditKoks();
          toast(type.active === false ? 'Jenis diaktifkan.' : 'Jenis dinonaktifkan.', 'success');
        }).catch(function (err) { toast(err.message, 'error'); });
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
          }).catch(function (err) { toast(err.message, 'error'); });
      });
    }
  };

  // Kelola pemain
  $('#playersBtn').onclick = openPlayersDialog;
  $('#closePlayers').onclick = function () { $('#playersDialog').close(); };
  $('#playerEditCancel').onclick = closePlayerEditForm;

  $('#playerList').onclick = function (e) {
    var btn = e.target.closest('button[data-role="edit-player"]');
    if (!btn) return;
    var row = btn.closest('[data-name]');
    if (!row) return;
    var name = row.getAttribute('data-name');
    var p = (state.players || []).filter(function (x) { return x.name === name; })[0];
    if (p) openPlayerEditForm(p);
  };

  $('#playerPhotoPick').onclick = function () { $('#playerPhotoInput').click(); };

  $('#playerPhotoInput').onchange = function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    resizeImageFile(file, 480, 0.82).then(function (dataUrl) {
      pendingPlayerPhoto = dataUrl;
      setPlayerPhotoPreview(dataUrl, $('#playerEditName').value);
    }).catch(function (err) { toast(err.message, 'error'); });
  };

  $('#playerRemovePhoto').onclick = function () {
    pendingPlayerPhoto = null;
    setPlayerPhotoPreview(null, $('#playerEditName').value);
  };

  $('#playerEditForm').onsubmit = function (e) {
    e.preventDefault();
    var original = $('#playerEditOriginal').value;
    var newName = $('#playerEditName').value;
    var body = { name: newName };
    if (pendingPlayerPhoto !== undefined) body.photo = pendingPlayerPhoto;
    api('/api/players/' + encodeURIComponent(original), { method: 'PATCH', body: JSON.stringify(body) })
      .then(function (data) {
        applyServerState(data);
        closePlayerEditForm();
        renderPlayerList();
        toast('Pemain diupdate.', 'success');
      }).catch(function (err) { toast(err.message, 'error'); });
  };

  // Settings
  $('#settingsBtn').onclick = function () {
    $('#merchantQris').value = state.merchantQris || '';
    renderQrisPreview();
    var st = $('#qrisStatus');
    if (st) {
      st.textContent = state.qrisEnabled ? '✓ QRIS aktif' : 'QRIS belum diatur';
      st.className = 'text-xs ' + (state.qrisEnabled ? 'text-ok' : 'text-soft');
    }
    $('#settingsDialog').showModal();
  };
  $('#cancelSettings').onclick = function () { $('#settingsDialog').close(); };

  $('#qrisUploadBtn').onclick = function () { $('#qrisFile').click(); };
  $('#qrisFile').onchange = function (e) {
    var file = e.target.files && e.target.files[0];
    if (file) decodeQrisImage(file);
    e.target.value = '';
  };
  $('#qrisRemoveBtn').onclick = function () {
    $('#merchantQris').value = '';
    renderQrisPreview();
    setQrisStatus('QRIS dikosongkan. Klik Simpan buat matikan.', 'info');
  };

  $('#settingsForm').onsubmit = function (e) {
    e.preventDefault();
    api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        merchantQris: $('#merchantQris').value,
      }),
    }).then(function (data) {
      if (data.settings) {
        state.settings = { defaultPricePerPerson: data.settings.defaultPricePerPerson };
        state.qrisEnabled = !!data.settings.qrisEnabled;
        state.merchantQris = data.settings.merchantQris || '';
      }
      renderDebt();
      $('#settingsDialog').close();
      toast('Pengaturan disimpan.', 'success');
    }).catch(function (err) { toast(err.message, 'error'); });
  };

  // Catat main
  $('#gameForm').onsubmit = function (e) {
    e.preventDefault();
    var parsed = readPairsFrom($('#gameForm'));
    api('/api/games', {
      method: 'POST',
      body: JSON.stringify({
        date: $('#date').value,
        notes: $('#notes').value,
        pairs: parsed.pairs,
        koks: payloadKoks(state.formKoks),
      }),
    }).then(function (data) {
      $('#gameDialog').close();
      $('#notes').value = '';
      clearFormPairs();
      state.formKoks = [defaultKokEntry()];
      renderFormKoks();
      applyServerState(data);
      toast('Game tersimpan.', 'success');
    }).catch(function (err) { toast(err.message, 'error'); });
  };

  // Riwayat card actions
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
      p = api('/api/games/' + id + '/players/' + index + '/paid', { method: 'PATCH', body: JSON.stringify({ paid: paid }) });
    } else if (action === 'mark-all') {
      p = api('/api/games/' + id + '/mark-all-paid', { method: 'POST', body: JSON.stringify({ paid: btn.getAttribute('data-paid') === 'true' }) });
    } else if (action === 'add-kok') {
      var entry = defaultKokEntry();
      p = api('/api/games/' + id + '/koks', { method: 'POST', body: JSON.stringify({ typeId: entry.typeId, typeName: entry.typeName, pricePerPerson: entry.pricePerPerson }) });
    } else if (action === 'edit') {
      openEdit(state.games.filter(function (g) { return g.id === id; })[0]);
      return;
    }

    if (p) p.then(applyServerState).catch(function (err) { toast(err.message, 'error'); });
  };

  // Belum bayar card actions
  $('#debtList').onclick = function (e) {
    var btn = e.target.closest('button[data-action]');
    if (!btn) return;
    e.preventDefault();
    var action = btn.getAttribute('data-action');
    var name = btn.getAttribute('data-name');
    var d = state.debtSummary.filter(function (x) { return x.name === name; })[0];

    if (action === 'pay') openPay(name, Number(btn.getAttribute('data-amount')) || 0);
    else if (action === 'qris') openQris(name, Number(btn.getAttribute('data-amount')) || 0);
    else if (action === 'share' && d) doShare(debtShareText(d));
    else if (action === 'settle') {
      askConfirm('Lunasin SEMUA tagihan ' + name + '? Semua game-nya ditandai bayar.').then(function (ok) {
        if (!ok) return;
        api('/api/players/settle', { method: 'POST', body: JSON.stringify({ name: name }) })
          .then(function (data) { applyServerState(data); toast('Semua tagihan ' + name + ' lunas.', 'success'); })
          .catch(function (err) { toast(err.message, 'error'); });
      });
    }
  };
  $('#shareAllBtn').onclick = function () { doShare(shareAllText()); };

  // Beli slop dialog
  $('#cancelBuy').onclick = function () { $('#buyDialog').close(); };
  $('#buySlops').oninput = updateBuyHint;
  $('#buyPrice').oninput = updateBuyHint;
  $('#buyForm').onsubmit = function (e) {
    e.preventDefault();
    var id = $('#buyTypeId').value;
    var slops = Math.round(Number($('#buySlops').value) || 0);
    var price = Math.round(Number($('#buyPrice').value) || 0);
    if (!(slops > 0)) { toast('Jumlah slop harus > 0', 'error'); return; }
    api('/api/kok-types/' + id + '/buy', { method: 'POST', body: JSON.stringify({ slops: slops, pricePerSlop: price }) })
      .then(function (data) {
        applyServerState(data);
        renderKokTypeList();
        renderFormKoks();
        $('#buyDialog').close();
        toast('Stok ditambah, kas berkurang.', 'success');
      }).catch(function (err) { toast(err.message, 'error'); });
  };

  // Pay dialog
  $('#cancelPay').onclick = function () { $('#payDialog').close(); };
  $('#payForm').onsubmit = function (e) {
    e.preventDefault();
    var name = $('#payName').value;
    var amount = Math.round(Number($('#payAmount').value) || 0);
    if (!(amount > 0)) { toast('Nominal harus > 0', 'error'); return; }
    submitPay(name, amount).then(function () { $('#payDialog').close(); });
  };

  // QRIS dialog
  $('#qrisGen').onclick = generateQris;
  $('[data-close-qris]').onclick = function () { $('#qrisDialog').close(); };
  $('#qrisCopy').onclick = function () {
    if (!qrisPayload) { toast('Buat QR dulu.', 'error'); return; }
    copyText(qrisPayload);
  };
  $('#qrisShare').onclick = function () {
    var amount = Math.round(Number($('#qrisAmount').value) || 0);
    doShare('Bayar kok badminton ' + fmt(amount) + ' via QRIS. Buka: ' + location.origin);
  };
  $('#qrisPaid').onclick = function () {
    var amount = Math.round(Number($('#qrisAmount').value) || 0);
    if (!qrisName || !(amount > 0)) { toast('Isi nominal dulu.', 'error'); return; }
    submitPay(qrisName, amount).then(function () { $('#qrisDialog').close(); });
  };

  // Edit dialog
  $('#cancelEdit').onclick = function () { $('#editDialog').close(); };
  $('#deleteGame').onclick = function () {
    askConfirm('Hapus game ini? Data tidak bisa dikembalikan.').then(function (ok) {
      if (!ok) return;
      api('/api/games/' + $('#editId').value, { method: 'DELETE' })
        .then(function (data) { $('#editDialog').close(); applyServerState(data); toast('Game dihapus.', 'success'); })
        .catch(function (err) { toast(err.message, 'error'); });
    });
  };
  $('#editForm').onsubmit = function (e) {
    e.preventDefault();
    var id = $('#editId').value;
    var parsed = readPairsFrom($('#editForm'), 'editPlayer');
    var players = parsed.names.map(function (name, idx) {
      return { name: name, paid: !!(state.edit.players[idx] && state.edit.players[idx].paid) };
    });
    api('/api/games/' + id, {
      method: 'PATCH',
      body: JSON.stringify({
        date: $('#editDate').value,
        notes: $('#editNotes').value,
        pairs: { a: players.slice(0, 2), b: players.slice(2, 4) },
        koks: payloadKoks(state.edit.koks),
      }),
    }).then(function (data) { $('#editDialog').close(); applyServerState(data); toast('Perubahan disimpan.', 'success'); })
      .catch(function (err) { toast(err.message, 'error'); });
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
  loadMe()
    .then(function () {
      if (state.role) { renderRoleUI(); showApp(); startApp(); }
      else showLock();
    })
    .catch(function () { showLock(); });
})();
