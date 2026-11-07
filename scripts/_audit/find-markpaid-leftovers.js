const { pool } = require('../../db');
(async () => {
  const g = await pool.query("SELECT id,name FROM groups WHERE name ILIKE 'MARKPAID%' ORDER BY id");
  const u = await pool.query("SELECT id,name,username FROM users WHERE name ILIKE 'Mkt %' OR name ILIKE 'Browser Debtor%' OR name ILIKE 'Browser Receiver%' ORDER BY id");
  console.table(g.rows); console.table(u.rows);
  const p = await pool.query('SELECT COUNT(*)::int n FROM payment_requests');
  console.log('payment_requests', p.rows[0].n);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
