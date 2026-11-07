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
(async () => {
  const alexT = (await api('POST', '/api/users/login', null, { identifier: 'alex', password: 'password123' })).data.session_token;
  const rahulT = (await api('POST', '/api/users/login', null, { identifier: 'rahul', password: 'password123' })).data.session_token;
  const g = await api('POST', '/api/groups', alexT, { name: 'STATUS Audit ' + Date.now(), members: [{ user_id: 2 }, { user_id: 3 }] });
  const gid = g.data.id;
  const e = await api('POST', '/api/expenses', alexT, {
    group_id: gid, paid_by: 1, amount: 1500, description: 'Status audit dinner',
    split_type: 'equal', splits: [{ user_id: 1 }, { user_id: 2 }, { user_id: 3 }]
  });
  const eid = e.data.id;

  let list = await api('GET', `/api/groups/${gid}/expenses`, alexT);
  let exp = list.data.expenses[0];
  const byUser = {};
  exp.splits.forEach(s => byUser[s.user_id] = s);
  check('new expense: payer own share is PAID', byUser[1].status === 'PAID' && byUser[1].is_settled === true && byUser[1].paid_amount === 500, JSON.stringify(byUser[1]));
  check('new expense: other participants default to PENDING', byUser[2].status === 'PENDING' && byUser[3].status === 'PENDING' && byUser[2].paid_amount === 0 && byUser[3].paid_amount === 0, JSON.stringify([byUser[2], byUser[3]]));
  check('new expense: totals reconcile', list.data.total_spend === 1500 && list.data.total_paid === 500 && list.data.total_pending === 1000, JSON.stringify(list.data.summary));
  check('paid + pending equals total spend', list.data.total_paid + list.data.total_pending === list.data.total_spend, list.data.total_paid + '+' + list.data.total_pending);

  // Partial settlement by Rahul (200 of 500)
  const partial = await api('POST', '/api/settlements', rahulT, { group_id: gid, payer_id: 2, receiver_id: 1, amount: 200 });
  check('partial settlement accepted', partial.status === 201, 'status=' + partial.status);
  list = await api('GET', `/api/groups/${gid}/expenses`, alexT);
  exp = list.data.expenses[0];
  const rahul = exp.splits.find(s => s.user_id === 2);
  check('partially paid split shows PARTIALLY_PAID', rahul.status === 'PARTIALLY_PAID' && rahul.paid_amount === 200 && rahul.outstanding_amount === 300, JSON.stringify(rahul));
  check('partial totals still reconcile', list.data.total_paid === 700 && list.data.total_pending === 800 && list.data.total_paid + list.data.total_pending === 1500, JSON.stringify(list.data.summary));

  // Settle the remaining 300
  await api('POST', '/api/settlements', rahulT, { group_id: gid, payer_id: 2, receiver_id: 1, amount: 300 });
  list = await api('GET', `/api/groups/${gid}/expenses`, alexT);
  exp = list.data.expenses[0];
  check('fully paid split shows PAID', exp.splits.find(s => s.user_id === 2).status === 'PAID', '');
  check('fully settled totals reconcile', list.data.total_paid === 1000 && list.data.total_pending === 500 && list.data.total_paid + list.data.total_pending === 1500, JSON.stringify(list.data.summary));

  // Expense detail must not double-count payer either
  const detail = await api('GET', '/api/expenses/' + eid, alexT);
  check('expense detail keeps payer settled amount at zero', Number(detail.data.splits.find(s => s.user_id === 1).settled_amount) === 0, '');

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
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
