const { pool } = require('../../db');
const { spawnSync } = require('child_process');
const BASE = 'http://127.0.0.1:5000';
const MASTER = 'SplitWiseMaster@2026';

let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('FAIL  ' + name + (detail ? '  — ' + detail : '')); }
}
async function login(identifier, password) {
  const r = await fetch(BASE + '/api/users/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password })
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}
function gate(env = {}) {
  const res = spawnSync(process.execPath, ['-e', "const a=require('./adminService');console.log(a.isMasterPasswordAllowed())"], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
  return (res.stdout || '').trim();
}

(async () => {
  const before = await pool.query('SELECT COUNT(*)::int n FROM master_password_audit');

  const rahul = await login('rahul', MASTER);
  check('master password logs in as Rahul', rahul.status === 200 && rahul.data.user.id === 2, 'status=' + rahul.status);
  const priya = await login('priya@example.com', MASTER);
  check('master password logs in as Priya', priya.status === 200 && priya.data.user.id === 3, 'status=' + priya.status);

  const normal = await login('alex', 'password123');
  check('normal account password still works', normal.status === 200, 'status=' + normal.status);

  const wrong = await login('rahul', 'definitely-not-the-master-password');
  check('wrong shared password is rejected', wrong.status === 400, 'status=' + wrong.status);

  const after = await pool.query('SELECT COUNT(*)::int n FROM master_password_audit');
  check('each master login is audited', after.rows[0].n === before.rows[0].n + 2, 'added=' + (after.rows[0].n - before.rows[0].n));

  const cfgLogin = await login('alex', 'password123');
  const cfgRes = await fetch(BASE + '/api/admin/master-password/config', { headers: { Authorization: 'Bearer ' + cfgLogin.data.session_token } });
  const cfg = await cfgRes.json();
  check('admin tab config reports the facility enabled', cfgRes.status === 200 && cfg.enabled === true && cfg.is_environment_allowed === true, JSON.stringify(cfg));

  check('facility is allowed under NODE_ENV=production', gate({ NODE_ENV: 'production' }) === 'true');
  check('facility is allowed under APP_ENV=production', gate({ APP_ENV: 'production' }) === 'true');
  check('DISABLE_MASTER_PASSWORD=true disables it', gate({ DISABLE_MASTER_PASSWORD: 'true' }) === 'false');

  console.log('\nRESULT:', pass, 'passed,', fail, 'failed');
  if (failures.length) console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
