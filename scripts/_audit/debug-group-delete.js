const { openPage } = require('./cdp-lib');
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
  const suffix = Date.now();
  const gA = await api('POST', '/api/groups', alexT, { name: 'DBGDEL Money ' + suffix, members: [{ user_id: 2 }] });
  const gB = await api('POST', '/api/groups', alexT, { name: 'DBGDEL Empty ' + suffix, members: [] });
  const gidA = gA.data.id, gidB = gB.data.id;
  await api('POST', '/api/expenses', alexT, { group_id: gidA, paid_by: 1, amount: 100, description: 'x', split_type: 'equal', splits: [{ user_id: 1 }, { user_id: 2 }] });
  console.log('gidA,gidB', gidA, gidB);

  const c = await openPage(BASE + '/');
  await c.waitFor('document.readyState === "complete"');
  await c.send('Network.clearBrowserCookies');
  await c.evaluate('localStorage.clear(); sessionStorage.clear();');
  await c.goto(BASE + '/');
  await new Promise(r => setTimeout(r, 800));
  await c.evaluate(`(() => { document.getElementById('authEmail').value='alex'; document.getElementById('authPassword').value='password123'; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  await c.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 20000);
  await new Promise(r => setTimeout(r, 2500));
  await c.evaluate(`navigateTo('groups')`);
  await new Promise(r => setTimeout(r, 1500));
  console.log('groups state:', await c.evaluate(`({ ids: allGroups.map(g=>g.id), hA: (allGroups.find(g=>String(g.id)==='${gidA}')||{}).has_financial_history, hB: (allGroups.find(g=>String(g.id)==='${gidB}')||{}).has_financial_history, pending: pendingGroupToDelete })`));

  // Click B delete
  c.network.length = 0; c.errors.length = 0;
  await c.evaluate(`document.querySelector("button[onclick*=\\"openDeleteGroupModal('${gidB}')\\"]").click()`);
  await new Promise(r => setTimeout(r, 600));
  console.log('after B click:', await c.evaluate(`({ pending: pendingGroupToDelete, delModal: !document.getElementById('deleteGroupModal').classList.contains('hidden'), confirmModal: !document.getElementById('customConfirmModal').classList.contains('hidden') })`));
  await c.evaluate(`document.getElementById('confirmDeleteGroupBtn').click()`);
  await new Promise(r => setTimeout(r, 2500));
  console.log('after confirm:', await c.evaluate(`({ pending: pendingGroupToDelete })`));
  console.log('network:', c.network);
  console.log('errors:', c.errors.slice(0, 5));
  const b = await api('GET', '/api/groups/' + gidB, alexT);
  console.log('B GET after UI delete:', b.status, b.text.slice(0, 120));

  // cleanup
  const cl = await pool.connect();
  try {
    await cl.query('BEGIN'); await cl.query("SET LOCAL session_replication_role='replica'");
    for (const gid of [gidA, gidB]) {
      await cl.query('DELETE FROM activity_logs WHERE group_id=$1', [gid]);
      await cl.query('DELETE FROM settlements WHERE group_id=$1', [gid]);
      await cl.query('DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE group_id=$1)', [gid]);
      await cl.query('DELETE FROM expenses WHERE group_id=$1', [gid]);
      await cl.query('DELETE FROM group_members WHERE group_id=$1', [gid]);
      await cl.query('DELETE FROM groups WHERE id=$1', [gid]);
    }
    await cl.query('COMMIT');
  } catch (e) { await cl.query('ROLLBACK'); console.error(e.message); } finally { cl.release(); }
  c.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
