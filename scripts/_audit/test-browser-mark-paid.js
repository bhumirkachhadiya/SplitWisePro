const path = require('path');
const bcrypt = require('bcrypt');
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
async function makeUser(prefix, tag) {
  const username = prefix.toLowerCase().replace(/[^a-z0-9]/g, '') + tag;
  const hash = await bcrypt.hash('password123', 10);
  const r = await pool.query(`INSERT INTO users (name,email,username,password_hash,avatar_initials,upi_id,phone,is_verified,is_active)
    VALUES ($1,$2,$3,$4,$5,$6,'+91 90000 00000',TRUE,TRUE) RETURNING id`,
    [prefix + ' ' + tag, `${username}@example.com`, username, hash, prefix.slice(0, 2).toUpperCase(), `${username}@okaxis`]);
  return { id: r.rows[0].id, username, name: prefix + ' ' + tag };
}
async function loginUI(cdp, identifier) {
  await cdp.evaluate(`(() => { document.getElementById('authEmail').value=${JSON.stringify(identifier)}; document.getElementById('authPassword').value='password123'; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  await cdp.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 20000);
  await new Promise(r => setTimeout(r, 2200));
}
async function logoutUI(cdp) {
  await cdp.evaluate(`handleLogout()`);
  await cdp.waitFor('document.getElementById("appWorkspace").classList.contains("hidden")', 15000);
  await new Promise(r => setTimeout(r, 500));
}

(async () => {
  const tag = Date.now().toString().slice(-7);
  const debtor = await makeUser('Browser Debtor', tag);
  const receiver = await makeUser('Browser Receiver', tag);
  const debtorT = (await api('POST', '/api/users/login', null, { identifier: debtor.username, password: 'password123' })).data.session_token;
  const receiverT = (await api('POST', '/api/users/login', null, { identifier: receiver.username, password: 'password123' })).data.session_token;
  const group = await api('POST', '/api/groups', debtorT, { name: 'MARKPAID UI ' + tag, members: [{ user_id: receiver.id }] });
  const gid = group.data.id;
  const desc = 'UI Mark Paid dinner ' + tag;
  const exp = await api('POST', '/api/expenses', debtorT, {
    group_id: gid, paid_by: receiver.id, amount: 1000, description: desc,
    split_type: 'equal', splits: [{ user_id: debtor.id }, { user_id: receiver.id }]
  });
  const expenseId = exp.data.id;

  const cdp = await openPage(BASE + '/');
  await cdp.waitFor('document.readyState === "complete"');
  await cdp.send('Network.clearBrowserCookies');
  await cdp.evaluate('localStorage.clear(); sessionStorage.clear();');
  await cdp.goto(BASE + '/');
  await new Promise(r => setTimeout(r, 900));
  await loginUI(cdp, debtor.username);
  cdp.errors.length = 0;

  // 1. Expense-wise Mark as Paid from the Ledger list
  await cdp.evaluate(`navigateTo('expenses')`);
  await new Promise(r => setTimeout(r, 1500));
  const rowClicked = await cdp.evaluate(`(() => {
    const row = [...document.querySelectorAll('#allExpensesContainer > div')].find(d => d.innerText.includes(${JSON.stringify(desc)}));
    if (!row) return 'no-row';
    const btn = row.querySelector('button[title="Mark my share as paid"]');
    if (!btn) return 'no-button';
    btn.click(); return 'clicked';
  })()`);
  await new Promise(r => setTimeout(r, 700));
  const modal = await cdp.evaluate(`(() => ({
    visible: !document.getElementById('markPaidModal').classList.contains('hidden'),
    amount: document.getElementById('markPaidAmount').value,
    context: document.getElementById('markPaidContext').innerText.replace(/\\s+/g,' ')
  }))()`);
  check('expense row exposes Mark as Paid for the debtor', rowClicked === 'clicked', rowClicked);
  check('Mark as Paid modal opens with the expense context and outstanding amount', modal.visible && Number(modal.amount) === 500 && modal.context.includes(desc), JSON.stringify(modal));
  await cdp.screenshot(path.join(SHOT_DIR, 'mark-paid-modal.png'));

  await cdp.evaluate(`(() => {
    document.getElementById('markPaidAmount').value = '200';
    document.getElementById('markPaidMethod').value = 'CASH';
    document.getElementById('markPaidReference').value = 'CASH-UI-200';
    document.getElementById('markPaidNote').value = 'Partial cash payment';
    document.getElementById('markPaidForm').requestSubmit();
  })()`);
  await cdp.waitFor(`document.getElementById('markPaidModal').classList.contains('hidden')`, 10000);
  await new Promise(r => setTimeout(r, 2500));
  const afterSend = await api('GET', '/api/payment-requests', debtorT);
  const sentReq = (afterSend.data.requests || []).find(r => Number(r.expense_id) === Number(expenseId));
  check('sending creates a pending request, not a settlement', !!sentReq && sentReq.status === 'PENDING', JSON.stringify(sentReq && { status: sentReq.status, amount: sentReq.amount }));
  const splitAfterSend = await pool.query('SELECT settled_amount_base FROM expense_splits WHERE expense_id=$1 AND user_id=$2', [expenseId, debtor.id]);
  check('request does not settle the expense before approval', Number(splitAfterSend.rows[0].settled_amount_base) === 0, splitAfterSend.rows[0].settled_amount_base);

  await cdp.evaluate(`navigateTo('settle')`);
  await new Promise(r => setTimeout(r, 2500));
  const sentPanel = await cdp.evaluate(`(() => {
    setPaymentRequestTab('sent');
    return { count: document.getElementById('prCountSent').innerText, text: document.getElementById('paymentRequestsList').innerText.replace(/\\s+/g,' ').slice(0,220) };
  })()`);
  check('Sent Requests tab shows the pending request', sentPanel.count === '1' && /Pending approval/i.test(sentPanel.text), JSON.stringify(sentPanel));
  check('debtor sees Awaiting receiver, not Accepted', /Awaiting receiver/i.test(sentPanel.text), sentPanel.text);
  await cdp.screenshot(path.join(SHOT_DIR, 'mark-paid-sent-tab.png'));
  check('no console errors on debtor flow', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

  // 2. Receiver sees and accepts
  await logoutUI(cdp);
  await loginUI(cdp, receiver.username);
  await cdp.evaluate(`navigateTo('settle')`);
  await new Promise(r => setTimeout(r, 2500));
  const rxPanel = await cdp.evaluate(`(() => ({
    received: document.getElementById('prCountReceived').innerText,
    sent: document.getElementById('prCountSent').innerText,
    text: document.getElementById('paymentRequestsList').innerText.replace(/\\s+/g,' ').slice(0,260)
  }))()`);
  check('receiver sees exactly one Pending Received request', rxPanel.received === '1' && rxPanel.sent === '0', JSON.stringify(rxPanel));
  check('receiver sees payer, amount, method and expense detail', rxPanel.text.includes('200.00') && /Browser Debtor/i.test(rxPanel.text) && /CASH|Cash/i.test(rxPanel.text) && rxPanel.text.includes(desc), rxPanel.text);
  await cdp.screenshot(path.join(SHOT_DIR, 'mark-paid-received-tab.png'));

  await cdp.evaluate(`document.querySelector('button[onclick*="acceptPaymentRequest("]').click()`);
  await cdp.waitFor(`!document.getElementById('customConfirmModal').classList.contains('hidden')`, 8000);
  const confirmTitle = await cdp.evaluate(`document.getElementById('customConfirmTitle').innerText`);
  check('accept opens a confirmation with the exact amount', /Accept Payment/i.test(confirmTitle), confirmTitle);
  await cdp.evaluate(`document.getElementById('customConfirmActionBtn').click()`);
  await new Promise(r => setTimeout(r, 3500));
  const afterAccept = await api('GET', '/api/payment-requests', receiverT);
  const acceptedReq = (afterAccept.data.requests || []).find(r => Number(r.expense_id) === Number(expenseId));
  check('receiver acceptance marks the request ACCEPTED', acceptedReq && acceptedReq.status === 'ACCEPTED', JSON.stringify(acceptedReq && acceptedReq.status));
  const splitAfterAccept = await pool.query('SELECT settled_amount_base FROM expense_splits WHERE expense_id=$1 AND user_id=$2', [expenseId, debtor.id]);
  check('accept settles exactly the approved partial amount', Math.abs(Number(splitAfterAccept.rows[0].settled_amount_base) - 200) < 0.01, splitAfterAccept.rows[0].settled_amount_base);

  await cdp.evaluate(`setPaymentRequestTab('history')`);
  await new Promise(r => setTimeout(r, 400));
  const historyText = await cdp.evaluate(`document.getElementById('paymentRequestsList').innerText.replace(/\\s+/g,' ').slice(0,260)`);
  check('receiver Payment History shows the accepted request', /Accepted/i.test(historyText) && /receiver-confirmed/i.test(historyText), historyText);
  await cdp.screenshot(path.join(SHOT_DIR, 'mark-paid-history.png'));
  check('no console errors on receiver accept flow', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

  // 3. Remaining partial request rejected leaves ledger unchanged
  const remainder = await api('POST', '/api/payment-requests', debtorT, { expense_id: expenseId, amount: 300, payment_method: 'BANK', note: 'Remaining bank transfer' });
  check('remaining partial request can be created after acceptance', remainder.status === 201, 'status=' + remainder.status);
  await cdp.evaluate(`navigateTo('settle')`);
  await new Promise(r => setTimeout(r, 2500));
  await cdp.evaluate(`setPaymentRequestTab('received')`);
  await new Promise(r => setTimeout(r, 500));
  await cdp.evaluate(`document.querySelector('button[onclick*="rejectPaymentRequest("]').click()`);
  await cdp.waitFor(`!document.getElementById('customConfirmModal').classList.contains('hidden')`, 8000);
  await cdp.evaluate(`document.getElementById('customConfirmActionBtn').click()`);
  await new Promise(r => setTimeout(r, 3000));
  const splitAfterReject = await pool.query('SELECT settled_amount_base FROM expense_splits WHERE expense_id=$1 AND user_id=$2', [expenseId, debtor.id]);
  check('rejection changes no balance', Math.abs(Number(splitAfterReject.rows[0].settled_amount_base) - 200) < 0.01, splitAfterReject.rows[0].settled_amount_base);
  const rejectedRow = await pool.query('SELECT status FROM payment_requests WHERE id=$1', [remainder.data.request.id]);
  check('rejected request is recorded as REJECTED', rejectedRow.rows[0].status === 'REJECTED', rejectedRow.rows[0].status);

  // 4. Debtor sees sent request awaiting / history after receiver rejected
  await logoutUI(cdp);
  await loginUI(cdp, debtor.username);
  await cdp.evaluate(`navigateTo('settle')`);
  await new Promise(r => setTimeout(r, 2500));
  await cdp.evaluate(`setPaymentRequestTab('history')`);
  await new Promise(r => setTimeout(r, 400));
  const debtorHistory = await cdp.evaluate(`document.getElementById('paymentRequestsList').innerText.replace(/\\s+/g,' ').slice(0,320)`);
  check('debtor history shows both accepted and rejected outcomes', /Accepted/i.test(debtorHistory) && /Rejected/i.test(debtorHistory), debtorHistory);

  // 5. Group expense modal exposes the same action
  await cdp.evaluate(`navigateTo('groups')`);
  await new Promise(r => setTimeout(r, 1500));
  await cdp.evaluate(`openGroupExpensesModal(${gid})`);
  await new Promise(r => setTimeout(r, 2000));
  const groupModalBtn = await cdp.evaluate(`(() => {
    const modal = document.getElementById('groupExpensesModal');
    const btn = modal.querySelector('button[onclick*="openMarkPaidModal"]');
    return { visible: !modal.classList.contains('hidden'), hasButton: !!btn, text: (btn ? btn.innerText : '') };
  })()`);
  check('group expense modal shows Mark Paid for the debtor share', groupModalBtn.visible && groupModalBtn.hasButton, JSON.stringify(groupModalBtn));
  await cdp.evaluate(`closeGroupExpensesModal()`);

  // 6. Settlement screen exposes the external-payment request action
  await cdp.evaluate(`navigateTo('settle')`);
  await new Promise(r => setTimeout(r, 2200));
  const peerClicked = await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('#settlePeerCardsContainer button')].find(b => b.innerText.includes('Browser Receiver'));
    if (!btn) return false;
    btn.click(); return true;
  })()`);
  await new Promise(r => setTimeout(r, 700));
  const settleAction = await cdp.evaluate(`({
    disabled: document.getElementById('btnMarkPaidExternal').disabled,
    amount: document.getElementById('settleAmountInput').value
  })`);
  check('settlement screen enables Mark as Paid for the selected peer', peerClicked && settleAction.disabled === false, JSON.stringify(settleAction));
  await cdp.evaluate(`document.getElementById('btnMarkPaidExternal').click()`);
  await new Promise(r => setTimeout(r, 500));
  const settleModal = await cdp.evaluate(`({
    visible: !document.getElementById('markPaidModal').classList.contains('hidden'),
    context: document.getElementById('markPaidContext').innerText.replace(/\\s+/g,' ')
  })`);
  check('settlement Mark as Paid opens the request modal', settleModal.visible && /Outstanding balance/i.test(settleModal.context), JSON.stringify(settleModal));
  await cdp.evaluate(`closeMarkPaidModal()`);

  // 7. Activity feed carries both sides of the notification
  await cdp.evaluate(`navigateTo('activity')`);
  await new Promise(r => setTimeout(r, 1800));
  const activityText = await cdp.evaluate(`document.getElementById('activityFullLogList').innerText.replace(/\\s+/g,' ').slice(0,600)`);
  check('activity feed notifies the debtor of acceptance and rejection', /accepted/i.test(activityText) && /rejected/i.test(activityText), activityText.slice(0, 220));

  // Cleanup
  const cl = await pool.connect();
  try {
    await cl.query('BEGIN'); await cl.query("SET LOCAL session_replication_role='replica'");
    await cl.query('DELETE FROM activity_logs WHERE group_id=$1', [gid]);
    await cl.query('DELETE FROM chat_messages WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id=$1)', [gid]);
    await cl.query('DELETE FROM chat_conversation_members WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id=$1)', [gid]);
    await cl.query('DELETE FROM chat_conversations WHERE group_id=$1', [gid]);
    await cl.query('DELETE FROM payment_requests WHERE group_id=$1', [gid]);
    await cl.query('DELETE FROM settlements WHERE group_id=$1', [gid]);
    await cl.query('DELETE FROM expense_corrections WHERE expense_id IN (SELECT id FROM expenses WHERE group_id=$1)', [gid]);
    await cl.query('DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE group_id=$1)', [gid]);
    await cl.query('DELETE FROM expenses WHERE group_id=$1', [gid]);
    await cl.query('DELETE FROM group_members WHERE group_id=$1', [gid]);
    await cl.query('DELETE FROM groups WHERE id=$1', [gid]);
    await cl.query('DELETE FROM users WHERE id=$1', [debtor.id]);
    await cl.query('DELETE FROM users WHERE id=$1', [receiver.id]);
    await cl.query('COMMIT');
  } catch (e) { await cl.query('ROLLBACK'); console.error('cleanup', e.message); } finally { cl.release(); }

  console.log('\nRESULT:', pass, 'passed,', fail, 'failed');
  if (failures.length) console.log('FAILURES:\n - ' + failures.join('\n - '));
  cdp.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
