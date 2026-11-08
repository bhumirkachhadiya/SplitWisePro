const bcrypt = require('bcrypt');
const { pool } = require('../../db');
const BASE = 'http://127.0.0.1:5000';
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
  const email = `${prefix}.${tag}@example.com`;
  const username = `${prefix}${tag}`;
  const hash = await bcrypt.hash('password123', 10);
  const r = await pool.query(`INSERT INTO users (name, email, username, password_hash, avatar_initials, upi_id, phone, is_verified, is_active)
    VALUES ($1,$2,$3,$4,$5,$6,'+91 90000 00000',TRUE,TRUE) RETURNING id`,
    [prefix + ' ' + tag, email, username, hash, prefix.slice(0, 2).toUpperCase(), `${username}@okaxis`]);
  const login = await api('POST', '/api/users/login', null, { identifier: username, password: 'password123' });
  return { id: r.rows[0].id, token: login.data.session_token, name: prefix + ' ' + tag, username };
}

(async () => {
  const tag = Date.now().toString().slice(-7);
  const debtor = await makeUser('Mkt Debtor', tag);
  const receiver = await makeUser('Mkt Receiver', tag);
  const outsider = await makeUser('Mkt Outsider', tag);

  const group = await api('POST', '/api/groups', debtor.token, {
    name: 'MARKPAID Audit ' + tag,
    members: [{ user_id: receiver.id }, { user_id: outsider.id }]
  });
  const gid = group.data.id;
  const exp1 = await api('POST', '/api/expenses', debtor.token, {
    group_id: gid, paid_by: receiver.id, amount: 1000, description: 'Mark paid audit dinner',
    split_type: 'equal', splits: [{ user_id: debtor.id }, { user_id: receiver.id }]
  });
  const expenseId = exp1.data.id;

  let r = await api('POST', '/api/payment-requests', debtor.token, { expense_id: expenseId, amount: 200, payment_method: 'CASH', note: 'cash part 1' });
  check('debtor can send expense-wise partial Mark as Paid request', r.status === 201 && r.data.request && r.data.request.status === 'PENDING', 'status=' + r.status + ' ' + r.text.slice(0, 120));
  const req1 = r.data.request;

  let bal = await api('GET', `/api/groups/${gid}/balances`, debtor.token);
  let bmap = {}; (bal.data || []).forEach(b => bmap[b.user_id] = b.net_balance);
  check('request alone does not change ledger balance', Math.abs(bmap[debtor.id] + 500) < 0.01, JSON.stringify(bmap));

  const dup = await api('POST', '/api/payment-requests', debtor.token, { expense_id: expenseId, amount: 100, payment_method: 'UPI' });
  check('duplicate pending request for the same expense is blocked', dup.status === 409, 'status=' + dup.status + ' ' + dup.text.slice(0, 80));

  const received = await api('GET', '/api/payment-requests', receiver.token);
  const sent = await api('GET', '/api/payment-requests', debtor.token);
  check('receiver sees the request in Pending Received', received.status === 200 && received.data.counts.received_pending === 1, JSON.stringify(received.data.counts));
  check('debtor sees the request in Sent Requests', sent.status === 200 && sent.data.counts.sent_pending === 1, JSON.stringify(sent.data.counts));

  const selfAccept = await api('POST', `/api/payment-requests/${req1.id}/accept`, debtor.token);
  check('debtor cannot approve their own request', selfAccept.status === 403, 'status=' + selfAccept.status);
  const outsiderAccept = await api('POST', `/api/payment-requests/${req1.id}/accept`, outsider.token);
  check('unrelated user cannot approve the request', outsiderAccept.status === 403, 'status=' + outsiderAccept.status);

  const rejected = await api('POST', `/api/payment-requests/${req1.id}/reject`, receiver.token, { reason: 'Did not receive cash' });
  check('receiver can reject the request', rejected.status === 200 && rejected.data.request.status === 'REJECTED', 'status=' + rejected.status);
  bal = await api('GET', `/api/groups/${gid}/balances`, debtor.token);
  bmap = {}; (bal.data || []).forEach(b => bmap[b.user_id] = b.net_balance);
  check('rejection leaves the ledger untouched', Math.abs(bmap[debtor.id] + 500) < 0.01, JSON.stringify(bmap));

  const req2 = await api('POST', '/api/payment-requests', debtor.token, { expense_id: expenseId, amount: 500, payment_method: 'UPI', transaction_reference: 'UTR-MKT-1' });
  check('new request allowed after rejection', req2.status === 201, 'status=' + req2.status);
  const accepted = await api('POST', `/api/payment-requests/${req2.data.request.id}/accept`, receiver.token);
  check('receiver can accept the request', accepted.status === 200 && accepted.data.request.status === 'ACCEPTED', 'status=' + accepted.status + ' ' + accepted.text.slice(0, 120));
  check('accept returns a settlement and applied amount', !!accepted.data.settlement && Math.abs(Number(accepted.data.amount_applied) - 500) < 0.01, JSON.stringify(accepted.data.amount_applied));

  bal = await api('GET', `/api/groups/${gid}/balances`, debtor.token);
  bmap = {}; (bal.data || []).forEach(b => bmap[b.user_id] = b.net_balance);
  check('accepted payment clears the balance exactly', Math.abs(bmap[debtor.id]) < 0.01, JSON.stringify(bmap));

  const again = await api('POST', `/api/payment-requests/${req2.data.request.id}/accept`, receiver.token);
  check('double acceptance is rejected', again.status === 409, 'status=' + again.status);
  const settleCount = await pool.query('SELECT COUNT(*)::int n FROM settlements WHERE group_id=$1', [gid]);
  check('exactly one settlement row was created', settleCount.rows[0].n === 1, 'settlements=' + settleCount.rows[0].n);

  // Partial payment flow on a second expense
  const exp2 = await api('POST', '/api/expenses', debtor.token, {
    group_id: gid, paid_by: receiver.id, amount: 300, description: 'Mark paid partial test',
    split_type: 'equal', splits: [{ user_id: debtor.id }, { user_id: receiver.id }]
  });
  const expense2 = exp2.data.id;
  const part1 = await api('POST', '/api/payment-requests', debtor.token, { expense_id: expense2, amount: 50, payment_method: 'BANK', transaction_reference: 'BANK-1' });
  const partAccept = await api('POST', `/api/payment-requests/${part1.data.request.id}/accept`, receiver.token);
  check('partial payment is accepted', partAccept.status === 200, 'status=' + partAccept.status);
  const exp2row = await pool.query('SELECT es.settled_amount_base, es.is_settled FROM expense_splits es WHERE es.expense_id=$1 AND es.user_id=$2', [expense2, debtor.id]);
  check('partial payment leaves a remaining outstanding balance', Math.abs(Number(exp2row.rows[0].settled_amount_base) - 50) < 0.01 && exp2row.rows[0].is_settled === false, JSON.stringify(exp2row.rows[0]));

  const part2 = await api('POST', '/api/payment-requests', debtor.token, { expense_id: expense2, amount: 50, payment_method: 'CASH' });
  const part2Accept = await api('POST', `/api/payment-requests/${part2.data.request.id}/accept`, receiver.token);
  check('second partial payment is accepted', part2Accept.status === 200, 'status=' + part2Accept.status);
  const exp2row2 = await pool.query('SELECT es.settled_amount_base FROM expense_splits es WHERE es.expense_id=$1 AND es.user_id=$2', [expense2, debtor.id]);
  check('multiple partials accumulate correctly', Math.abs(Number(exp2row2.rows[0].settled_amount_base) - 100) < 0.01, JSON.stringify(exp2row2.rows[0]));

  const over = await api('POST', '/api/payment-requests', debtor.token, { expense_id: expense2, amount: 1000, payment_method: 'CASH' });
  check('overpayment above outstanding is rejected', over.status === 400, 'status=' + over.status + ' ' + over.text.slice(0, 90));

  const cancelReq = await api('POST', '/api/payment-requests', debtor.token, { expense_id: expense2, amount: 50, payment_method: 'CASH' });
  const cancelled = await api('POST', `/api/payment-requests/${cancelReq.data.request.id}/cancel`, debtor.token);
  check('payer can cancel a pending request', cancelled.status === 200 && cancelled.data.request.status === 'CANCELLED', 'status=' + cancelled.status);
  const cancelAccept = await api('POST', `/api/payment-requests/${cancelReq.data.request.id}/accept`, receiver.token);
  check('cancelled request cannot be accepted', cancelAccept.status === 409, 'status=' + cancelAccept.status);

  // Concurrent accept on a fresh request
  const exp3 = await api('POST', '/api/expenses', debtor.token, {
    group_id: gid, paid_by: receiver.id, amount: 200, description: 'Concurrent request test',
    split_type: 'equal', splits: [{ user_id: debtor.id }, { user_id: receiver.id }]
  });
  const conReq = await api('POST', '/api/payment-requests', debtor.token, { expense_id: exp3.data.id, amount: 100, payment_method: 'UPI' });
  const [c1, c2] = await Promise.all([
    api('POST', `/api/payment-requests/${conReq.data.request.id}/accept`, receiver.token),
    api('POST', `/api/payment-requests/${conReq.data.request.id}/accept`, receiver.token)
  ]);
  check('concurrent accepts produce exactly one success', [c1.status, c2.status].filter(s => s === 200).length === 1, `${c1.status}/${c2.status}`);
  const conSettlements = await pool.query('SELECT COUNT(*)::int n FROM settlements WHERE group_id=$1 AND payer_id=$2', [gid, debtor.id]);
  check('concurrent accepts create no duplicate settlement', conSettlements.rows[0].n === 4, 'settlements=' + conSettlements.rows[0].n);

  // Global (non-expense) request applies across multiple outstanding expenses
  const globalExp = await api('POST', '/api/expenses', debtor.token, {
    group_id: gid, paid_by: receiver.id, amount: 200, description: 'Global request expense',
    split_type: 'equal', splits: [{ user_id: debtor.id }, { user_id: receiver.id }]
  });
  const globalReq = await api('POST', '/api/payment-requests', debtor.token, { group_id: gid, receiver_id: receiver.id, amount: 100, payment_method: 'CASH' });
  check('outstanding-balance request can be sent without an expense id', globalReq.status === 201, 'status=' + globalReq.status + ' ' + globalReq.text.slice(0, 100));
  const globalAccept = await api('POST', `/api/payment-requests/${globalReq.data.request.id}/accept`, receiver.token);
  check('outstanding-balance request is accepted', globalAccept.status === 200, 'status=' + globalAccept.status);
  const geRow = await pool.query('SELECT settled_amount_base FROM expense_splits WHERE expense_id=$1 AND user_id=$2', [globalExp.data.id, debtor.id]);
  check('global request allocates across the oldest outstanding expenses', Math.abs(Number(geRow.rows[0].settled_amount_base) - 50) < 0.01, geRow.rows[0].settled_amount_base);

  // Duplicate transaction reference across accepted requests
  const refExp = await api('POST', '/api/expenses', debtor.token, {
    group_id: gid, paid_by: receiver.id, amount: 100, description: 'Duplicate UTR test',
    split_type: 'equal', splits: [{ user_id: debtor.id }, { user_id: receiver.id }]
  });
  const refReq = await api('POST', '/api/payment-requests', debtor.token, { expense_id: refExp.data.id, amount: 50, payment_method: 'UPI', transaction_reference: 'UTR-MKT-1' });
  const refAccept = await api('POST', `/api/payment-requests/${refReq.data.request.id}/accept`, receiver.token);
  check('reusing an already accepted UTR is blocked', refAccept.status === 409 && refAccept.data.code === 'DUPLICATE_TRANSACTION_REFERENCE', 'status=' + refAccept.status + ' ' + refAccept.text.slice(0, 100));

  // Deleting an expense cancels its pending request and preserves the snapshot
  const delExp = await api('POST', '/api/expenses', debtor.token, {
    group_id: gid, paid_by: receiver.id, amount: 100, description: 'Deleted expense snapshot',
    split_type: 'equal', splits: [{ user_id: debtor.id }, { user_id: receiver.id }]
  });
  const delReq = await api('POST', '/api/payment-requests', debtor.token, { expense_id: delExp.data.id, amount: 50, payment_method: 'CASH' });
  const del = await api('DELETE', `/api/expenses/${delExp.data.id}`, receiver.token);
  check('payer can still delete an expense with only a pending request', del.status === 200, 'status=' + del.status + ' ' + del.text.slice(0, 80));
  const delReqRow = await pool.query('SELECT status, expense_description_snapshot FROM payment_requests WHERE id=$1', [delReq.data.request.id]);
  check('expense deletion cancels the pending request', delReqRow.rows[0].status === 'CANCELLED', delReqRow.rows[0].status);
  check('request history retains the deleted expense description', delReqRow.rows[0].expense_description_snapshot === 'Deleted expense snapshot', delReqRow.rows[0].expense_description_snapshot);

  const forged = await api('POST', '/api/payment-requests', outsider.token, {
    payer_id: debtor.id, receiver_id: receiver.id, expense_id: expenseId, amount: 10, payment_method: 'CASH'
  });
  check('an unrelated user cannot forge a request for another payer', forged.status === 404 || forged.status === 400, 'status=' + forged.status + ' ' + forged.text.slice(0, 80));

  // Locked circle also blocks approval of an existing request
  const lockExp = await api('POST', '/api/expenses', debtor.token, {
    group_id: gid, paid_by: receiver.id, amount: 100, description: 'Locked approval test',
    split_type: 'equal', splits: [{ user_id: debtor.id }, { user_id: receiver.id }]
  });
  const lockReq = await api('POST', '/api/payment-requests', debtor.token, { expense_id: lockExp.data.id, amount: 50, payment_method: 'CASH' });
  await api('POST', `/api/groups/${gid}/lock`, debtor.token, {});
  const lockedAccept = await api('POST', `/api/payment-requests/${lockReq.data.request.id}/accept`, receiver.token);
  check('locked circle blocks approval of a pending request', lockedAccept.status === 400, 'status=' + lockedAccept.status + ' ' + lockedAccept.text.slice(0, 80));
  await api('POST', `/api/groups/${gid}/unlock`, debtor.token, {});
  const unlockedAccept = await api('POST', `/api/payment-requests/${lockReq.data.request.id}/accept`, receiver.token);
  check('unlocking allows the pending request to be approved', unlockedAccept.status === 200, 'status=' + unlockedAccept.status);

  // Group lock blocks new requests
  await api('POST', `/api/groups/${gid}/lock`, debtor.token, {});
  const lockedReq = await api('POST', '/api/payment-requests', debtor.token, { group_id: gid, receiver_id: receiver.id, amount: 10, payment_method: 'CASH' });
  check('locked circle blocks new Mark as Paid requests', lockedReq.status === 400, 'status=' + lockedReq.status + ' ' + lockedReq.text.slice(0, 90));
  await api('POST', `/api/groups/${gid}/unlock`, debtor.token, {});

  const history = await api('GET', '/api/payment-requests', debtor.token);
  check('history exposes accepted and rejected requests', history.data.counts.history >= 4, JSON.stringify(history.data.counts));
  const activity = await pool.query("SELECT COUNT(*)::int n FROM activity_logs WHERE group_id=$1 AND activity_type LIKE 'PAYMENT_REQUEST%'", [gid]);
  check('activity notifications exist for both users', activity.rows[0].n >= 8, 'activity=' + activity.rows[0].n);

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
    for (const u of [debtor, receiver, outsider]) {
      await cl.query('DELETE FROM users WHERE id=$1', [u.id]);
    }
    await cl.query('COMMIT');
  } catch (e) { await cl.query('ROLLBACK'); console.error('cleanup', e.message); } finally { cl.release(); }

  console.log('\nRESULT:', pass, 'passed,', fail, 'failed');
  if (failures.length) console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
