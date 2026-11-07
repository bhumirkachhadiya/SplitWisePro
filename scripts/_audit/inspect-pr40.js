const { pool } = require('../../db');
(async () => {
  const r = await pool.query('SELECT * FROM payment_requests WHERE id=40');
  console.log(r.rows[0]);
  const s = await pool.query('SELECT * FROM settlements WHERE id=$1', [r.rows[0].settlement_id]);
  console.log(s.rows[0]);
  const a = await pool.query("SELECT * FROM activity_logs WHERE message ILIKE '%payment%' ORDER BY id DESC LIMIT 10");
  console.table(a.rows);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
