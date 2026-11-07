const { pool } = require('../../db');
(async () => {
  const r = await pool.query("UPDATE upi_payment_requests SET status='EXPIRED', updated_at=NOW() WHERE status='PENDING' AND claimed_at IS NULL");
  console.log('expired unclaimed pending:', r.rowCount);
  const s = await pool.query("SELECT status, COUNT(*)::int n FROM upi_payment_requests GROUP BY status ORDER BY status");
  console.table(s.rows);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
