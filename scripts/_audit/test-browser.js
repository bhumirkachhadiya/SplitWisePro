const fs = require('fs');
const path = require('path');
const { openPage } = require('./cdp-lib');
const { pool } = require('../../db');

const BASE = 'http://127.0.0.1:5000';
const SHOT_DIR = path.join(__dirname, 'shots');
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('FAIL  ' + name + (detail ? '  — ' + detail : '')); }
}

async function api(method, p, token, body) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text(); let d = null; try { d = JSON.parse(t); } catch (e) {}
  return { status: res.status, data: d, text: t };
}

(async () => {
  const login = await api('POST', '/api/users/login', null, { identifier: 'alex', password: 'password123' });
  const token = login.data.session_token;
  const gname = 'BROWSER Circle ' + Date.now();
  const g = await api('POST', '/api/groups', token, {
    name: gname, description: 'browser e2e', category: 'Test',
    members: [{ user_id: 2, role: 'editor' }, { user_id: 3, role: 'member' }]
  });
  const gid = g.data.id;
  console.log('test circle', gid, gname);

  const cdp = await openPage(BASE + '/');
  await cdp.waitFor('document.readyState === "complete"');
  // Start from a guaranteed logged-out state (cookies + storage).
  await cdp.send('Network.clearBrowserCookies');
  await cdp.evaluate('localStorage.clear(); sessionStorage.clear();');
  await cdp.goto(BASE + '/');
  await cdp.waitFor('document.readyState === "complete"');
  await new Promise(r => setTimeout(r, 1200));

  const authVisible = await cdp.evaluate('!document.getElementById("authScreen").classList.contains("hidden")');
  check('auth screen visible for logged-out visitor', authVisible);
  const workspaceHidden = await cdp.evaluate('document.getElementById("appWorkspace").classList.contains("hidden")');
  check('workspace hidden before login', workspaceHidden);

  // ---- Login through the real UI ----
  await cdp.evaluate(`(() => {
    const e = document.getElementById('authEmail'); e.value = 'alex'; e.dispatchEvent(new Event('input',{bubbles:true}));
    const p = document.getElementById('authPassword'); p.value = 'password123'; p.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('authSubmitBtn').click();
  })()`);
  const loggedIn = await cdp.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 20000);
  check('UI login succeeds', loggedIn);
  await new Promise(r => setTimeout(r, 2000));
  const dashboardText = await cdp.evaluate('document.getElementById("appWorkspace").innerText.slice(0,300)');
  check('dashboard renders content', /dashboard|balance|owe|group/i.test(dashboardText), dashboardText.replace(/\s+/g, ' ').slice(0, 80));

  // ---- Session survives a page refresh ----
  cdp.errors.length = 0;
  await cdp.goto(BASE + '/');
  const restored = await cdp.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 15000);
  await new Promise(r => setTimeout(r, 1500));
  check('session survives a full page refresh', restored && cdp.errors.length === 0, 'errors=' + cdp.errors.slice(0, 2).join(' | '));

  // ---- Navigate every main view ----
  const views = ['dashboard', 'expenses', 'groups', 'settle', 'analytics', 'activity', 'friends', 'chat', 'add-expense'];
  for (const v of views) {
    cdp.errors.length = 0;
    const ok = await cdp.evaluate(`(function(){ try { navigateTo('${v}'); return true; } catch(e){ return String(e); } })()`);
    await new Promise(r => setTimeout(r, 900));
    const visible = await cdp.evaluate(`(() => { const el=document.querySelector('[data-view-panel="${v}"]'); return el ? !el.classList.contains('hidden') : true; })()`);
    check(`view "${v}" opens without runtime errors`, ok === true && cdp.errors.length === 0, 'ok=' + ok + ' errors=' + cdp.errors.slice(0, 2).join(' | '));
  }

  // ---- Add expense through the UI (Shares method) ----
  await cdp.evaluate(`navigateTo('add-expense')`);
  await new Promise(r => setTimeout(r, 1200));
  await cdp.evaluate(`(() => {
    const gs = document.getElementById('newExpenseGroup');
    gs.value = '${gid}';
    gs.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await new Promise(r => setTimeout(r, 1200));
  const memberRows = await cdp.evaluate('document.querySelectorAll(".member-split-row").length');
  check('split engine lists circle members', memberRows >= 3, 'rows=' + memberRows);

  await cdp.evaluate(`(() => {
    document.getElementById('newExpenseAmount').value = '1000';
    document.getElementById('newExpenseDesc').value = 'Browser Shares Test';
    document.getElementById('selectedCategory').value = 'Food & Drinks';
    // keep only alex and rahul as participants
    document.querySelectorAll('.member-split-row').forEach(r => {
      const uid = r.getAttribute('data-user-id');
      const cb = r.querySelector('.split-cb');
      cb.checked = (uid === '1' || uid === '2');
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
    setSplitMode('SHARES');
  })()`);
  await new Promise(r => setTimeout(r, 500));
  const shareInputs = await cdp.evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('.member-split-row')).filter(r => r.querySelector('.split-cb').checked);
    rows.forEach((r, i) => {
      const inp = r.querySelector('.split-custom-input');
      inp.value = (i === 0 ? '3' : '1');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return rows.map(r => ({ uid: r.getAttribute('data-user-id'), val: r.querySelector('.split-custom-input').value, preview: r.querySelector('.split-preview-amount').innerText }));
  })()`);
  check('Shares UI recalculates previews', Array.isArray(shareInputs) && shareInputs.every(s => /₹/.test(s.preview)), JSON.stringify(shareInputs));
  await cdp.screenshot(path.join(SHOT_DIR, 'add-expense-shares.png'));

  cdp.errors.length = 0;
  await cdp.evaluate(`document.getElementById('addExpenseSubmitBtn').click()`);
  await new Promise(r => setTimeout(r, 3000));
  const successVisible = await cdp.evaluate('!document.getElementById("addExpenseSuccessAlert").classList.contains("hidden")');
  check('Shares expense saved from UI', successVisible && cdp.errors.length === 0, 'errors=' + cdp.errors.slice(0, 2).join(' | '));

  // Verify DB/API
  const expenses = await api('GET', '/api/expenses?groupId=' + gid, token);
  const created = (expenses.data || []).find(e => e.description === 'Browser Shares Test');
  check('UI-created expense persisted', !!created, created ? 'id=' + created.id : 'not found');
  if (created) {
    const detail = await api('GET', '/api/expenses/' + created.id, token);
    const amountByUser = {};
    (detail.data.splits || []).forEach(s => amountByUser[s.user_id] = Number(s.amount));
    check('Shares 3:1 produced 750/250 exactly',
      amountByUser[1] === 750 && amountByUser[2] === 250 && (detail.data.splits || []).length === 2,
      JSON.stringify(amountByUser));
  }

  // ---- Dark mode ----
  await cdp.evaluate(`navigateTo('dashboard')`);
  await new Promise(r => setTimeout(r, 600));
  await cdp.evaluate(`applyTheme('dark')`);
  await new Promise(r => setTimeout(r, 500));
  const dark = await cdp.evaluate('document.documentElement.classList.contains("dark")');
  check('dark mode applies', dark);
  await cdp.screenshot(path.join(SHOT_DIR, 'dashboard-dark.png'));
  await cdp.evaluate(`applyTheme('light')`);

  // ---- Mobile responsive check across views ----
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await new Promise(r => setTimeout(r, 500));
  for (const v of ['dashboard', 'expenses', 'groups', 'settle', 'add-expense']) {
    await cdp.evaluate(`navigateTo('${v}')`);
    await new Promise(r => setTimeout(r, 800));
    const overflow = await cdp.evaluate('document.documentElement.scrollWidth - window.innerWidth');
    check(`mobile 390px "${v}" has no horizontal overflow`, overflow <= 2, 'overflow=' + overflow + 'px');
  }
  await cdp.evaluate(`navigateTo('dashboard')`);
  await new Promise(r => setTimeout(r, 600));
  await cdp.screenshot(path.join(SHOT_DIR, 'dashboard-mobile.png'));
  await cdp.send('Emulation.clearDeviceMetricsOverride');

  // ---- Tablet ----
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true });
  await new Promise(r => setTimeout(r, 600));
  const tabletOverflow = await cdp.evaluate('document.documentElement.scrollWidth - window.innerWidth');
  check('tablet 768px has no horizontal overflow', tabletOverflow <= 2, 'overflow=' + tabletOverflow);
  await cdp.screenshot(path.join(SHOT_DIR, 'dashboard-tablet.png'));
  await cdp.send('Emulation.clearDeviceMetricsOverride');

  // ---- Logout through UI ----
  await new Promise(r => setTimeout(r, 500));
  const logoutOk = await cdp.evaluate(`(function(){ try { handleLogout(); return true; } catch(e){ return String(e); } })()`);
  await new Promise(r => setTimeout(r, 800));
  const backToAuth = await cdp.evaluate('!document.getElementById("authScreen").classList.contains("hidden")');
  check('logout returns to auth screen', logoutOk === true && backToAuth);

  console.log('\nBrowser console errors captured:', cdp.errors.length);
  if (cdp.errors.length) console.log(cdp.errors.slice(0, 10).join('\n'));
  console.log('Browser warnings captured:', cdp.warnings.length);

  console.log('\nRESULT:', pass, 'passed,', fail, 'failed');
  if (failures.length) console.log('FAILURES:\n - ' + failures.join('\n - '));

  cdp.close();
  // cleanup
  try {
    await pool.query('DELETE FROM activity_logs WHERE group_id = $1', [gid]);
    await pool.query('DELETE FROM chat_conversation_members WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id = $1)', [gid]);
    await pool.query('DELETE FROM chat_messages WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id = $1)', [gid]);
    await pool.query('DELETE FROM chat_conversations WHERE group_id = $1', [gid]);
    await pool.query('DELETE FROM settlements WHERE group_id = $1', [gid]);
    await pool.query('DELETE FROM upi_payment_requests WHERE group_id = $1', [gid]);
    await pool.query('DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = $1)', [gid]);
    await pool.query('DELETE FROM expense_corrections WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = $1)', [gid]);
    await pool.query('DELETE FROM expenses WHERE group_id = $1', [gid]);
    await pool.query('DELETE FROM group_members WHERE group_id = $1', [gid]);
    await pool.query('DELETE FROM groups WHERE id = $1', [gid]);
    console.log('cleaned up test circle', gid);
  } catch (e) { console.error('cleanup', e.message); }

  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
