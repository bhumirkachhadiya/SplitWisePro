const { pool } = require('../../db');
const adminService = require('../../adminService');
const BASE = 'http://127.0.0.1:5000';

(async () => {
  const s = await pool.query("SELECT key, is_enabled, left(value_hash, 7) AS hash_prefix, updated_at FROM system_security_settings");
  console.table(s.rows);

  const audit = await pool.query("SELECT COUNT(*)::int AS n, MAX(created_at) AS last_used FROM master_password_audit");
  console.table(audit.rows);

  console.log('isMasterPasswordAllowed() =', adminService.isMasterPasswordAllowed());
  console.log('verifyMasterPassword("SplitWiseMaster@2026") =', await adminService.verifyMasterPassword('SplitWiseMaster@2026'));

  const login = async (identifier, password) => {
    const r = await fetch(BASE + '/api/users/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password })
    });
    return { status: r.status, body: (await r.text()).slice(0, 90) };
  };
  console.log('alex / SplitWiseMaster@2026 ->', await login('alex', 'SplitWiseMaster@2026'));
  console.log('alex / password123        ->', await login('alex', 'password123'));

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
