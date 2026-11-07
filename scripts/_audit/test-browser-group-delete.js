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
async function cleanup(gid) {
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
  } catch (e) { await c.query('ROLLBACK'); console.error('cleanup', e.message); } finally { c.release(); }
}
(async () => {
  const alexT = (await api('POST', '/api/users/login', null, { identifier: 'alex', password: 'password123' })).data.session_token;
  const suffix = Date.now();
  const gA = await api('POST', '/api/groups', alexT, { name: 'DELTEST Money ' + suffix, members: [{ user_id: 2, role: 'member' }] });
  const gB = await api('POST', '/api/groups', alexT, { name: 'DELTEST Empty ' + suffix, members: [] });
  const gidA = gA.data.id, gidB = gB.data.id;
  await api('POST', '/api/expenses', alexT, {
    group_id: gidA, paid_by: 1, amount: 300, description: 'Delete-protection base',
    split_type: 'equal', splits: [{ user_id: 1 }, { user_id: 2 }]
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
  await cdp.evaluate(`navigateTo('groups')`);
  await new Promise(r => setTimeout(r, 2000));
  cdp.errors.length = 0;

  // Group with money: delete card shows the safe Lock alternative immediately
  const deleteBtnExists = await cdp.evaluate(`!!document.querySelector("button[onclick*=\\"openDeleteGroupModal('${gidA}')\\"]")`);
  check('delete button is shown for the circle creator', deleteBtnExists);
  await cdp.evaluate(`document.querySelector("button[onclick*=\\"openDeleteGroupModal('${gidA}')\\"]").click()`);
  await new Promise(r => setTimeout(r, 700));
  const lockPrompt = await cdp.waitFor(`(() => { const m = document.getElementById('customConfirmModal'); return m && !m.classList.contains('hidden') && /Cannot Delete/i.test(document.getElementById('customConfirmTitle').innerText); })()`, 8000);
  const promptTitle = await cdp.evaluate(`document.getElementById('customConfirmTitle').innerText`);
  const promptMessage = await cdp.evaluate(`document.getElementById('customConfirmMessage').innerText`);
  check('blocked delete offers the safe Lock alternative', lockPrompt, promptTitle);
  check('explanation mentions financial history and locking', /financial|expense|settlement/i.test(promptMessage) && /lock/i.test(promptMessage), promptMessage.slice(0, 140));
  await cdp.screenshot(path.join(SHOT_DIR, 'group-delete-lock-prompt.png'));

  await cdp.evaluate(`document.getElementById('customConfirmActionBtn').click()`);
  await new Promise(r => setTimeout(r, 3000));
  const groupAfter = await api('GET', '/api/groups/' + gidA, alexT);
  check('choosing Lock locks the circle instead of deleting it', groupAfter.status === 200 && groupAfter.data.is_locked === true, 'status=' + groupAfter.status + ' locked=' + (groupAfter.data && groupAfter.data.is_locked));
  check('no console errors during blocked delete flow', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

  // Empty group: normal delete still works
  await cdp.evaluate(`navigateTo('dashboard')`);
  await new Promise(r => setTimeout(r, 400));
  await cdp.evaluate(`navigateTo('groups')`);
  await new Promise(r => setTimeout(r, 1200));
  await cdp.evaluate(`document.querySelector("button[onclick*=\\"openDeleteGroupModal('${gidB}')\\"]").click()`);
  await new Promise(r => setTimeout(r, 500));
  await cdp.evaluate(`document.getElementById('confirmDeleteGroupBtn').click()`);
  await new Promise(r => setTimeout(r, 2500));
  const gone = await pool.query('SELECT 1 FROM groups WHERE id = $1', [gidB]);
  check('empty circle deletes normally through the UI', gone.rowCount === 0, 'remaining=' + gone.rowCount);

  console.log('\nRESULT:', pass, 'passed,', fail, 'failed');
  if (failures.length) console.log('FAILURES:\n - ' + failures.join('\n - '));
  cdp.close();
  await cleanup(gidA);
  await cleanup(gidB);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
