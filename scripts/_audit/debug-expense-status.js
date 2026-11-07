const { pool } = require('../../db');
const BASE = 'http://127.0.0.1:5000';
async function api(method, p, token, body) {
  const h = { 'Content-Type': 'application/json' }; if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch (e) {}
  return { status: r.status, data: d, text: t };
}
(async () => {
  const alexT = (await api('POST', '/api/users/login', null, { identifier: 'alex', password: 'password123' })).data.session_token;
  const g = await api('POST', '/api/groups', alexT, { name: 'STATUS DEBUG ' + Date.now(), members: [{ user_id: 2 }, { user_id: 3 }] });
  const gid = g.data.id;
  const e = await api('POST', '/api/expenses', alexT, {
    group_id: gid, paid_by: 1, amount: 1500, description: 'Fresh status test',
    split_type: 'equal', splits: [{ user_id: 1 }, { user_id: 2 }, { user_id: 3 }]
  });
  console.log('created expense', e.status, e.data);
  const detail = await api('GET', '/api/expenses/' + e.data.id, alexT);
  console.log('detail splits:', (detail.data.splits || []).map(s => ({ u: s.user_id, amt: s.amount, settled: s.settled_amount, is_settled: s.is_settled })));
  const list = await api('GET', `/api/groups/${gid}/expenses`, alexT);
  console.log('list totals:', list.data.summary, 'total_paid:', list.data.total_paid, 'total_pending:', list.data.total_pending);
  console.log('list splits:', (list.data.expenses[0].splits || []).map(s => ({ u: s.user_id, amt: s.amount, settled: s.settled_amount, paid: s.paid_amount, out: s.outstanding_amount, status: s.status, is_settled: s.is_settled })));
  console.log('expense paid_amount:', list.data.expenses[0].paid_amount, 'pending_amount:', list.data.expenses[0].pending_amount);

  // cleanup
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
  } catch (err) { await c.query('ROLLBACK'); console.error(err.message); } finally { c.release(); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
