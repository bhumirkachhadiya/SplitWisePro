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
  const bcrypt = require('bcrypt');
  const suffix = Date.now();
  const peerRes = await pool.query(`
    INSERT INTO users (name, email, username, password_hash, avatar_initials, upi_id, phone, is_verified, is_active)
    VALUES ($1, $2, $3, $4, 'ST', $5, '+91 90000 00000', TRUE, TRUE)
    RETURNING id
  `, ['Settle Peer ' + suffix, 'settle.peer.' + suffix + '@example.com', 'settlepeer' + suffix, await bcrypt.hash('password123', 10), 'settlepeer' + suffix + '@okaxis']);
  const peerId = peerRes.rows[0].id;
  const g = await api('POST', '/api/groups', alexT, { name: 'SETTLE Load ' + suffix, members: [{ user_id: peerId }] });
  const gid = g.data.id;
  await api('POST', '/api/expenses', alexT, {
    group_id: gid, paid_by: peerId, amount: 1000, description: 'Settle load test',
    split_type: 'equal', splits: [{ user_id: 1 }, { user_id: peerId }]
  });

  const pendingBefore = await api('GET', '/api/upi/pending-requests', alexT);

  const cdp = await openPage(BASE + '/');
  await cdp.waitFor('document.readyState === "complete"');
  await cdp.send('Network.clearBrowserCookies');
  await cdp.evaluate('localStorage.clear(); sessionStorage.clear();');
  await cdp.goto(BASE + '/');
  await new Promise(r => setTimeout(r, 900));
  await cdp.evaluate(`(() => { document.getElementById('authEmail').value='alex'; document.getElementById('authPassword').value='password123'; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  await cdp.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 20000);
  await new Promise(r => setTimeout(r, 2500));

  // Open the exact reported URL.
  cdp.errors.length = 0;
  await cdp.goto(BASE + '/#settle');
  await new Promise(r => setTimeout(r, 4000));
  const initial = await cdp.evaluate(`(() => ({
    hash: location.hash,
    receiver: document.getElementById('settleReceiverName').innerText,
    amount: document.getElementById('settleAmountInput').value,
    amountDisabled: document.getElementById('settleAmountInput').disabled,
    pendingVisible: !document.getElementById('pendingPaymentsPanel').classList.contains('hidden'),
    pendingRows: document.getElementById('pendingPaymentsList').children.length,
    qrHidden: document.getElementById('upiQrCodeContainer').classList.contains('hidden'),
    generateDisabled: document.getElementById('btnGenerateUpi').disabled,
    payDisabled: document.getElementById('btnAutoQrSettle').disabled,
    status: document.getElementById('upiPollingStatusText').innerText
  }))()`);
  check('settle page opens from #settle', initial.hash === '#settle', initial.hash);
  check('no peer is auto-selected', initial.receiver === 'Select a peer', initial.receiver);
  check('amount is empty on load', initial.amount === '' && initial.amountDisabled === true, JSON.stringify({ amount: initial.amount, disabled: initial.amountDisabled }));
  check('no QR is shown on load', initial.qrHidden === true && initial.generateDisabled === true && initial.payDisabled === true, JSON.stringify(initial));
  const visibleBefore = (pendingBefore.data || []).filter(r =>
    Number(r.receiver_id) === 1 || (Number(r.payer_id) === 1 && r.claimed_at)
  ).length;
  check('loading the page adds no confirmation rows', initial.pendingRows === visibleBefore, 'rows=' + initial.pendingRows + ' expected=' + visibleBefore);

  const pendingAfterLoad = await api('GET', '/api/upi/pending-requests', alexT);
  check('loading the page creates no payment request',
    (pendingAfterLoad.data || []).length === (pendingBefore.data || []).length,
    'before=' + (pendingBefore.data || []).length + ' after=' + (pendingAfterLoad.data || []).length);

  // Select Rahul explicitly.
  cdp.errors.length = 0;
  const peerClicked = await cdp.evaluate(`(() => { const b = document.querySelector("button[onclick*=\\"openSettleForPeer(${peerId},\\"]"); if (!b) return false; b.click(); return true; })()`);
  await new Promise(r => setTimeout(r, 1200));
  const selected = await cdp.evaluate(`(() => ({
    receiver: document.getElementById('settleReceiverName').innerText,
    amount: document.getElementById('settleAmountInput').value,
    generateDisabled: document.getElementById('btnGenerateUpi').disabled,
    payDisabled: document.getElementById('btnAutoQrSettle').disabled,
    qrHidden: document.getElementById('upiQrCodeContainer').classList.contains('hidden')
  }))()`);
  check('selecting a peer prefills that peer only', peerClicked && selected.receiver === 'Settle Peer ' + suffix && Number(selected.amount) === 500, JSON.stringify(selected));
  check('selecting a peer does not create a request yet', selected.generateDisabled === false && selected.payDisabled === true && selected.qrHidden === true, JSON.stringify(selected));

  const pendingAfterSelect = await api('GET', '/api/upi/pending-requests', alexT);
  check('no request is created by selecting a peer',
    (pendingAfterSelect.data || []).length === (pendingBefore.data || []).length,
    'before=' + (pendingBefore.data || []).length + ' after=' + (pendingAfterSelect.data || []).length);

  // Generate explicitly.
  await cdp.evaluate(`document.getElementById('btnGenerateUpi').click()`);
  await new Promise(r => setTimeout(r, 3000));
  const generated = await cdp.evaluate(`(() => ({
    qrHidden: document.getElementById('upiQrCodeContainer').classList.contains('hidden'),
    payDisabled: document.getElementById('btnAutoQrSettle').disabled,
    pendingVisible: !document.getElementById('pendingPaymentsPanel').classList.contains('hidden'),
    pendingRows: document.getElementById('pendingPaymentsList').children.length,
    status: document.getElementById('upiPollingStatusText').innerText
  }))()`);
  check('Generate QR creates the request and enables payment', generated.qrHidden === false && generated.payDisabled === false, JSON.stringify(generated));
  const pendingAfterGenerate = await api('GET', '/api/upi/pending-requests', alexT);
  const created = (pendingAfterGenerate.data || []).find(r => Number(r.payer_id) === 1 && Number(r.receiver_id) === peerId);
  check('one request exists after explicit generation', !!created, 'requests=' + (pendingAfterGenerate.data || []).length);
  check('unclaimed outgoing request is not shown as awaiting confirmation', generated.pendingRows === initial.pendingRows, 'rows=' + generated.pendingRows + ' before=' + initial.pendingRows);
  await cdp.screenshot(path.join(SHOT_DIR, 'settle-generated-on-demand.png'));

  // Claim it (I have paid) -> now it belongs in the confirmation inbox.
  await cdp.evaluate(`handleQrPaymentAutoSettlement()`);
  await new Promise(r => setTimeout(r, 2500));
  const claimed = await cdp.evaluate(`(() => ({
    pendingVisible: !document.getElementById('pendingPaymentsPanel').classList.contains('hidden'),
    text: document.getElementById('pendingPaymentsList').innerText.replace(/\\s+/g,' ').slice(0,160)
  }))()`);
  check('explicit claim moves the request into the confirmation inbox', claimed.pendingVisible === true && /Awaiting receiver/i.test(claimed.text), claimed.text);

  // Regenerate same amount -> dedupe, still one request.
  await cdp.evaluate(`document.getElementById('btnGenerateUpi').click()`);
  await new Promise(r => setTimeout(r, 2500));
  const pendingAfterRegen = await api('GET', '/api/upi/pending-requests', alexT);
  const samePair = (pendingAfterRegen.data || []).filter(r => Number(r.payer_id) === 1 && Number(r.receiver_id) === peerId);
  check('regenerating reuses the same open request (no duplicates)', samePair.length === 1, 'requests=' + samePair.length);

  // Cleanup: cancel the request, then remove the test circle.
  if (created) await api('POST', '/api/upi/cancel-payment', alexT, { request_id: created.request_id });
  const cl = await pool.connect();
  try {
    await cl.query('BEGIN'); await cl.query("SET LOCAL session_replication_role='replica'");
    await cl.query('DELETE FROM activity_logs WHERE group_id=$1', [gid]);
    await cl.query('DELETE FROM chat_messages WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id=$1)', [gid]);
    await cl.query('DELETE FROM chat_conversation_members WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id=$1)', [gid]);
    await cl.query('DELETE FROM chat_conversations WHERE group_id=$1', [gid]);
    await cl.query('DELETE FROM upi_payment_requests WHERE group_id=$1 OR payer_id=$2 OR receiver_id=$2', [gid, peerId]);
    await cl.query('DELETE FROM settlements WHERE group_id=$1', [gid]);
    await cl.query('DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE group_id=$1)', [gid]);
    await cl.query('DELETE FROM expenses WHERE group_id=$1', [gid]);
    await cl.query('DELETE FROM group_members WHERE group_id=$1', [gid]);
    await cl.query('DELETE FROM groups WHERE id=$1', [gid]);
    await cl.query('DELETE FROM users WHERE id=$1', [peerId]);
    await cl.query('COMMIT');
  } catch (e) { await cl.query('ROLLBACK'); console.error('cleanup', e.message); } finally { cl.release(); }

  console.log('\nRESULT:', pass, 'passed,', fail, 'failed');
  if (failures.length) console.log('FAILURES:\n - ' + failures.join('\n - '));
  cdp.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
