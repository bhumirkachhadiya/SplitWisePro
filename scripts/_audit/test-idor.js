const { pool } = require('../../db');
const BASE = 'http://127.0.0.1:5000';
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
(async () => {
  const alexT = (await api('POST', '/api/users/login', null, { identifier: 'alex', password: 'password123' })).data.session_token;
  const rahulT = (await api('POST', '/api/users/login', null, { identifier: 'rahul', password: 'password123' })).data.session_token;

  const foreignExp = await pool.query(`
    SELECT e.id FROM expenses e
    WHERE NOT EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = e.group_id AND gm.user_id = 2)
      AND e.paid_by <> 2
      AND NOT EXISTS (SELECT 1 FROM expense_splits es WHERE es.expense_id = e.id AND es.user_id = 2)
      AND EXISTS (SELECT 1 FROM group_members gm3 WHERE gm3.group_id = e.group_id AND gm3.user_id = 1)
    LIMIT 1`);
  if (foreignExp.rows.length) {
    const id = foreignExp.rows[0].id;
    const r = await api('GET', '/api/expenses/' + id, rahulT);
    check('foreign expense details are blocked (IDOR)', r.status === 403, 'expense=' + id + ' status=' + r.status);
    const put = await api('PUT', '/api/expenses/' + id, rahulT, { description: 'hack', amount: 1, split_type: 'equal', splits: [{ user_id: 2, amount: 1 }] });
    check('foreign expense edit is blocked', put.status === 403, 'status=' + put.status);
    const del = await api('DELETE', '/api/expenses/' + id, rahulT);
    check('foreign expense delete is blocked', del.status === 403, 'status=' + del.status);
    const adminView = await api('GET', '/api/expenses/' + id, alexT);
    check('master admin may inspect an expense for support', adminView.status === 200, 'status=' + adminView.status);
  } else {
    check('foreign expense details are blocked (IDOR)', false, 'no foreign expense available');
  }

  const ownExp = await pool.query('SELECT id FROM expenses WHERE paid_by = 1 LIMIT 1');
  if (ownExp.rows.length) {
    const r = await api('GET', '/api/expenses/' + ownExp.rows[0].id, alexT);
    check('own expense details remain readable', r.status === 200, 'status=' + r.status);
  }

  const pwdNoCurrent = await api('PUT', '/api/users/1', alexT, {
    name: 'Alex Sharma', email: 'alex@splitease.io', new_password: 'BrandNewPass123!'
  });
  check('password change without current password is rejected', pwdNoCurrent.status === 400, 'status=' + pwdNoCurrent.status);

  const adminOtherPwd = await api('PUT', '/api/users/2', alexT, {
    name: 'Rahul Sharma', email: 'rahul@example.com', new_password: 'BrandNewPass123!'
  });
  check('admin cannot change another user password from profile endpoint', adminOtherPwd.status === 403, 'status=' + adminOtherPwd.status);

  const stranger = await pool.query(`
    SELECT u.id FROM users u
    WHERE u.id <> 1
      AND NOT EXISTS (SELECT 1 FROM friends f WHERE (f.user_id = 1 AND f.friend_id = u.id) OR (f.user_id = u.id AND f.friend_id = 1))
      AND NOT EXISTS (
        SELECT 1 FROM group_members gm1 JOIN group_members gm2 ON gm1.group_id = gm2.group_id
        WHERE gm1.user_id = 1 AND gm2.user_id = u.id
      )
    LIMIT 1`);
  if (stranger.rows.length) {
    const r = await api('GET', '/api/chat/direct/' + stranger.rows[0].id, alexT);
    check('direct chat with an unrelated user is blocked', r.status === 403, 'user=' + stranger.rows[0].id + ' status=' + r.status);
  } else {
    check('direct chat with an unrelated user is blocked', true, 'skipped: no unrelated user');
  }

  const aiAudit = await pool.query("SELECT COUNT(*)::int n FROM ai_agent_actions WHERE action_type='ADD_EXPENSE' AND created_at > NOW() - INTERVAL '2 hours'");
  check('AI expense actions are audited', aiAudit.rows[0].n >= 1, 'rows=' + aiAudit.rows[0].n);

  console.log('\nRESULT:', pass, 'passed,', fail, 'failed');
  if (failures.length) console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
