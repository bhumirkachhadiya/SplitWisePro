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
async function cleanup(gid) {
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
  } catch (e) { await c.query('ROLLBACK'); console.error(e.message); } finally { c.release(); }
}
(async () => {
  const login = async id => (await api('POST', '/api/users/login', null, { identifier: id, password: 'password123' })).data.session_token;
  const alexT = await login('alex'), rahulT = await login('rahul'), priyaT = await login('priya'), amanT = await login('aman');

  const g = await api('POST', '/api/groups', alexT, { name: 'GROUP Audit ' + Date.now(), members: [{ user_id: 2, role: 'member' }, { user_id: 3, role: 'member' }] });
  const gid = g.data.id;
  check('group created', g.status === 201, 'status=' + g.status);

  const ren = await api('PUT', '/api/groups/' + gid, alexT, { name: 'Renamed Audit Circle', description: 'x', category: 'Test' });
  check('admin can rename group', ren.status === 200, 'status=' + ren.status);
  const renRahul = await api('PUT', '/api/groups/' + gid, rahulT, { name: 'Hacked Name' });
  check('normal member cannot rename group (403)', renRahul.status === 403, 'status=' + renRahul.status);

  const addAman = await api('POST', `/api/groups/${gid}/members`, alexT, { user_id: 4, role: 'editor' });
  check('admin can add member', addAman.status === 201, 'status=' + addAman.status);
  const dupAdd = await api('POST', `/api/groups/${gid}/members`, alexT, { user_id: 4, role: 'editor' });
  check('adding an existing member is idempotent', dupAdd.status === 201, 'status=' + dupAdd.status);

  const rahulPromote = await api('PUT', `/api/groups/${gid}/members/2`, rahulT, { role: 'admin' });
  check('non-admin cannot change roles (403)', rahulPromote.status === 403, 'status=' + rahulPromote.status);
  const alexPromote = await api('PUT', `/api/groups/${gid}/members/2`, alexT, { role: 'editor' });
  check('admin can change a member role', alexPromote.status === 200, 'status=' + alexPromote.status);
  const demoteSelf = await api('PUT', `/api/groups/${gid}/members/1`, alexT, { role: 'member' });
  check('sole admin cannot be demoted', demoteSelf.status === 400, 'status=' + demoteSelf.status);

  const outsiderAdd = await api('POST', `/api/groups/${gid}/members`, priyaT, { user_id: 5, role: 'member' });
  check('normal member cannot add members (403)', outsiderAdd.status === 403, 'status=' + outsiderAdd.status);

  const currencyByMember = await api('PUT', `/api/groups/${gid}/currency`, rahulT, { currency: 'USD' });
  check('non-admin cannot change circle currency (403)', currencyByMember.status === 403, 'status=' + currencyByMember.status);
  const currencyByAdmin = await api('PUT', `/api/groups/${gid}/currency`, alexT, { currency: 'USD' });
  check('admin can change circle currency', currencyByAdmin.status === 200, 'status=' + currencyByAdmin.status);

  const removeAman = await api('DELETE', `/api/groups/${gid}/members/4`, alexT);
  check('admin can remove a member without pending balance', removeAman.status === 200, 'status=' + removeAman.status);

  const lock = await api('POST', `/api/groups/${gid}/lock`, alexT, {});
  const lockAdd = await api('POST', `/api/groups/${gid}/members`, alexT, { user_id: 4 });
  check('locked circle blocks member changes', lock.status === 200 && lockAdd.status === 400, 'addStatus=' + lockAdd.status);
  await api('POST', `/api/groups/${gid}/unlock`, alexT, {});

  const exp = await api('POST', '/api/expenses', alexT, {
    group_id: gid, paid_by: 1, amount: 90, description: 'Delete guard', split_type: 'equal',
    splits: [{ user_id: 1 }, { user_id: 2 }, { user_id: 3 }]
  });
  check('expense created for delete guard', exp.status === 201, 'status=' + exp.status);
  const delWithMoney = await api('DELETE', '/api/groups/' + gid, alexT);
  check('group with financial history cannot be deleted', delWithMoney.status === 403 && delWithMoney.data.code === 'GROUP_HAS_FINANCIAL_HISTORY', 'status=' + delWithMoney.status);
  const delRahul = await api('DELETE', '/api/groups/' + gid, rahulT);
  check('non-creator cannot delete group (403)', delRahul.status === 403, 'status=' + delRahul.status);

  // Empty group delete
  const g2name = 'EMPTY Audit ' + Date.now();
  const g2 = await api('POST', '/api/groups', alexT, { name: g2name, members: [] });
  const g2id = g2.data.id;
  const chatBefore = await pool.query('SELECT COUNT(*)::int n FROM chat_conversations WHERE group_id=$1', [g2id]);
  const delEmpty = await api('DELETE', '/api/groups/' + g2id, alexT);
  const chatAfter = await pool.query('SELECT COUNT(*)::int n FROM chat_conversations WHERE group_id=$1', [g2id]);
  check('empty group can be deleted and its chat cleaned up',
    delEmpty.status === 200 && chatBefore.rows[0].n === 1 && chatAfter.rows[0].n === 0,
    'status=' + delEmpty.status + ' chat ' + chatBefore.rows[0].n + '->' + chatAfter.rows[0].n);
  const auditPreserved = await pool.query("SELECT COUNT(*)::int n FROM activity_logs WHERE activity_type='GROUP_DELETED' AND message LIKE '%' || $1 || '%'", [g2name]);
  check('group deletion leaves an audit record', auditPreserved.rows[0].n === 1, 'records=' + auditPreserved.rows[0].n);

  await cleanup(gid);
  console.log('\nRESULT:', pass, 'passed,', fail, 'failed');
  if (failures.length) console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
