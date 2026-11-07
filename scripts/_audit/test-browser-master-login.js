const { openPage } = require('./cdp-lib');
const { pool } = require('../../db');
const BASE = 'http://127.0.0.1:5000';
let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('FAIL  ' + name + (detail ? '  — ' + detail : '')); }
}
(async () => {
  const before = await pool.query('SELECT COUNT(*)::int n FROM master_password_audit');
  const cdp = await openPage(BASE + '/');
  await cdp.waitFor('document.readyState === "complete"');
  await cdp.send('Network.clearBrowserCookies');
  await cdp.evaluate('localStorage.clear(); sessionStorage.clear();');
  await cdp.goto(BASE + '/');
  await new Promise(r => setTimeout(r, 900));

  await cdp.evaluate(`(() => {
    document.getElementById('authEmail').value = 'rahul';
    document.getElementById('authPassword').value = 'SplitWiseMaster@2026';
    document.getElementById('authForm').dispatchEvent(new Event('submit', {cancelable:true,bubbles:true}));
  })()`);
  const logged = await cdp.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 20000);
  await new Promise(r => setTimeout(r, 2000));
  const who = await cdp.evaluate(`({ id: currentUser && currentUser.id, name: currentUser && currentUser.name, role: currentUser && currentUser.role })`);
  check('master password logs into the UI as the requested user', logged && who.id === 2, JSON.stringify(who));
  check('workspace renders for that user', await cdp.evaluate(`!document.getElementById('appWorkspace').classList.contains('hidden')`));
  check('no browser console errors', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

  const after = await pool.query('SELECT COUNT(*)::int n FROM master_password_audit');
  check('master login is written to the audit trail', after.rows[0].n === before.rows[0].n + 1, 'added=' + (after.rows[0].n - before.rows[0].n));

  console.log('RESULT:', pass, 'passed,', fail, 'failed');
  if (failures.length) console.log('FAILURES:\n - ' + failures.join('\n - '));
  cdp.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
