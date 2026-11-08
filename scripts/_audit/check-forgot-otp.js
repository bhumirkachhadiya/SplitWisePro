const { pool } = require('../../db');
(async () => {
  const r = await pool.query("SELECT verification_id,email,purpose,attempts,is_used,expires_at,created_at FROM email_verifications WHERE email='alex@splitease.io' ORDER BY id DESC LIMIT 3");
  console.table(r.rows);
  const u = await pool.query("SELECT id,name,email FROM users WHERE email='alex@splitease.io'");
  console.table(u.rows);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
