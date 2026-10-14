// Integration test of logins, roles, rights and the activity log (Utilities › Users & Roles / Activity Log).
// It MAKES test logins (qa_*) and a few rows in the program it talks to, so it refuses to run unless you name a test copy:
//   ACCESS_TEST_BASE=http://127.0.0.1:3000 ACCESS_TEST_DATASET=om_01_26 ACCESS_TEST_CONFIRM=yes node scripts/test-access-api.mjs
// Optional: ACCESS_TEST_KEY=<the PAYROLL_INTERNAL_KEY the app was started with> also tests the sign-in program's log events.
// The program is called directly with the identity headers the sign-in program would add (the same trust as the real setup).
import assert from 'node:assert/strict';
import http from 'node:http';
const base = process.env.ACCESS_TEST_BASE, dataset = process.env.ACCESS_TEST_DATASET || 'om_01_26';
if (!base || process.env.ACCESS_TEST_CONFIRM !== 'yes') { console.error('Set ACCESS_TEST_BASE (a test copy of the program) and ACCESS_TEST_CONFIRM=yes. This test creates logins and log rows.'); process.exit(2); }
const origin = new URL(base).origin, stamp = Date.now().toString(36).slice(-5);
const names = { admin: 'qa_adm_' + stamp, admin2: 'qa_adm2_' + stamp, user: 'qa_usr_' + stamp, user2: 'qa_usr2_' + stamp, ops: 'qa_ops_' + stamp, resign: 'qa_res_' + stamp,
  big: 'qa_big_' + stamp, pf: 'qa_pf_' + stamp, manp: 'qa_manp_' + stamp, limited: 'qa_lim_' + stamp, hist: 'qa_hist_' + stamp, sal: 'qa_sal_' + stamp,
  addonly: 'qa_add_' + stamp, editonly: 'qa_edt_' + stamp, saladd: 'qa_sadd_' + stamp, saledit: 'qa_sedt_' + stamp };
let passed = 0, failed = 0;

async function call(who, path, { method = 'GET', body, mode = 'editable', headers = {} } = {}) {
  const u = new URL(path, base);
  const h = { 'oai-authenticated-user-id': 'local_seedy', 'oai-authenticated-user-email': 'admin@payroll.local', 'oai-authenticated-user-mode': mode,
    'oai-authenticated-user-path': u.pathname, 'oai-authenticated-user-method': method, ...headers };
  if (who) h['oai-authenticated-user-username'] = who;
  if (method !== 'GET') { h.Origin = origin; h['Content-Type'] = 'application/json'; }
  const r = await fetch(u, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: r.status, json };
}
async function check(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String(e.message).split('\n').join('\n     ')); } }
const ok = (r, code = 200) => assert.equal(r.status, code, JSON.stringify(r.json).slice(0, 300));
const save = (who, user) => call(who, '/api/users', { method: 'POST', body: { action: 'save', user } });
const perms = (modules, extra = {}) => ({ datasets: [dataset], units: ['*'], modules, ...extra });
const pw = 'Test#Pass1234';
const newUser = (username, role, modules, extra = {}) => ({ username, name: 'QA ' + username, role, password: pw, active: true, revision: 0, permissions: perms(modules, extra) });
const bankRights = ['view', 'add', 'edit', 'delete'];
const adminModules = { 'master/bank': bankRights, 'master/department': bankRights, 'reports/muster': ['view'], 'transaction/time': ['view', 'edit'], 'hr/dashboard': [] };
delete adminModules['hr/dashboard'];

(async () => {
  // ---- the Super Admin makes an Admin ----
  await check('Super Admin: identity and an empty list of logins', async () => {
    const me = await call(null, `/api/hr?dataset=${dataset}&view=identity`); ok(me); assert.equal(me.json.identity.role, 'superadmin'); assert.equal(me.json.identity.admin, true);
    const list = await call(null, '/api/users'); ok(list); assert.equal(list.json.me.role, 'superadmin'); assert.ok(Array.isArray(list.json.users));
  });
  await check('Super Admin makes an Admin with chosen rights', async () => { ok(await save(null, newUser(names.admin, 'admin', adminModules))); });
  await check('Another Admin (for the "cannot manage another Admin" test)', async () => { ok(await save(null, newUser(names.admin2, 'admin', { 'master/shift': ['view'] }))); });
  await check('A login ID is unique, whatever the letter case', async () => { ok(await save(null, newUser(names.admin.toUpperCase(), 'user', {})), 409); });
  await check('admin01 is reserved; unknown screens and rights are refused', async () => {
    ok(await save(null, newUser('admin01', 'user', {})), 400);
    ok(await save(null, newUser('qa_x' + stamp, 'user', { 'no/such/screen': ['view'] })), 400);
    ok(await save(null, newUser('qa_y' + stamp, 'user', { 'reports/muster': ['delete'] })), 400);
    ok(await save(null, { ...newUser('qa_z' + stamp, 'user', {}), password: 'short' }), 400);
  });

  // ---- the Admin makes Users, within what the Admin has ----
  await check('Admin: identity shows the role and the given rights; the Admin is not the Super Admin', async () => {
    const me = await call(names.admin, `/api/hr?dataset=${dataset}&view=identity`); ok(me);
    assert.equal(me.json.identity.role, 'admin'); assert.equal(me.json.identity.admin, false); assert.deepEqual(me.json.identity.permissions.modules['reports/muster'], ['view']);
  });
  await check('Admin cannot make an Admin', async () => { const r = await save(names.admin, newUser('qa_nope' + stamp, 'admin', {})); ok(r, 403); assert.match(r.json.error, /Super Admin/); });
  await check('Admin makes a User with part of the Admin\'s rights (view-only bank, no add)', async () => {
    ok(await save(names.admin, newUser(names.user, 'user', { 'master/bank': ['view', 'edit'], 'reports/muster': ['view'], 'transaction/time': ['view'] })));
  });
  await check('Admin cannot give rights, companies or locations the Admin does not have', async () => {
    let r = await save(names.admin, newUser(names.user2, 'user', { 'master/shift': ['view'] })); ok(r, 403); assert.match(r.json.error, /do not have it/);
    r = await save(names.admin, newUser(names.user2, 'user', { 'master/bank': ['view'] }, { datasets: ['*'] })); ok(r, 403);
    r = await save(names.admin, newUser(names.user2, 'user', { 'master/bank': ['view'] }, { datasets: [dataset, 'om_zz_99'] })); ok(r, 403);
  });
  await check('Admin sees the Users but not the Admins; cannot touch an Admin', async () => {
    const list = await call(names.admin, '/api/users'); ok(list);
    const seen = list.json.users.map(u => u.username); assert.ok(seen.includes(names.user)); assert.ok(!seen.includes(names.admin) && !seen.includes(names.admin2));
    assert.equal(list.json.superAdmin, null);
    const other = (await call(null, '/api/users')).json.users.find(u => u.username === names.admin2);
    ok(await call(names.admin, '/api/users', { method: 'POST', body: { action: 'set-active', username: names.admin2, active: false, revision: other.revision } }), 403);
  });
  await check('A User cannot open the user list or make logins', async () => {
    ok(await call(names.user, '/api/users'), 403);
    ok(await save(names.user, newUser('qa_w' + stamp, 'user', {})), 403);
  });
  await check('The role of a login cannot be changed', async () => {
    const u = (await call(names.admin, '/api/users')).json.users.find(x => x.username === names.user);
    ok(await save(names.admin, { ...newUser(names.user, 'admin', {}), password: '', revision: u.revision }), 403);
  });

  // ---- a User works only inside the rights ----
  await check('User: identity, and the master data the User may read', async () => {
    const me = await call(names.user, `/api/hr?dataset=${dataset}&view=identity`); ok(me); assert.equal(me.json.identity.role, 'user');
    ok(await call(names.user, `/api/masters?dataset=${dataset}&table=tbbank`));
    ok(await call(names.user, `/api/masters?dataset=${dataset}&table=tbdep`));     // lookup list
    ok(await call(names.user, `/api/records?dataset=${dataset}`));                  // the base employee list
  });
  await check('Reads follow the rights: a report screen lends the data it builds on; the original source and Monthly Salary Sheets stay closed', async () => {
    ok(await call(names.user, `/api/masters?dataset=${dataset}&table=tbloan`), 200);               // reports/muster + transaction/time build on master data
    ok(await call(names.user, `/api/backup?dataset=${dataset}&month=2026-08&view=salaries`), 200); // ... and on payroll
    ok(await call(names.user, `/api/source?dataset=${dataset}`), 403);                             // the original archive is for the Super Admin only
    ok(await call(names.user, `/api/salary-sheets?dataset=${dataset}&month=2026-08`), 403);       // needs its own screen
    ok(await call(names.admin2, `/api/masters?dataset=${dataset}&table=tbloan`), 403);             // master/shift view only: loans are not its business
  });
  await check('User cannot Add (only View and Edit were given)', async () => {
    const r = await call(names.user, '/api/masters', { method: 'POST', body: { action: 'master-save', table: 'tbbank', dataset, key: null, revision: 0, values: { bank_name: 'QA BANK ' + stamp } } });
    ok(r, 403); assert.match(r.json.error, /Add permission/);
  });
  await check('User cannot Delete, change employees, import, or save attendance (View only)', async () => {
    ok(await call(names.user, '/api/masters', { method: 'POST', body: { action: 'master-delete', table: 'tbbank', dataset, key: 'x', revision: 1 } }), 403);
    ok(await call(names.user, '/api/records', { method: 'POST', body: { action: 'employee-delete', id: crypto.randomUUID(), revision: 1 } }), 403);
    ok(await call(names.user, '/api/full-import', { method: 'POST', body: { action: 'begin' } }), 403);
    ok(await call(names.user, '/api/time-office', { method: 'POST', body: { action: 'attendance-save-many', rows: [] } }), 200); // nothing to save
    ok(await call(names.user, '/api/time-office', { method: 'POST', body: { action: 'register-save-many', dataset, rows: [] } }), 403);
  });
  await check('Admin (with Add/Edit/Delete on Bank) adds, edits and deletes a bank; each is logged', async () => {
    const add = await call(names.admin, '/api/masters', { method: 'POST', body: { action: 'master-save', table: 'tbbank', dataset, key: null, revision: 0, values: { bank_name: 'QA TEST BANK ' + stamp } } }); ok(add);
    const row = add.json.row; assert.ok(row.key);
    const ed = await call(names.admin, '/api/masters', { method: 'POST', body: { action: 'master-save', table: 'tbbank', dataset, key: row.key, revision: row.revision, values: { bank_name: 'QA TEST BANK ' + stamp + ' B' } } }); ok(ed);
    ok(await call(names.admin, '/api/masters', { method: 'POST', body: { action: 'master-delete', table: 'tbbank', dataset, key: row.key, revision: ed.json.row.revision } }));
  });
  await check('A screen\'s rights lend the data class its work needs (attendance for Time Updation, none for Bank)', async () => {
    const attendance = await call(names.admin, `/api/records?dataset=${dataset}&month=2026-08`); ok(attendance);   // transaction/time view
    const payroll = await call(names.admin, `/api/hr-payroll?dataset=${dataset}`); ok(payroll);                  // payroll read for Time Updation
    const bankOnly = names.admin2;                                                                               // master/shift view only
    ok(await call(bankOnly, `/api/records?dataset=${dataset}&month=2026-08`), 403);
    ok(await call(bankOnly, `/api/salary-slips?dataset=${dataset}&month=2026-08`), 403);
  });

  // ---- working flows with the rights of the owning screens (on an employee made by the test itself, removed at the end) ----
  await check('Employee Entry rights add / edit / delete an employee; Time Updation Edit saves its attendance; Resignation Edit may change but not add', async () => {
    ok(await save(null, newUser(names.ops, 'user', { 'master/employee': bankRights, 'transaction/time': ['view', 'edit'] })));
    ok(await save(null, newUser(names.resign, 'user', { 'transaction/resignation': ['view', 'edit'] })));
    const id = crypto.randomUUID(), employee = { id, revision: 0, paycode: 'QA' + stamp.toUpperCase(), name: 'QA TEST EMPLOYEE ' + stamp, dataset, active: true, doj: '2026-01-01', resignDate: '2100-01-01' };
    ok(await call(names.resign, '/api/records', { method: 'POST', body: { action: 'employee-save', data: employee } }), 403);   // adding is Employee Entry's right
    const added = await call(names.ops, '/api/records', { method: 'POST', body: { action: 'employee-save', data: employee } }); ok(added);
    const edited = await call(names.resign, '/api/records', { method: 'POST', body: { action: 'employee-save', data: { ...added.json.record, resignDate: '2026-09-30', fatherName: 'CHANGED BY RESIGNATION', accountNo: '999' } } }); ok(edited);   // Resignation sets the leaving date ...
    assert.equal(edited.json.record.resignDate, '2026-09-30'); assert.equal(edited.json.record.fatherName, ''); assert.equal(edited.json.record.accountNo, '');       // ... and nothing else
    const month = '2026-09', days = Array.from({ length: 30 }, (_, i) => ({ day: i + 1, manualIn: '', manualOut: '', shift: '', first: i % 7 === 0 ? 'WO' : 'P', second: i % 7 === 0 ? 'WO' : 'P', ot: '', late: '' }));
    const att = { employeeId: id, month, revision: 0, days, totals: { worked: '', weeklyOff: '', holiday: '', leave: '', payable: '', absent: '' }, leaveLedger: [] };
    ok(await call(names.ops, '/api/records', { method: 'POST', body: { action: 'attendance-save', data: att } }));
    ok(await call(names.resign, '/api/records', { method: 'POST', body: { action: 'attendance-save', data: { ...att, revision: 1 } } }), 403);    // Resignation does not save attendance
    ok(await call(names.resign, '/api/records', { method: 'POST', body: { action: 'employee-delete', id, revision: edited.json.record.revision } }), 403);
    ok(await call(names.ops, '/api/records', { method: 'POST', body: { action: 'employee-delete', id, revision: edited.json.record.revision } }));
    const s = await call(null, `/api/activity?q=${encodeURIComponent('QA' + stamp.toUpperCase())}`); ok(s);
    assert.ok(['Added employee', 'Changed employee', 'Deleted employee'].every(w => s.json.rows.some(r => r.summary.startsWith(w) && r.summary.includes('QA' + stamp.toUpperCase()))), 'the employee changes are logged with the employee');
  });

  // ---- the activity log ----
  await check('Activity: a User reads the log only when the Activity Log was given to it (then only its own rows); an Admin the Users\' and its own, the Super Admin everything', async () => {
    await call(names.user, '/api/activity', { method: 'POST', body: { event: 'open', screen: 'master/bank', dataset } });
    await call(names.admin, '/api/activity', { method: 'POST', body: { event: 'print', screen: 'reports/muster', dataset } });
    const closed = await call(names.user, '/api/activity?limit=200'); ok(closed, 403); assert.match(closed.json.error, /View permission for Activity Log/);   // not ticked: no menu, no rows
    const me = (await call(names.user, `/api/hr?dataset=${dataset}&view=identity`)).json.identity; assert.equal(me.permissions.modules['utilities/activity'], undefined);
    // the Admin has no tick for the Activity Log itself (an Admin always has it) and may give its View to a User
    const cur = (await call(names.admin, '/api/users')).json.users.find(x => x.username === names.user); assert.equal(cur.manageable, true);
    ok(await save(names.admin, { ...newUser(names.user, 'user', { ...cur.permissions.modules, 'utilities/activity': ['view'] }), password: '', revision: cur.revision }));
    ok(await call(names.admin, '/api/activity'));                                                                              // the Admin reads without a tick
    const u = await call(names.user, '/api/activity?limit=200'); ok(u);
    assert.ok(u.json.rows.length > 0 && u.json.rows.every(r => r.actor === names.user), 'user rows only');
    assert.ok(u.json.rows.some(r => r.kind === 'denied'), 'refused attempts are logged');
    const u2 = await call(names.user, `/api/activity?user=${names.admin}`); ok(u2); assert.equal(u2.json.rows.length, 0);
    const a = await call(names.admin, '/api/activity?limit=500'); ok(a);
    const actorsA = new Set(a.json.rows.map(r => r.actor)); assert.ok(actorsA.has(names.user) && actorsA.has(names.admin)); assert.ok(!actorsA.has('admin01') && !actorsA.has(names.admin2));
    const s = await call(null, '/api/activity?limit=500'); ok(s);
    const actorsS = new Set(s.json.rows.map(r => r.actor)); assert.ok(actorsS.has('admin01') && actorsS.has(names.admin) && actorsS.has(names.user));
    assert.ok(s.json.rows.some(r => r.kind === 'add' && /QA TEST BANK/.test(r.summary)) && s.json.rows.some(r => r.kind === 'delete' && /QA TEST BANK/.test(r.summary)), 'master changes are logged');
    assert.ok(s.json.rows.some(r => r.kind === 'user' && r.summary.includes(names.admin)), 'user management is logged');
    assert.ok(s.json.rows.some(r => r.kind === 'open' && /Bank Entry/.test(r.summary)), 'screen opens are logged');
  });
  await check('Activity: filters (type, text) and the user list of the filter box', async () => {
    const r = await call(null, '/api/activity?kind=denied&limit=100'); ok(r); assert.ok(r.json.rows.length > 0 && r.json.rows.every(x => x.kind === 'denied'));
    const f = await call(null, `/api/activity?q=${encodeURIComponent('QA TEST BANK ' + stamp)}`); ok(f); assert.ok(f.json.rows.length >= 3);
    assert.ok(f.json.users.some(u => u.username === names.user) && f.json.users.some(u => u.username === names.admin));
    const a = await call(names.admin, '/api/activity'); assert.ok(!a.json.users.some(u => u.username === names.admin2));
    ok(await call(null, '/api/activity?kind=bogus'), 400);
  });
  await check('Clients cannot report sign-ins or other people\'s activity', async () => {
    ok(await call(names.user, '/api/activity', { method: 'POST', body: { internal: true, event: 'login', username: 'admin01' } }), 403);
    ok(await call(names.user, '/api/activity', { method: 'POST', body: { event: 'login', screen: '' } }), 400);
  });
  if (process.env.ACCESS_TEST_KEY) await check('The sign-in program (with its key) reports sign-in, failure and sign-out', async () => {
    const k = { 'x-payroll-internal': process.env.ACCESS_TEST_KEY };
    for (const [event, username] of [['login', names.user], ['logout', names.user], ['login-failed', names.user], ['login-failed', 'nobody' + stamp]]) ok(await call(null, '/api/activity', { method: 'POST', headers: k, body: { internal: true, event, username, dataset } }));
    ok(await call(null, '/api/activity', { method: 'POST', headers: { 'x-payroll-internal': 'wrong' }, body: { internal: true, event: 'login', username: 'x' } }), 403);
    const a = await call(names.admin, `/api/activity?user=${names.user}&limit=50`); assert.ok(a.json.rows.some(r => r.kind === 'login-failed'), 'an Admin sees the User\'s failed sign-in');
    const s = await call(null, '/api/activity?q=nobody' + stamp); assert.ok(s.json.rows.some(r => r.kind === 'login-failed' && r.role === ''), 'the Super Admin sees a failed sign-in of an unknown login');
    assert.ok(!(await call(names.admin, '/api/activity?q=nobody' + stamp)).json.rows.length, 'an Admin does not');
    const list = await call(null, '/api/users'); assert.ok(list.json.users.find(u => u.username === names.user).lastLogin, 'last sign-in is shown');
  });

  // ---- sign-in checks, passwords, inactive logins, the original workspace ----
  await check('hr-login (what the sign-in program asks): role and rights come back; a wrong password is refused', async () => {
    const good = await call(null, '/api/hr-login', { method: 'POST', body: { username: names.user, password: pw } }); ok(good);
    assert.equal(good.json.role, 'user'); assert.deepEqual(good.json.permissions.modules['master/bank'], ['view', 'edit']); assert.equal(good.json.permissions.role, undefined);
    ok(await call(null, '/api/hr-login', { method: 'POST', body: { username: names.user, password: 'wrong-password' } }), 401);
  });
  await check('Users change their own password (current one needed); the Admin can reset a User\'s', async () => {
    ok(await call(names.user, '/api/users', { method: 'POST', body: { action: 'change-password', current: 'wrong', password: 'Another#Pass9' } }), 403);
    ok(await call(names.user, '/api/users', { method: 'POST', body: { action: 'change-password', current: pw, password: 'Another#Pass9' } }));
    ok(await call(null, '/api/hr-login', { method: 'POST', body: { username: names.user, password: 'Another#Pass9' } }));
    ok(await call(null, '/api/users', { method: 'POST', body: { action: 'change-password', current: 'x', password: 'Another#Pass9' } }), 400); // the Super Admin's password is not kept here
    const u = (await call(names.admin, '/api/users')).json.users.find(x => x.username === names.user);
    ok(await call(names.admin, '/api/users', { method: 'POST', body: { action: 'reset-password', username: names.user, password: pw, revision: u.revision } }));
    ok(await call(null, '/api/hr-login', { method: 'POST', body: { username: names.user, password: pw } }));
  });
  await check('An inactive login is refused at once and cannot sign in', async () => {
    const u = (await call(names.admin, '/api/users')).json.users.find(x => x.username === names.user);
    ok(await call(names.admin, '/api/users', { method: 'POST', body: { action: 'set-active', username: names.user, active: false, revision: u.revision } }));
    ok(await call(names.user, `/api/masters?dataset=${dataset}&table=tbbank`), 403);
    ok(await call(null, '/api/hr-login', { method: 'POST', body: { username: names.user, password: pw } }), 401);
    const exists = await call(null, `/api/hr-login?username=${names.user}`, { headers: { Origin: origin } }); // the sign-in page asks this before it shows the password box
    ok(exists); assert.equal(exists.json.exists, false);
    const again = (await call(names.admin, '/api/users')).json.users.find(x => x.username === names.user);
    ok(await call(names.admin, '/api/users', { method: 'POST', body: { action: 'set-active', username: names.user, active: true, revision: again.revision } }));
    ok(await call(names.user, `/api/masters?dataset=${dataset}&table=tbbank`));
  });
  await check('The original workspace is read-only for every login', async () => {
    ok(await call(null, '/api/users', { method: 'POST', mode: 'original', body: { action: 'save', user: newUser('qa_orig' + stamp, 'user', {}) } }), 403);
    ok(await call(names.admin, '/api/masters', { method: 'POST', mode: 'original', body: { action: 'master-save', table: 'tbbank', dataset, key: null, revision: 0, values: { bank_name: 'X' } } }), 403);
    ok(await call(names.admin, '/api/activity', { method: 'POST', mode: 'original', body: { event: 'open', screen: 'master/bank', dataset } })); // accepted, not written
  });

  // ---- rules found by the security review ----
  await check('An Admin cannot take over a User that has more than the Admin has (edit, password, activation refused; the list says so)', async () => {
    ok(await save(null, newUser(names.big, 'user', { 'master/bank': ['view'], 'transaction/salary': ['view', 'edit'] })));   // the Admin has no salary rights
    const list = (await call(names.admin, '/api/users')).json.users, big = list.find(u => u.username === names.big);
    assert.equal(big.manageable, false); assert.equal(list.find(u => u.username === names.user).manageable, true);
    ok(await call(names.admin, '/api/users', { method: 'POST', body: { action: 'reset-password', username: names.big, password: pw, revision: big.revision } }), 403);
    ok(await call(names.admin, '/api/users', { method: 'POST', body: { action: 'set-active', username: names.big, active: false, revision: big.revision } }), 403);
    ok(await save(names.admin, { ...newUser(names.big, 'user', { 'master/bank': ['view'] }), password: pw, revision: big.revision }), 403);
    const asSuper = (await call(null, '/api/users')).json.users.find(u => u.username === names.big); assert.equal(asSuper.manageable, true);   // the Super Admin can
  });
  await check('Only the sign-in program asks hr-login: a signed-in Admin / User gets 403 for the password check and the login-ID check', async () => {
    ok(await call(names.user, '/api/hr-login', { method: 'POST', body: { username: names.admin, password: pw } }), 403);
    ok(await call(names.user, `/api/hr-login?username=${names.admin}`, { headers: { Origin: origin } }), 403);
    ok(await call(names.admin, '/api/hr-login', { method: 'POST', body: { username: names.user, password: pw } }), 403);
  });
  await check('A limited login is refused when the request path is not told (the allow-list could not be applied)', async () => {
    ok(await call(names.user, `/api/masters?dataset=${dataset}&table=tbbank`, { headers: { 'oai-authenticated-user-path': '' } }), 403);
    ok(await call(names.user, `/api/masters?dataset=${dataset}&table=tbbank`));
  });
  await check('Images: only photo uploads can be fetched - an HR document that really exists in the file store is not served through /api/images', async () => {
    for (const key of ['local_seedy/hr/x', 'local_seedy/source/x', 'local_seedy/', 'other/00000000-0000-4000-8000-000000000000']) ok(await call(names.user, '/api/images?key=' + encodeURIComponent(key)), 404);
    const employee = { id: crypto.randomUUID(), revision: 0, paycode: 'QD' + stamp.toUpperCase(), name: 'QA DOCUMENT EMPLOYEE ' + stamp, dataset, active: true, doj: '2026-01-01', resignDate: '2100-01-01' };
    const added = await call(names.ops, '/api/records', { method: 'POST', body: { action: 'employee-save', data: employee } }); ok(added);
    const form = new FormData(); form.set('dataset', dataset); form.set('employeeId', employee.id); form.set('category', 'Other HR Document');
    form.set('file', new Blob(['%PDF-1.4\n%QA test document\n%%EOF'], { type: 'application/pdf' }), 'qa-test-' + stamp + '.pdf');
    const up = await fetch(new URL('/api/hr-documents', base), { method: 'POST', body: form, headers: { 'oai-authenticated-user-id': 'local_seedy', 'oai-authenticated-user-email': 'admin@payroll.local', 'oai-authenticated-user-mode': 'editable', 'oai-authenticated-user-path': '/api/hr-documents', 'oai-authenticated-user-method': 'POST', Origin: origin } });
    const made = await up.json(); assert.equal(up.status, 200, JSON.stringify(made)); assert.ok(made.id);
    ok(await call(null, `/api/hr-documents?id=${made.id}`));                                                                                  // the document is there (served by its own route, with the Documents right)
    ok(await call(names.user, `/api/hr-documents?id=${made.id}`), 403);
    for (const who of [names.user, names.ops, null]) ok(await call(who, '/api/images?key=' + encodeURIComponent('local_seedy/hr/' + made.id)), 404);
    const docs = (await call(null, `/api/hr-documents?dataset=${dataset}&includeArchived=0`)).json.documents.find(d => d.id === made.id);
    ok(await call(null, '/api/hr-documents', { method: 'DELETE', body: { id: made.id, revision: docs.revision } }));
    ok(await call(names.ops, '/api/records', { method: 'POST', body: { action: 'employee-delete', id: employee.id, revision: added.json.record.revision } }));
  });
  await check('Biometric: the machine list, machine users and the address test belong to Machine Setup', async () => {
    ok(await call(names.user, `/api/biometric?dataset=${dataset}&view=settings`));                         // Time Updation / reports may read the settings
    ok(await call(names.user, `/api/biometric?dataset=${dataset}&view=state`), 403);
    ok(await call(names.user, `/api/biometric?dataset=${dataset}&view=users`), 403);
    ok(await call(names.user, `/api/biometric?dataset=${dataset}&view=state&url=${encodeURIComponent('http://127.0.0.1:9')}`), 403);
  });
  await check('Reading master data: the salary and personal tables follow the screens that need them (a Manpower login cannot read salary rates)', async () => {
    ok(await save(null, newUser(names.manp, 'user', { 'transaction/manpower': ['view', 'edit'] })));
    const read = t => call(names.manp, `/api/masters?dataset=${dataset}&table=${t}`);
    for (const t of ['tbdep', 'tbcmp', 'tbmanp', 'tbshiftm']) ok(await read(t));                                // lookups, its own table, attendance set-up
    for (const t of ['tbsal', 'tbempsal', 'tbearn', 'tbpfesi', 'tbloan', 'tbmded', 'tbbon', 'tbarrs1', 'tbemp', 'tbemp_fam']) ok(await read(t), 403);
    const company = await read('tbcmp'); assert.ok(company.json.rows.every(r => !r.values.cmp_ph2 && !r.values.cmp_keyph), 'the original passwords of the company are not shown');
    const people = await call(names.manp, `/api/records?dataset=${dataset}`); ok(people);
    const personal = ['fatherName', 'dob', 'phone', 'email', 'pan', 'aadhaar', 'localAddress', 'accountNo', 'ifsc', 'uan', 'esicNo', 'photoKey'];
    assert.ok(people.json.employees.length > 0 && people.json.employees.every(e => personal.every(f => !e[f])), 'personal details are not sent to a login that does not work with them');
    assert.ok(people.json.employees.every(e => e.paycode && e.name), 'names and codes are');
    ok(await call(names.user, `/api/records?dataset=${dataset}`));                                                // reports/muster works with personal details: unchanged shape
  });
  await check('HR records: salary and attendance screens get only the records they work out from (not candidates, campaigns ...)', async () => {
    const made = await call(null, '/api/hr', { method: 'POST', body: { action: 'save', dataset, module: 'campaign', employeeId: '', unit: '', revision: 0, data: { name: 'QA CAMPAIGN ' + stamp, from: '2026-01-01', to: '2026-12-31', budget: 1000 } } }); ok(made);
    const seen = r => r.json.records.map(x => x.module);
    const asSuper = await call(null, `/api/hr-payroll?dataset=${dataset}`); ok(asSuper); assert.ok(seen(asSuper).includes('campaign'), 'the Super Admin gets every record');
    const asTime = await call(names.admin, `/api/hr-payroll?dataset=${dataset}`); ok(asTime);                       // transaction/time view
    assert.ok(!seen(asTime).includes('campaign'), 'a login without the HR right does not get campaign records');
    const allowed = new Set(['shifts', 'holidays', 'salary-profile', 'roster', 'leave-types', 'overtime', 'revision', 'loan', 'loan-payment', 'bonus', 'expenses', 'attendance-approval']);
    assert.ok(seen(asTime).every(m => allowed.has(m)), 'only the records the payroll screens build on: ' + [...new Set(seen(asTime))].join(', '));
    ok(await call(null, '/api/hr', { method: 'POST', body: { action: 'delete', dataset, module: 'campaign', id: made.json.record.id, revision: made.json.record.revision } }));
  });
  await check('Resignation and PF KYC change only their own fields of an employee; PF KYC changes only the KYC columns of the employee details', async () => {
    ok(await save(null, newUser(names.pf, 'user', { 'reports/pf/kyc': ['view', 'edit'] })));
    const id = crypto.randomUUID(), code = 'QP' + stamp.toUpperCase();
    const employee = { id, revision: 0, paycode: code, name: 'QA PF EMPLOYEE ' + stamp, dataset, active: true, doj: '2026-01-01', resignDate: '2100-01-01' };
    const added = await call(names.ops, '/api/records', { method: 'POST', body: { action: 'employee-save', data: employee } }); ok(added);
    const viaPf = await call(names.pf, '/api/records', { method: 'POST', body: { action: 'employee-save', data: { ...added.json.record, pan: 'ABCDE1234F', aadhaar: '123412341234', name: 'CHANGED NAME', resignDate: '2026-01-31', accountNo: '55' } } }); ok(viaPf);
    assert.equal(viaPf.json.record.pan, 'ABCDE1234F'); assert.equal(viaPf.json.record.aadhaar, '123412341234'); assert.equal(viaPf.json.record.name, employee.name); assert.equal(viaPf.json.record.resignDate, '2100-01-01'); assert.equal(viaPf.json.record.accountNo, '');
    ok(await call(names.pf, '/api/records', { method: 'POST', body: { action: 'employee-save', data: { ...employee, id: crypto.randomUUID(), paycode: code + 'X' } } }), 403);   // PF KYC cannot add an employee
    const kyc = await call(names.pf, '/api/masters', { method: 'POST', body: { action: 'master-save', table: 'tbemp', dataset, key: null, revision: 0, values: { emp_code: id, pf_no: 'UAN' + stamp, kyc_name: 'QA KYC', ot_rate: '99', pf_alw: '1', sal_mode: '1' } } }); ok(kyc);
    const row = (await call(names.ops, `/api/masters?dataset=${dataset}&table=tbemp&key=${id}`)).json.rows[0];
    assert.equal(row.values.pf_no, 'UAN' + stamp); assert.equal(row.values.kyc_name, 'QA KYC'); assert.notEqual(row.values.ot_rate, '99'); assert.notEqual(row.values.pf_alw, '1'); assert.notEqual(row.values.sal_mode, '1');
    const again = await call(names.pf, '/api/masters', { method: 'POST', body: { action: 'master-save', table: 'tbemp', dataset, key: row.key, revision: row.revision, values: { emp_code: id, pf_no: 'UAN2' + stamp, ot_rate: '77' } } }); ok(again);
    assert.equal(again.json.row.values.pf_no, 'UAN2' + stamp); assert.equal(again.json.row.values.ot_rate, row.values.ot_rate, 'the other columns keep their stored values');
    ok(await call(names.pf, '/api/masters', { method: 'POST', body: { action: 'master-delete', table: 'tbemp', dataset, key: row.key, revision: again.json.row.revision } }), 403);
    ok(await call(names.ops, '/api/records', { method: 'POST', body: { action: 'employee-delete', id, revision: viaPf.json.record.revision } }));
  });

  // ---- rules found by the second review ----
  await check('Employee salary settings and the HR personal-file report follow the personal / salary screens', async () => {
    ok(await call(names.manp, `/api/employee-extras?dataset=${dataset}`), 403);                     // Manpower Entry has no use for salary settings
    ok(await call(names.user, `/api/employee-extras?dataset=${dataset}`));                          // the reports build on them
    const personalColumns = ['Father / husband', 'DOB', 'Phone', 'Email', 'Address', 'Account', 'IFSC', 'PAN', 'Aadhaar', 'UAN', 'ESIC'];
    const filled = r => { const idx = personalColumns.map(c => r.json.columns.indexOf(c)); assert.ok(idx.every(i => i >= 0), 'the personal columns exist'); return r.json.rows.reduce((n, row) => n + idx.filter(i => row[i]).length, 0); };
    const asSuper = await call(null, `/api/hr-reports?dataset=${dataset}&report=personal-file`); ok(asSuper);
    const asUser = await call(names.user, `/api/hr-reports?dataset=${dataset}&report=personal-file`); ok(asUser);
    const asManp = await call(names.manp, `/api/hr-reports?dataset=${dataset}&report=personal-file`); ok(asManp);
    assert.ok(filled(asSuper) > 0, 'the test company has personal details');
    assert.equal(filled(asUser), filled(asSuper), 'a login with a report screen gets them');
    assert.equal(filled(asManp), 0, 'a Manpower login gets the report with the personal columns empty');
    assert.ok(asManp.json.rows.length > 0 && asManp.json.rows.every(row => row[0] && row[1]), 'but with the codes and names');
  });
  await check('HR change history: an employee profile change (bank, Aadhaar ...) is shown only to a login that works with personal details', async () => {
    ok(await save(null, newUser(names.hist, 'user', { audit: ['view', 'reports'] })));
    const id = crypto.randomUUID(), employee = { id, revision: 0, paycode: 'QH' + stamp.toUpperCase(), name: 'QA HISTORY EMPLOYEE ' + stamp, dataset, active: true, doj: '2026-01-01', resignDate: '2100-01-01', accountNo: '4321' };
    const made = await call(null, '/api/hr', { method: 'POST', body: { action: 'employee-save', dataset, data: employee } }); ok(made);
    const asSuper = await call(null, `/api/hr?dataset=${dataset}&view=audit`); ok(asSuper); assert.ok(asSuper.json.history.some(h => h.module === 'employees' && h.record_id === id), 'the Super Admin sees the change');
    const mine = await call(names.hist, `/api/hr?dataset=${dataset}&view=audit`); ok(mine);
    assert.ok(!mine.json.history.some(h => h.module === 'employees'), 'a History-only login does not see employee profile changes');
    ok(await call(null, '/api/records', { method: 'POST', body: { action: 'employee-delete', id, revision: made.json.record.revision } }));
  });
  await check('An employee made through the HR route or Employee Entry cannot carry an original code (it would take over that employee\'s rows), nor a foreign photo key', async () => {
    const e = { id: crypto.randomUUID(), revision: 0, paycode: 'QS' + stamp.toUpperCase(), name: 'QA SOURCE ' + stamp, dataset, active: true, doj: '2026-01-01', resignDate: '2100-01-01', sourceKey: '7', sourceDataset: dataset };
    ok(await call(names.ops, '/api/hr', { method: 'POST', body: { action: 'employee-save', dataset, data: e } }), 409);
    ok(await call(names.ops, '/api/records', { method: 'POST', body: { action: 'employee-save', data: e } }), 409);
    const plain = { ...e, sourceKey: undefined, sourceDataset: undefined };
    ok(await call(names.ops, '/api/hr', { method: 'POST', body: { action: 'employee-save', dataset, data: { ...plain, photoKey: 'local_seedy/hr/x' } } }), 400);
    ok(await call(names.ops, '/api/records', { method: 'POST', body: { action: 'employee-save', data: { ...plain, signatureKey: 'local_seedy/source/x' } } }), 400);
  });
  await check('A control character in a name does not lose the activity row', async () => {
    const e = { id: crypto.randomUUID(), revision: 0, paycode: 'QZ' + stamp.toUpperCase(), name: 'QA NUL ' + stamp + String.fromCharCode(0) + ' END', dataset, active: true, doj: '2026-01-01', resignDate: '2100-01-01' };
    const added = await call(names.ops, '/api/records', { method: 'POST', body: { action: 'employee-save', data: e } }); ok(added);
    const s = await call(null, `/api/activity?q=${encodeURIComponent('QZ' + stamp.toUpperCase())}`); ok(s);
    assert.ok(s.json.rows.some(r => r.kind === 'add' && r.summary.includes('QA NUL ' + stamp)), 'the add is in the log');
    ok(await call(names.ops, '/api/records', { method: 'POST', body: { action: 'employee-delete', id: e.id, revision: added.json.record.revision } }));
    assert.ok((await call(null, `/api/activity?q=${encodeURIComponent('QZ' + stamp.toUpperCase())}`)).json.rows.some(r => r.kind === 'delete'), 'and the delete');
  });
  await check('Salary Preparation keeps the salary rates and the employee salary settings (its own tabs); other screens cannot', async () => {
    ok(await save(null, newUser(names.sal, 'user', { 'transaction/salary': bankRights })));
    const e = { id: crypto.randomUUID(), revision: 0, paycode: 'QR' + stamp.toUpperCase(), name: 'QA SALARY EMPLOYEE ' + stamp, dataset, active: true, doj: '2026-01-01', resignDate: '2100-01-01' };
    const added = await call(names.ops, '/api/records', { method: 'POST', body: { action: 'employee-save', data: e } }); ok(added);
    const post = (who, table, body) => call(who, '/api/masters', { method: 'POST', body: { table, dataset, ...body } });
    const rate = await post(names.sal, 'tbsal', { action: 'master-save', key: null, revision: 0, values: { emp_code: e.id, e_code: '1', rt1: '100', rt2: '0' } }); ok(rate);
    const setting = await post(names.sal, 'tbempsal', { action: 'master-save', key: null, revision: 0, values: { emp_code: e.id, sal_mode: '0' } }); ok(setting);
    ok(await post(names.sal, 'tbempsal', { action: 'master-delete', key: setting.json.row.key, revision: setting.json.row.revision }));
    ok(await post(names.sal, 'tbsal', { action: 'master-delete', key: rate.json.row.key, revision: rate.json.row.revision }));
    ok(await post(names.manp, 'tbempsal', { action: 'master-save', key: null, revision: 0, values: { emp_code: e.id, sal_mode: '0' } }), 403);
    ok(await post(names.user, 'tbsal', { action: 'master-save', key: null, revision: 0, values: { emp_code: e.id, e_code: '1', rt1: '1', rt2: '0' } }), 403);
    ok(await call(names.ops, '/api/records', { method: 'POST', body: { action: 'employee-delete', id: e.id, revision: added.json.record.revision } }));
  });

  // ---- rules found by the third review ----
  await check('Edit does not create an employee through the HR route; a new employee needs Add (and revision 0)', async () => {
    ok(await save(null, newUser(names.editonly, 'user', { 'master/employee': ['view', 'edit'] })));
    const e = { id: crypto.randomUUID(), revision: 1, paycode: 'QE' + stamp.toUpperCase(), name: 'QA EDIT ONLY ' + stamp, dataset, active: true, doj: '2026-01-01', resignDate: '2100-01-01' };
    ok(await call(names.editonly, '/api/hr', { method: 'POST', body: { action: 'employee-save', dataset, data: e } }), 409);                      // "revision 1" with a fresh id is not an edit
    ok(await call(names.editonly, '/api/hr', { method: 'POST', body: { action: 'employee-save', dataset, data: { ...e, revision: 0 } } }), 403);   // a new employee is Add
    ok(await call(names.editonly, '/api/records', { method: 'POST', body: { action: 'employee-save', data: { ...e, revision: 0 } } }), 403);
  });
  await check('Add does not edit: an Add-only Employee Entry login makes a new employee and its rows, but cannot overwrite a saved row; Edit may add a missing row and change one', async () => {
    ok(await save(null, newUser(names.addonly, 'user', { 'master/employee': ['view', 'add'] })));
    const e = { id: crypto.randomUUID(), revision: 0, paycode: 'QG' + stamp.toUpperCase(), name: 'QA ADD ONLY ' + stamp, dataset, active: true, doj: '2026-01-01', resignDate: '2100-01-01' };
    const added = await call(names.addonly, '/api/records', { method: 'POST', body: { action: 'employee-save', data: e } }); ok(added);
    const post = (who, body) => call(who, '/api/masters', { method: 'POST', body: { table: 'tbsal', dataset, ...body } });
    const rate = await post(names.addonly, { action: 'master-save', key: null, revision: 0, values: { emp_code: e.id, e_code: '1', rt1: '100', rt2: '0' } }); ok(rate);
    ok(await post(names.addonly, { action: 'master-save', key: rate.json.row.key, revision: rate.json.row.revision, values: { emp_code: e.id, e_code: '1', rt1: '999999', rt2: '0' } }), 403);   // overwriting a saved rate is Edit
    ok(await call(names.addonly, '/api/records', { method: 'POST', body: { action: 'employee-save', data: { ...added.json.record, name: 'CHANGED' } } }), 403);
    const asEdit = names.editonly;
    const second = await post(asEdit, { action: 'master-save', key: null, revision: 0, values: { emp_code: e.id, e_code: '2', rt1: '50', rt2: '0' } }); ok(second);   // Edit may add a row that is missing
    const changed = await post(asEdit, { action: 'master-save', key: rate.json.row.key, revision: rate.json.row.revision, values: { emp_code: e.id, e_code: '1', rt1: '120', rt2: '0' } }); ok(changed);
    ok(await post(names.ops, { action: 'master-delete', key: second.json.row.key, revision: second.json.row.revision }));
    ok(await post(names.ops, { action: 'master-delete', key: changed.json.row.key, revision: changed.json.row.revision }));
    ok(await call(names.ops, '/api/records', { method: 'POST', body: { action: 'employee-delete', id: e.id, revision: added.json.record.revision } }));
  });
  await check('Salary: Add makes the salary of a month, Edit changes a saved one (each login can do only its own)', async () => {
    ok(await save(null, newUser(names.saladd, 'user', { 'transaction/salary': ['view', 'add'] })));
    ok(await save(null, newUser(names.saledit, 'user', { 'transaction/salary': ['view', 'edit'] })));
    const e = { id: crypto.randomUUID(), revision: 0, paycode: 'QW' + stamp.toUpperCase(), name: 'QA SALARY MONTHS ' + stamp, dataset, active: true, doj: '2026-01-01', resignDate: '2100-01-01' };
    const added = await call(names.ops, '/api/records', { method: 'POST', body: { action: 'employee-save', data: e } }); ok(added);
    const slip = (month, revision, gross) => ({ employeeId: e.id, month, revision, sourceDataset: 'manual', payableDays: 26, gross, totalDeductions: 0, net: gross, earnings: [{ label: 'BASIC', amount: gross }], deductions: [] });
    const save1 = (who, data) => call(who, '/api/salaries', { method: 'POST', body: { action: 'salary-save', data } });
    const first = await save1(names.saladd, slip('2026-02', 0, 1000)); ok(first);                      // Add: a new month
    ok(await save1(names.saladd, slip('2026-02', first.json.record.revision, 2000)), 403);              // ... but not a saved one
    ok(await save1(names.saledit, slip('2026-03', 0, 1000)), 403);                                      // Edit: not a new month
    const edited = await save1(names.saledit, slip('2026-02', first.json.record.revision, 2000)); ok(edited);   // ... but the saved one
    ok(await call(null, '/api/salaries', { method: 'POST', body: { action: 'salary-delete', employeeId: e.id, month: '2026-02', revision: edited.json.record.revision } }));
    ok(await call(names.ops, '/api/records', { method: 'POST', body: { action: 'employee-delete', id: e.id, revision: added.json.record.revision } }));
  });
  await check('Refused attempts that a deep check rejects (other company, no path, source tables) are written to the log for that login', async () => {
    ok(await call(names.user, `/api/salary-slips?dataset=om_zz_99&month=2026-08`), 403);
    ok(await call(names.user, `/api/source?dataset=${dataset}`), 403);
    ok(await call(names.user, `/api/masters?dataset=${dataset}&table=tbbank`, { headers: { 'oai-authenticated-user-path': '' } }), 403);
    const rows = (await call(null, `/api/activity?user=${names.user}&kind=denied&limit=200`)).json.rows;
    for (const part of ['not assigned to your account', 'do not have access to this function', 'could not be checked']) assert.ok(rows.some(r => r.summary.includes(part)), 'a denied row mentions "' + part + '"');
    assert.ok(rows.some(r => /GET \/api\/salary-slips/.test(r.summary)), 'with the request that was refused');
  });
  await check('The company HR & payroll rules are not sent to a login that has no HR or payroll screen', async () => {
    const current = (await call(null, `/api/hr?dataset=${dataset}&view=settings`)).json;
    const marked = { ...current.settings, hourlyDeductionRate: 77.5 };
    ok(await call(null, '/api/hr', { method: 'POST', body: { action: 'settings-save', dataset, settings: marked, revision: current.revision } }));
    try {
      assert.equal((await call(null, `/api/hr?dataset=${dataset}`)).json.settings.hourlyDeductionRate, 77.5);
      assert.notEqual((await call(names.manp, `/api/hr?dataset=${dataset}`)).json.settings.hourlyDeductionRate, 77.5, 'a Manpower login gets the defaults');
      assert.equal((await call(names.user, `/api/hr?dataset=${dataset}`)).json.settings.hourlyDeductionRate, 77.5, 'a login with a report screen (payroll data) gets them');
    } finally {
      const now = (await call(null, `/api/hr?dataset=${dataset}&view=settings`)).json;
      ok(await call(null, '/api/hr', { method: 'POST', body: { action: 'settings-save', dataset, settings: current.settings, revision: now.revision } }));
    }
  });

  // ---- a login limited to some locations ----
  const everyone = (await call(null, `/api/records?dataset=${dataset}`)).json.employees || [];
  const perLocation = new Map(); for (const e of everyone) if (e.location) perLocation.set(e.location, (perLocation.get(e.location) || 0) + 1);
  const locations = [...perLocation.keys()];
  if (locations.length < 2) console.log('SKIP the location-limited checks: the test company has fewer than two locations');
  else {
    const mine = locations.sort((a, b) => perLocation.get(a) - perLocation.get(b))[0], other = locations.find(l => l !== mine);
    const limitedModules = { 'master/employee': bankRights, 'transaction/time': ['view', 'edit'], 'transaction/salary-delete': ['view', 'delete'], 'reports/muster': ['view'], 'utilities/import': ['view', 'add'], 'reports/monthly-sheets': ['view', 'edit'], 'utilities/biometric': ['view', 'edit'], 'master/holiday': bankRights, 'transaction/loan': bankRights, 'transaction/salary': bankRights, 'master/department': bankRights, 'master/setup': bankRights, settings: ['view', 'edit'] };
    await check('A login limited to one location sees only that location\'s employees and the records kept under their codes', async () => {
      ok(await save(null, newUser(names.limited, 'user', limitedModules, { units: [mine] })));
      const seen = (await call(names.limited, `/api/records?dataset=${dataset}`)).json.employees;
      assert.ok(seen.length > 0 && seen.length < everyone.length && seen.every(e => e.location === mine), 'only the employees of ' + mine);
      const codes = new Set(seen.map(e => String(e.sourceKey || e.id)));
      const superExtras = (await call(null, `/api/employee-extras?dataset=${dataset}`)).json.extras, myExtras = (await call(names.limited, `/api/employee-extras?dataset=${dataset}`)).json.extras;
      assert.ok(Object.keys(myExtras).every(k => codes.has(k)), 'employee-extras'); assert.ok(Object.keys(myExtras).length < Object.keys(superExtras).length, 'employee-extras are fewer');
      for (const table of ['tbsal', 'tbempsal', 'tbemp']) {
        const mineRows = (await call(names.limited, `/api/masters?dataset=${dataset}&table=${table}`)); ok(mineRows);
        assert.ok(mineRows.json.rows.every(r => codes.has(String(r.values.emp_code).trim())), table + ' rows are of the login\'s employees');
      }
      const slips = await call(names.limited, `/api/salary-slips?dataset=${dataset}&month=2026-08`); ok(slips); assert.ok(Object.keys(slips.json.slips).every(k => codes.has(k)), 'salary-slips');
      const punches = await call(names.limited, `/api/time-office?dataset=${dataset}&month=2026-08`); ok(punches); assert.ok(Object.keys(punches.json.punches).every(k => codes.has(k)), 'machine punches');
    });
    await check('It cannot change or delete the employees of another location, nor their salary / shift rows; company-wide functions are closed to it', async () => {
      const stranger = { id: crypto.randomUUID(), revision: 0, paycode: 'QL' + stamp.toUpperCase(), name: 'QA OTHER LOCATION ' + stamp, dataset, active: true, doj: '2026-01-01', resignDate: '2100-01-01', location: other };
      const added = await call(names.ops, '/api/records', { method: 'POST', body: { action: 'employee-save', data: stranger } }); ok(added);
      const real = everyone.find(e => e.location === other);
      ok(await call(names.limited, '/api/records', { method: 'POST', body: { action: 'employee-save', data: real } }), 403);                                  // a real employee of another location
      ok(await call(names.limited, '/api/records', { method: 'POST', body: { action: 'employee-save', data: { ...added.json.record, name: 'TAKEN' } } }), 403);
      ok(await call(names.limited, '/api/records', { method: 'POST', body: { action: 'employee-delete', id: stranger.id, revision: added.json.record.revision } }), 403);
      ok(await call(names.limited, '/api/records', { method: 'POST', body: { action: 'employee-save', data: { ...stranger, id: crypto.randomUUID(), paycode: 'QM' + stamp.toUpperCase() } } }), 403);   // new employee at another location
      ok(await call(names.limited, '/api/masters', { method: 'POST', body: { action: 'master-save', table: 'tbsal', dataset, key: null, revision: 0, values: { emp_code: stranger.id, e_code: '1', rt1: '1', rt2: '0' } } }), 403);   // salary rates of an employee of another location
      ok(await call(names.limited, '/api/masters', { method: 'POST', body: { action: 'master-save', table: 'tbemp_fam', dataset, key: null, revision: 0, values: { emp_code: stranger.id } } }), 403);
      const mineNew = { ...stranger, id: crypto.randomUUID(), paycode: 'QN' + stamp.toUpperCase(), location: mine };
      const own = await call(names.limited, '/api/records', { method: 'POST', body: { action: 'employee-save', data: mineNew } }); ok(own);                  // its own location is fine ...
      ok(await call(names.limited, '/api/records', { method: 'POST', body: { action: 'employee-save', data: { ...own.json.record, location: other } } }), 403);   // ... but it cannot move the employee away
      const loan = await call(names.limited, '/api/masters', { method: 'POST', body: { action: 'master-save', table: 'tbloan', dataset, key: null, revision: 0, values: { emp_code: mineNew.id, ln_date: '2026-01-01', ln_amt: '1000' } } }); ok(loan);
      ok(await call(names.limited, '/api/masters', { method: 'POST', body: { action: 'master-save', table: 'tbloan', dataset, key: loan.json.row.key, revision: loan.json.row.revision, values: { emp_code: stranger.id, ln_date: '2026-01-01', ln_amt: '1000' } } }), 403);   // handing the loan to an employee of another location
      ok(await call(names.limited, '/api/masters', { method: 'POST', body: { action: 'master-delete', table: 'tbloan', dataset, key: loan.json.row.key, revision: loan.json.row.revision } }));
      ok(await call(names.limited, '/api/masters', { method: 'POST', body: { action: 'master-save', table: 'tbholi', dataset, key: null, revision: 0, values: { h_name: 'QA ORIGINAL HOLIDAY', h_date: '2026-12-25' } } }), 403);   // company-wide set-ups
      ok(await call(names.limited, '/api/masters', { method: 'POST', body: { action: 'master-save', table: 'tbsalrule', dataset, key: null, revision: 0, values: { div: '30', esi_round: 'ceil' } } }), 403);
      ok(await call(names.limited, '/api/masters', { method: 'POST', body: { action: 'master-save', table: 'tbdep', dataset, key: null, revision: 0, values: { dep_name: 'QA DEPARTMENT ' + stamp, tdh_code: '1' } } }), 403);   // every set-up of the company, not only the holidays
      ok(await call(names.limited, '/api/masters', { method: 'POST', body: { action: 'master-save', table: 'tbpfesi', dataset, key: null, revision: 0, values: { pf_ac1_pee: '0' } } }), 403);
      ok(await call(names.limited, '/api/hr', { method: 'POST', body: { action: 'settings-save', dataset, settings: {}, revision: 0 } }), 403);                         // the company HR & payroll rules
      const rules = await call(names.limited, `/api/hr?dataset=${dataset}&view=settings`); ok(rules);                                                                // reading them is fine
      ok(await call(names.limited, '/api/records', { method: 'POST', body: { action: 'employee-delete', id: mineNew.id, revision: own.json.record.revision } }));
      ok(await call(names.limited, '/api/full-import', { method: 'POST', body: { action: 'begin' } }), 403);
      ok(await call(names.limited, `/api/salary-sheets?dataset=${dataset}&month=2026-08`), 403);
      ok(await call(names.limited, `/api/biometric?dataset=${dataset}&view=state`), 403);
      ok(await call(names.limited, '/api/biometric', { method: 'POST', body: { action: 'save-map', dataset, revision: 0, map: {} } }), 403);
      const holiday = { id: crypto.randomUUID(), revision: 0, dataset, code: 'QH' + stamp, name: 'QA HOLIDAY ' + stamp, date: '2026-12-25', type: 'Others', locations: [] };
      ok(await call(names.limited, '/api/records', { method: 'POST', body: { action: 'holiday-save', data: holiday } }), 403);                                  // "all locations" is not its to change
      const made = await call(names.limited, '/api/records', { method: 'POST', body: { action: 'holiday-save', data: { ...holiday, locations: [mine] } } }); ok(made);
      ok(await call(names.limited, '/api/records', { method: 'POST', body: { action: 'holiday-save', data: { ...made.json.record, locations: [mine, other] } } }), 403);
      ok(await call(names.limited, '/api/records', { method: 'POST', body: { action: 'holiday-delete', id: holiday.id, revision: made.json.record.revision } }));
      ok(await call(names.ops, '/api/records', { method: 'POST', body: { action: 'employee-delete', id: stranger.id, revision: added.json.record.revision } }));
    });
    await check('Biometric matches: a login limited to some locations gets only the machine-user matches of its own employees', async () => {
      const settings = who => call(who, `/api/biometric?dataset=${dataset}&view=settings`);
      const before = (await settings(null)).json, foreign = everyone.find(e => e.location === other), own = everyone.find(e => e.location === mine);
      ok(await call(null, '/api/biometric', { method: 'POST', body: { action: 'save-map', dataset, revision: before.revisions.map, map: { ...before.map, ['QA' + stamp]: foreign.id, ['QB' + stamp]: own.id, ['QC' + stamp]: '-' } } }));
      try {
        const limited = (await settings(names.limited)).json;
        assert.equal(limited.map['QB' + stamp], own.id); assert.equal(limited.map['QC' + stamp], '-'); assert.equal(limited.map['QA' + stamp], undefined, 'no match of an employee of another location');
        assert.equal((await settings(null)).json.map['QA' + stamp], foreign.id, 'the Super Admin gets all of them');
      } finally {
        const now = (await settings(null)).json; ok(await call(null, '/api/biometric', { method: 'POST', body: { action: 'save-map', dataset, revision: now.revisions.map, map: before.map } }));
      }
    });
    await check('Biometric punches: a machine ID that an employee of another location also carries is not given to this location\'s login (a forged card number does not help)', async () => {
      const victimId = 'QX1' + stamp.toUpperCase(), ownId = 'QX2' + stamp.toUpperCase();
      const csv = 'User ID,Name,Date Time,Machine,Verify Mode,Punch\n' + [[victimId, 'VICTIM', '2026-08-05 09:00:00'], [ownId, 'OWN', '2026-08-05 09:05:00']].map(r => `"${r[0]}","${r[1]}","${r[2]}","M1","",""`).join('\n') + '\n';
      const fake = http.createServer((req, res) => {   // stands in for the Biometric Attendance app
        if (req.url.startsWith('/api/export/logs')) { res.writeHead(200, { 'Content-Type': 'text/csv' }); res.end(csv); }
        else if (req.url.startsWith('/api/state')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ devices: [], autoMinutes: 0, totals: { logs: 2, people: 2, first: null, last: null } })); }
        else { res.writeHead(404); res.end(); }
      });
      await new Promise(r => fake.listen(0, '127.0.0.1', r));
      const settings = () => call(null, `/api/biometric?dataset=${dataset}&view=settings`), before = (await settings()).json;
      ok(await call(null, '/api/biometric', { method: 'POST', body: { action: 'save-config', dataset, revision: before.revisions.config, config: { url: 'http://127.0.0.1:' + fake.address().port, devices: [] } } }));
      const made = [];
      const person = async (who, extra) => { const e = { id: crypto.randomUUID(), revision: 0, dataset, active: true, doj: '2026-01-01', resignDate: '2100-01-01', ...extra }; const r = await call(who, '/api/records', { method: 'POST', body: { action: 'employee-save', data: e } }); ok(r); made.push([who, r.json.record]); };
      try {
        await person(names.ops, { paycode: 'QV' + stamp.toUpperCase(), name: 'QA VICTIM ' + stamp, location: other, cardNo: victimId });
        await person(names.limited, { paycode: 'QO' + stamp.toUpperCase(), name: 'QA OWN CARD ' + stamp, location: mine, cardNo: ownId });
        await person(names.limited, { paycode: 'QF' + stamp.toUpperCase(), name: 'QA FORGED ' + stamp, location: mine, cardNo: victimId, doj: '2026-02-01' });   // the forged duplicate
        const punches = who => call(who, `/api/biometric?dataset=${dataset}&view=punches&from=2026-08-01&to=2026-08-31`);
        const everybody = await punches(null); ok(everybody); assert.ok(everybody.json.users[victimId] && everybody.json.users[ownId], 'the Super Admin gets both machine users');
        const limited = await punches(names.limited); ok(limited);
        assert.ok(limited.json.users[ownId], 'the login gets the punches of its own employee'); assert.equal(limited.json.users[victimId], undefined, 'but not those of a card that an employee elsewhere carries');
        assert.equal(limited.json.punches, limited.json.users[ownId].t.length, 'and the count follows');
      } finally {
        for (const [who, rec] of made) await call(who, '/api/records', { method: 'POST', body: { action: 'employee-delete', id: rec.id, revision: rec.revision } });
        const now = (await settings()).json; ok(await call(null, '/api/biometric', { method: 'POST', body: { action: 'save-config', dataset, revision: now.revisions.config, config: before.config } }));
        await new Promise(r => fake.close(r));
      }
    });
  }
  await check('Company lists follow the login; salary deletion for a whole month needs its right and an assigned company', async () => {
    const mine = await call(names.user, '/api/companies'); ok(mine); assert.ok(mine.json.companies.length > 0 && mine.json.companies.every(c => c.key === dataset), 'only the assigned company');
    assert.ok((await call(null, '/api/companies')).json.companies.length >= mine.json.companies.length);
    ok(await call(names.user, '/api/salaries', { method: 'POST', body: { action: 'salary-delete-month', dataset, month: '2026-08' } }), 403);                     // View only
    ok(await call(names.user, '/api/salaries', { method: 'POST', body: { action: 'salary-delete-month', dataset: 'om_zz_99', month: '2026-08' } }), 403);           // not its company
    assert.ok((await call(names.admin, '/api/hr?dataset=' + dataset + '&view=identity')).json.identity, 'identity stays readable');
  });

  // ---- tidy up: the test logins are made inactive (a login is never deleted) ----
  for (const n of Object.values(names)) {
    const u = (await call(null, '/api/users')).json.users?.find(x => x.username === n);
    if (u?.active) await call(null, '/api/users', { method: 'POST', body: { action: 'set-active', username: n, active: false, revision: u.revision } });
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
