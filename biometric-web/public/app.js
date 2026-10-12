const VERIFY = { 0: 'Password', 1: 'Fingerprint', 2: 'Card', 15: 'Face', 25: 'Palm' };
const PUNCH = { 0: 'Check-In', 1: 'Check-Out', 2: 'Break-Out', 3: 'Break-In', 4: 'OT-In', 5: 'OT-Out' };
const PRIVILEGE = { 0: 'User', 2: 'Enroller', 6: 'Manager', 14: 'Admin' };
const PAGE = 500;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-IN'));
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const showDate = (ts) => (ts ? `${ts.slice(8, 10)}/${ts.slice(5, 7)}/${ts.slice(0, 4)}` : '');
const showStamp = (ts) => (ts ? `${showDate(ts)} ${ts.slice(11, 16)}` : '—');
const hours = (m) => (m == null ? '' : `${Math.floor(m / 60)}:${pad(m % 60)}`);

let state = { devices: [], networks: [], autoMinutes: 0, totals: {} };
let activeTab = 'machines';
const pages = { logs: 1, daily: 1, users: 1 };
const cache = { daily: [], users: [] };

async function call(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 9000 : 5000);
}

// ---------- machines ----------

async function loadState() {
  state = await call('/api/state');
  renderMachines();
  fillMachineSelects();
}

function renderMachines() {
  const { devices, totals, networks } = state;
  $('#auto').value = String(state.autoMinutes);
  const online = devices.filter((d) => d.status === 'online').length;
  $('#summary').innerHTML = [
    [devices.length, 'Machines'],
    [`${online} / ${devices.length}`, 'Connected at last check'],
    [num(totals.logs), 'Punches saved'],
    [num(totals.people), 'Employees on machines'],
    [totals.last ? showStamp(totals.last) : '—', 'Latest punch'],
  ].map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');

  const away = devices.filter((d) => !d.sameNetwork);
  const warn = $('#netWarning');
  warn.hidden = !away.length;
  if (away.length) {
    const mine = networks.map((n) => n.address).join(', ') || 'no network';
    warn.textContent = `This PC (${mine}) is not on the same network as ${away.map((d) => `${d.name} (${d.ip})`).join(', ')}. ` +
      'Run this app on a PC connected to the machines\' network, or connect this PC to it.';
  }

  $('#devices').innerHTML = devices.length ? devices.map((d) => {
    const info = d.info || {};
    const status = d.busy
      ? `<span class="status busy">${d.busy === 'test' ? 'Connecting…' : 'Downloading…'}</span>`
      : d.status === 'online' ? '<span class="status online">Connected</span>'
      : d.status === 'error' ? `<span class="status error">Failed</span><span class="status-msg" title="${esc(d.message)}">${esc(d.message)}</span>`
      : '<span class="status">Not checked</span>';
    const model = [info.deviceName, info.platform].filter(Boolean).join(' · ');
    return `<tr data-id="${d.id}">
      <td><b>${esc(d.name)}</b><span class="sub">Machine No. ${esc(d.machineNo)}</span></td>
      <td class="mono">${esc(d.ip)}:${esc(d.port)}<span class="sub">${esc(d.protocol === 'auto' ? (info.protocol ? `auto → ${info.protocol.toUpperCase()}` : 'auto') : d.protocol.toUpperCase())}${d.commKey ? ' · Comm Key set' : ''}</span>
        ${d.sameNetwork ? '' : '<span class="warn-text">Different network from this PC</span>'}</td>
      <td>${status}</td>
      <td>${esc(model || '—')}<span class="sub mono">${esc(info.serialNumber || '')}</span></td>
      <td class="num">${num(info.users)}${info.admins ? `<span class="sub">${info.admins} admin</span>` : ''}</td>
      <td class="num">${num(info.fingers)}${info.faces ? `<span class="sub">${num(info.faces)} faces</span>` : ''}</td>
      <td class="num">${num(info.records)}${info.recordsCapacity ? `<span class="sub">of ${num(info.recordsCapacity)}</span>` : ''}</td>
      <td class="num">${num(d.storedLogs)}${d.lastPunch ? `<span class="sub">last ${showStamp(d.lastPunch)}</span>` : ''}</td>
      <td>${info.deviceTime ? showStamp(info.deviceTime) : '—'}${d.checkedAt ? `<span class="sub">checked ${showStamp(d.checkedAt)}</span>` : ''}</td>
      <td>${showStamp(d.syncedAt)}</td>
      <td class="actions">
        <button class="small" data-act="test" ${d.busy ? 'disabled' : ''}>Test</button>
        <button class="small primary" data-act="download" ${d.busy ? 'disabled' : ''}>Download</button>
        <button class="small" data-act="edit">Edit</button>
        <button class="small danger" data-act="delete" ${d.busy ? 'disabled' : ''}>Delete</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="11" class="empty">No machines yet. Click “Add machine”.</td></tr>';
  $('#downloadAll').disabled = devices.some((d) => d.busy) || !devices.length;
}

function fillMachineSelects() {
  for (const select of $$('select[name="device"]')) {
    const current = select.value;
    select.innerHTML = '<option value="">All machines</option>' +
      state.devices.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
    select.value = state.devices.some((d) => String(d.id) === current) ? current : '';
  }
}

async function runOnMachine(id, act) {
  const device = state.devices.find((d) => d.id === id);
  const busyRow = state.devices.map((d) => (d.id === id ? { ...d, busy: act } : d));
  state = { ...state, devices: busyRow };
  renderMachines();
  try {
    const r = await call(`/api/devices/${id}/${act}`, { method: 'POST' });
    if (act === 'test') {
      toast(`${device.name}: connected over ${r.info.protocol.toUpperCase()} in ${r.seconds.toFixed(1)} s\n` +
        `${num(r.info.users)} users · ${num(r.info.records)} punches on the machine`, 'ok');
    } else {
      toast(`${device.name}: ${num(r.logs)} punches read, ${num(r.newLogs)} new · ${num(r.users)} users (${r.seconds.toFixed(1)} s)`, 'ok');
    }
  } catch (err) {
    const network = /Cannot connect|No route|No answer/.test(err.message);
    toast(network ? `${err.message}\nCheck that the machine is on, the IP and port are right, and this PC is on the machine's network.` : err.message, 'bad');
  }
  await loadState();
  refreshActiveTab();
}

$('#devices').addEventListener('click', async (e) => {
  const button = e.target.closest('button[data-act]');
  if (!button) return;
  const id = Number(button.closest('tr').dataset.id);
  const act = button.dataset.act;
  const device = state.devices.find((d) => d.id === id);
  if (act === 'edit') return openDeviceDialog(device);
  if (act === 'delete') {
    if (!confirm(`Remove ${device.name} (${device.ip}) from this list?\nPunches already downloaded from it stay saved.`)) return;
    try { await call(`/api/devices/${id}`, { method: 'DELETE' }); toast(`${device.name} removed`); } catch (err) { toast(err.message, 'bad'); }
    return loadState();
  }
  runOnMachine(id, act);
});

// One request per machine, so each row updates as soon as its own download finishes.
$('#downloadAll').addEventListener('click', () => {
  for (const d of state.devices) if (!d.busy) runOnMachine(d.id, 'download');
});

$('#auto').addEventListener('change', async (e) => {
  try {
    await call('/api/settings', { method: 'PUT', body: { autoMinutes: Number(e.target.value) } });
    toast(Number(e.target.value) ? `Auto download every ${$('#auto').selectedOptions[0].text.replace('Every ', '')} while this app is running` : 'Auto download off');
  } catch (err) { toast(err.message, 'bad'); }
});

// ---------- add / edit machine ----------

let editing = null;
const dialog = $('#deviceDialog'), form = $('#deviceForm');

function openDeviceDialog(device = null) {
  editing = device;
  $('#deviceTitle').textContent = device ? `Edit ${device.name}` : 'Add machine';
  form.reset();
  if (device) for (const key of ['name', 'ip', 'port', 'protocol', 'commKey', 'machineNo']) form.elements[key].value = device[key];
  $('#deviceError').hidden = true;
  dialog.showModal();
}
$('#addDevice').addEventListener('click', () => openDeviceDialog());

form.addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault();
  const body = Object.fromEntries(new FormData(form));
  try {
    if (editing) await call(`/api/devices/${editing.id}`, { method: 'PUT', body });
    else await call('/api/devices', { method: 'POST', body });
    dialog.close();
    toast(`${body.name} saved`, 'ok');
    loadState();
  } catch (err) {
    $('#deviceError').textContent = err.message;
    $('#deviceError').hidden = false;
  }
});

// ---------- tabs & filters ----------

function selectTab(tab) {
  activeTab = tab;
  for (const b of $$('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const s of $$('.tab')) s.hidden = s.id !== `tab-${tab}`;
  refreshActiveTab();
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));

function refreshActiveTab() {
  if (activeTab === 'logs') loadLogs();
  else if (activeTab === 'daily') loadDaily();
  else if (activeTab === 'users') loadUsers();
  else if (activeTab === 'history') loadHistory();
}

const query = (view) => {
  const params = new URLSearchParams();
  for (const [k, v] of new FormData($(`form[data-view="${view}"]`))) if (v) params.set(k, v);
  return params;
};

for (const f of $$('.filters')) {
  const today = new Date();
  if (f.elements.from) f.elements.from.value = isoDay(new Date(today.getFullYear(), today.getMonth(), 1));
  if (f.elements.to) f.elements.to.value = isoDay(today);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    pages[f.dataset.view] = 1;
    refreshActiveTab();
  });
}
for (const a of $$('[data-export]')) {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    location.href = `/api/export/${a.dataset.export}?${query(a.dataset.export)}`;
  });
}

function pager(id, page, total, onPage) {
  const el = $(`#${id}`);
  const pagesCount = Math.max(1, Math.ceil(total / PAGE));
  const first = total ? (page - 1) * PAGE + 1 : 0, last = Math.min(total, page * PAGE);
  el.innerHTML = `<span>${total ? `Showing ${num(first)}–${num(last)} of ${num(total)}` : ''}</span>` +
    (pagesCount > 1 ? `<div><button class="small" data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ Previous</button>
      <button class="small" data-p="${page + 1}" ${page >= pagesCount ? 'disabled' : ''}>Next ›</button></div>` : '');
  el.onclick = (e) => { const b = e.target.closest('button[data-p]'); if (b) onPage(Number(b.dataset.p)); };
}

const empty = (cols, text) => `<tr><td colspan="${cols}" class="empty">${text}</td></tr>`;
const noData = 'No punches in this range. Download from the machines on the Machines tab.';

async function loadLogs() {
  const params = query('logs');
  params.set('page', pages.logs);
  const r = await call(`/api/logs?${params}`).catch((err) => (toast(err.message, 'bad'), null));
  if (!r) return;
  $('#logs').innerHTML = r.rows.length ? r.rows.map((l) => `<tr>
    <td>${showDate(l.ts)}</td><td class="mono">${l.ts.slice(11)}</td><td class="mono">${esc(l.user_id)}</td><td>${esc(l.name)}</td>
    <td>${esc(l.device)}</td><td>${esc(VERIFY[l.verify] ?? `Mode ${l.verify}`)}</td>
    <td><span class="tag ${l.punch === 0 ? 'in' : l.punch === 1 ? 'out' : ''}">${esc(PUNCH[l.punch] ?? `State ${l.punch}`)}</span></td>
  </tr>`).join('') : empty(7, noData);
  pager('logsPager', r.page, r.total, (p) => { pages.logs = p; loadLogs(); });
}

function renderDaily() {
  const rows = cache.daily.slice((pages.daily - 1) * PAGE, pages.daily * PAGE);
  $('#daily').innerHTML = rows.length ? rows.map((r) => `<tr>
    <td>${showDate(r.day)}</td><td class="mono">${esc(r.user_id)}</td><td>${esc(r.name)}</td>
    <td class="mono">${r.first.slice(11, 16)}</td><td class="mono">${r.minutes == null ? '<span class="sub">single punch</span>' : r.last.slice(11, 16)}</td>
    <td class="num mono">${hours(r.minutes)}</td><td class="num">${r.punches}</td><td>${esc(r.devices)}</td>
  </tr>`).join('') : empty(8, noData);
  pager('dailyPager', pages.daily, cache.daily.length, (p) => { pages.daily = p; renderDaily(); });
}
async function loadDaily() {
  const r = await call(`/api/daily?${query('daily')}`).catch((err) => (toast(err.message, 'bad'), null));
  if (!r) return;
  cache.daily = r.rows;
  renderDaily();
}

function renderUsers() {
  const rows = cache.users.slice((pages.users - 1) * PAGE, pages.users * PAGE);
  $('#users').innerHTML = rows.length ? rows.map((u) => `<tr>
    <td class="mono">${esc(u.user_id)}</td><td>${esc(u.name) || '<span class="sub">no name on machine</span>'}</td>
    <td><span class="tag ${u.privilege === 14 ? 'admin' : ''}">${esc(PRIVILEGE[u.privilege] ?? `Level ${u.privilege}`)}</span></td>
    <td class="mono">${u.card && u.card !== '0' ? esc(u.card) : ''}</td><td>${esc(u.device)}</td><td>${showStamp(u.last_punch)}</td>
  </tr>`).join('') : empty(6, 'No employees yet. Download from the machines on the Machines tab.');
  pager('usersPager', pages.users, cache.users.length, (p) => { pages.users = p; renderUsers(); });
}
async function loadUsers() {
  const r = await call(`/api/users?${query('users')}`).catch((err) => (toast(err.message, 'bad'), null));
  if (!r) return;
  cache.users = r.rows;
  renderUsers();
}

async function loadHistory() {
  const r = await call('/api/history').catch((err) => (toast(err.message, 'bad'), null));
  if (!r) return;
  $('#history').innerHTML = r.rows.length ? r.rows.map((s) => `<tr>
    <td>${showStamp(s.started_at)}</td><td>${esc(s.device)}</td><td>${s.kind === 'auto' ? 'Automatic' : 'Manual'}</td>
    <td>${s.ok ? '<span class="status online">OK</span>' : `<span class="status error">Failed</span><span class="status-msg">${esc(s.message)}</span>`}</td>
    <td class="num">${num(s.users)}</td><td class="num">${num(s.logs)}</td><td class="num">${num(s.new_logs)}</td>
    <td class="num">${s.seconds == null ? '' : s.seconds.toFixed(1)}</td>
  </tr>`).join('') : empty(8, 'No downloads yet.');
}

// Keep the machine list fresh (automatic downloads, other browser tabs).
setInterval(() => {
  if (document.hidden || dialog.open) return;
  loadState().catch(() => {});
}, 15000);

loadState().catch((err) => toast(`Cannot reach the app server: ${err.message}`, 'bad'));
