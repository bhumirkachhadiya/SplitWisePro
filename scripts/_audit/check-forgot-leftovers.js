const { pool } = require('../../db');
(async () => {
  const u = await pool.query("SELECT id,name,email FROM users WHERE email LIKE 'forgot.%@example.com'");
  const p = await pool.query('SELECT COUNT(*)::int n FROM payment_requests');
  const e = await pool.query("SELECT COUNT(*)::int n FROM email_verifications WHERE email LIKE 'forgot.%@example.com'");
  console.table(u.rows);
  console.log('payment_requests', p.rows[0].n, 'forgot_verifs', e.rows[0].n);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
