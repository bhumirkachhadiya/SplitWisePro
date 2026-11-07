const path = require('path');
const { openPage } = require('./cdp-lib');
const { pool } = require('../../db');
const BASE = 'http://127.0.0.1:5000';
const SHOT_DIR = path.join(__dirname, 'shots');
let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('FAIL  ' + name + (detail ? '  — ' + detail : '')); }
}
async function api(method, p, token, body) {
  const h = { 'Content-Type': 'application/json' }; if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch (e) {}
  return { status: r.status, data: d, text: t };
}
(async () => {
  const alexT = (await api('POST', '/api/users/login', null, { identifier: 'alex', password: 'password123' })).data.session_token;
  const rahulT = (await api('POST', '/api/users/login', null, { identifier: 'rahul', password: 'password123' })).data.session_token;
  const g = await api('POST', '/api/groups', alexT, { name: 'MODAL Status ' + Date.now(), members: [{ user_id: 2 }, { user_id: 3 }] });
  const gid = g.data.id;
  await api('POST', '/api/expenses', alexT, {
    group_id: gid, paid_by: 1, amount: 1500, description: 'Modal status dinner',
    split_type: 'equal', splits: [{ user_id: 1 }, { user_id: 2 }, { user_id: 3 }]
  });

  const cdp = await openPage(BASE + '/');
  await cdp.waitFor('document.readyState === "complete"');
  await cdp.send('Network.clearBrowserCookies');
  await cdp.evaluate('localStorage.clear(); sessionStorage.clear();');
  await cdp.goto(BASE + '/');
  await new Promise(r => setTimeout(r, 900));
  await cdp.evaluate(`(() => { document.getElementById('authEmail').value='alex'; document.getElementById('authPassword').value='password123'; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  await cdp.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 20000);
  await new Promise(r => setTimeout(r, 2500));
  cdp.errors.length = 0;
  await cdp.evaluate(`openGroupExpensesModal(${gid})`);
  await new Promise(r => setTimeout(r, 2500));

  const read = async () => cdp.evaluate(`(() => ({
    spend: document.getElementById('groupExpensesSummarySpend').innerText,
    paid: document.getElementById('groupExpensesSummaryPaid').innerText,
    pending: document.getElementById('groupExpensesSummaryPending').innerText,
    text: document.getElementById('groupExpensesModalList').innerText.replace(/\\s+/g,' '),
    statuses: Array.from(document.querySelectorAll('#groupExpensesModalList tbody tr')).map(tr => tr.children[2] ? tr.children[2].innerText.trim() : '')
  }))()`);
  const before = await read();
  check('modal spend total is ₹1,500.00', before.spend.includes('1,500.00'), before.spend);
  check('modal paid total is ₹500.00 (payer share only)', before.paid.includes('500.00'), before.paid);
  check('modal pending total is ₹1,000.00', before.pending.includes('1,000.00'), before.pending);
  check('new expense shows payer Paid and others Pending', before.statuses.filter(s => s === '✓ Paid').length === 1 && before.statuses.filter(s => s === 'Pending').length === 2, JSON.stringify(before.statuses));
  check('modal flow has no console errors', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));
  await cdp.screenshot(path.join(SHOT_DIR, 'expense-status-new.png'));

  // Partial payment of 200 by Rahul, then reopen
  await api('POST', '/api/settlements', rahulT, { group_id: gid, payer_id: 2, receiver_id: 1, amount: 200 });
  await cdp.evaluate(`closeGroupExpensesModal()`);
  await new Promise(r => setTimeout(r, 300));
  await cdp.evaluate(`openGroupExpensesModal(${gid})`);
  await new Promise(r => setTimeout(r, 2500));
  const after = await read();
  check('partial payment updates paid total to ₹700.00', after.paid.includes('700.00'), after.paid);
  check('partial payment updates pending total to ₹800.00', after.pending.includes('800.00'), after.pending);
  check('partially paid member is labelled Paid ₹200.00', after.statuses.some(s => /Paid ₹200\.00/.test(s)), JSON.stringify(after.statuses));
  await cdp.screenshot(path.join(SHOT_DIR, 'expense-status-partial.png'));

  const c = await pool.connect();
  try {
    await c.query('BEGIN'); await c.query("SET LOCAL session_replication_role='replica'");
    await c.query('DELETE FROM activity_logs WHERE group_id=$1', [gid]);
    await c.query('DELETE FROM chat_messages WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id=$1)', [gid]);
    await c.query('DELETE FROM chat_conversation_members WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id=$1)', [gid]);
    await c.query('DELETE FROM chat_conversations WHERE group_id=$1', [gid]);
    await c.query('DELETE FROM settlements WHERE group_id=$1', [gid]);
    await c.query('DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE group_id=$1)', [gid]);
    await c.query('DELETE FROM expenses WHERE group_id=$1', [gid]);
    await c.query('DELETE FROM group_members WHERE group_id=$1', [gid]);
    await c.query('DELETE FROM groups WHERE id=$1', [gid]);
    await c.query('COMMIT');
  } catch (err) { await c.query('ROLLBACK'); console.error('cleanup', err.message); } finally { c.release(); }

  console.log('\nRESULT:', pass, 'passed,', fail, 'failed');
  if (failures.length) console.log('FAILURES:\n - ' + failures.join('\n - '));
  cdp.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
