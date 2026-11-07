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
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text(); let d = null; try { d = JSON.parse(t); } catch (e) {}
  return { status: res.status, data: d, text: t };
}
async function loginUI(cdp, identifier) {
  await cdp.evaluate(`(() => { document.getElementById('authEmail').value=${JSON.stringify(identifier)}; document.getElementById('authPassword').value='password123'; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  return cdp.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 20000);
}
async function freshPage() {
  const cdp = await openPage(BASE + '/');
  await cdp.waitFor('document.readyState === "complete"');
  await cdp.send('Network.clearBrowserCookies');
  await cdp.evaluate('localStorage.clear(); sessionStorage.clear();');
  await cdp.goto(BASE + '/');
  await new Promise(r => setTimeout(r, 900));
  return cdp;
}

(async () => {
  const alexT = (await api('POST', '/api/users/login', null, { identifier: 'alex', password: 'password123' })).data.session_token;
  const rahulT = (await api('POST', '/api/users/login', null, { identifier: 'rahul', password: 'password123' })).data.session_token;

  const g = await api('POST', '/api/groups', alexT, { name: 'UIPAY Audit ' + Date.now(), members: [{ user_id: 2, role: 'member' }] });
  const gid = g.data.id;
  await api('POST', '/api/expenses', alexT, {
    group_id: gid, paid_by: 1, amount: 600, description: 'UI payment base',
    split_type: 'equal', splits: [{ user_id: 1 }, { user_id: 2 }]
  });
  const pr = await api('POST', '/api/upi/create-payment-request', rahulT, { payer_id: 2, receiver_id: 1, group_id: gid, amount: 300 });
  const rid = pr.data.request_id;
  await api('POST', '/api/upi/claim-payment', rahulT, { request_id: rid, utr: 'UIUTR98765432' });

  // ---------- Payer view ----------
  const payer = await freshPage();
  check('payer logs in', await loginUI(payer, 'rahul'));
  await new Promise(r => setTimeout(r, 2500));
  await payer.evaluate(`navigateTo('settle')`);
  await new Promise(r => setTimeout(r, 2500));
  const payerSaw = await payer.waitFor(`(() => {
    const p = document.getElementById('pendingPaymentsPanel');
    const l = document.getElementById('pendingPaymentsList');
    return p && !p.classList.contains('hidden') && l && l.innerText.indexOf('Awaiting receiver') !== -1;
  })()`, 10000);
  const payerPanel = await payer.evaluate(`(() => {
    const p = document.getElementById('pendingPaymentsPanel');
    const l = document.getElementById('pendingPaymentsList');
    return { visible: p && !p.classList.contains('hidden'), text: l ? l.innerText.replace(/\\s+/g,' ') : '', confirmButtons: l ? l.querySelectorAll("button[onclick*='confirmIncomingPayment']").length : 0 };
  })()`);
  const payerRow = await payer.evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('#pendingPaymentsList > div'));
    const row = rows.find(r => r.innerText.indexOf('UIUTR98765432') !== -1);
    return row ? { text: row.innerText.replace(/\\s+/g,' '), confirm: row.querySelectorAll("button[onclick*='confirmIncomingPayment']").length } : null;
  })()`);
  check('payer sees this payment as awaiting receiver', !!payerRow && /Awaiting receiver/i.test(payerRow.text), payerRow ? payerRow.text : 'row missing');
  check('payer has no confirm button on their own outgoing payment', payerRow && payerRow.confirm === 0, 'buttons=' + (payerRow && payerRow.confirm));
  await payer.screenshot(path.join(SHOT_DIR, 'settle-payer-awaiting.png'));

  // ---------- Receiver view ----------
  const receiver = await freshPage();
  check('receiver logs in', await loginUI(receiver, 'alex'));
  await new Promise(r => setTimeout(r, 2500));
  await receiver.evaluate(`navigateTo('settle')`);
  await new Promise(r => setTimeout(r, 2500));
  const receiverSaw = await receiver.waitFor(`(() => {
    const l = document.getElementById('pendingPaymentsList');
    return l && l.innerHTML.indexOf('${rid}') !== -1;
  })()`, 10000);
  const recvPanel = await receiver.evaluate(`(() => {
    const p = document.getElementById('pendingPaymentsPanel');
    const l = document.getElementById('pendingPaymentsList');
    return { visible: p && !p.classList.contains('hidden'), text: l ? l.innerText.replace(/\\s+/g,' ') : '', confirmButtons: l ? l.querySelectorAll("button[onclick*='confirmIncomingPayment']").length : 0, mine: l ? l.querySelectorAll("button[onclick*='${rid}']").length : 0 };
  })()`);
  const receiverRow = await receiver.evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('#pendingPaymentsList > div'));
    const row = rows.find(r => r.innerHTML.indexOf('${rid}') !== -1);
    return row ? { confirm: row.querySelectorAll("button[onclick*='confirmIncomingPayment']").length, reject: row.querySelectorAll("button[onclick*='rejectIncomingPayment']").length } : null;
  })()`);
  check('receiver sees a Confirm Receipt action for this payment',
    receiverSaw && recvPanel.visible && !!receiverRow && receiverRow.confirm === 1 && receiverRow.reject === 1,
    JSON.stringify(receiverRow));
  await receiver.screenshot(path.join(SHOT_DIR, 'settle-receiver-confirm.png'));

  receiver.errors.length = 0;
  await receiver.evaluate(`(() => { const b = document.querySelector("#pendingPaymentsList button[onclick*='${rid}']"); if (b) b.click(); })()`);
  await new Promise(r => setTimeout(r, 3000));
  check('receiver confirm action produces no console errors', receiver.errors.length === 0, receiver.errors.slice(0, 2).join(' | '));

  const bal = await api('GET', `/api/groups/${gid}/balances`, alexT);
  const map = {}; (bal.data || []).forEach(b => map[b.user_id] = b.net_balance);
  check('ledger updates after receiver confirmation', Math.abs(map[2]) < 0.01 && Math.abs(map[1]) < 0.01, JSON.stringify(map));
  const cleared = await receiver.waitFor(`(() => { const l = document.getElementById('pendingPaymentsList'); return !l || l.innerHTML.indexOf('${rid}') === -1; })()`, 10000);
  check('confirmed payment disappears from the pending inbox', cleared);

  // ---------- cleanup ----------
  const c = await pool.connect();
  try {
    await c.query('BEGIN'); await c.query("SET LOCAL session_replication_role='replica'");
    await c.query('DELETE FROM activity_logs WHERE group_id=$1', [gid]);
    await c.query('DELETE FROM chat_messages WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id=$1)', [gid]);
    await c.query('DELETE FROM chat_conversation_members WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id=$1)', [gid]);
    await c.query('DELETE FROM chat_conversations WHERE group_id=$1', [gid]);
    await c.query('DELETE FROM upi_payment_requests WHERE group_id=$1', [gid]);
    await c.query('DELETE FROM settlements WHERE group_id=$1', [gid]);
    await c.query('DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE group_id=$1)', [gid]);
    await c.query('DELETE FROM expenses WHERE group_id=$1', [gid]);
    await c.query('DELETE FROM group_members WHERE group_id=$1', [gid]);
    await c.query('DELETE FROM groups WHERE id=$1', [gid]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); console.error('cleanup', e.message); } finally { c.release(); }

  console.log('\nRESULT:', pass, 'passed,', fail, 'failed');
  if (failures.length) console.log('FAILURES:\n - ' + failures.join('\n - '));
  payer.close(); receiver.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
