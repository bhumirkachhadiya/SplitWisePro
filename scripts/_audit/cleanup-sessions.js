const { pool } = require('../../db');
(async () => {
  const s = await pool.query("DELETE FROM user_sessions WHERE expires_at < NOW() OR revoked_at IS NOT NULL OR last_used_at < NOW() - INTERVAL '2 hours'");
  const u = await pool.query("UPDATE upi_payment_requests SET status='EXPIRED', updated_at=NOW() WHERE status='PENDING' AND created_at < NOW() - INTERVAL '15 minutes' AND settlement_id IS NULL");
  console.log('sessions removed:', s.rowCount, '| stale pending payments expired:', u.rowCount);
  const left = await pool.query("SELECT status, COUNT(*)::int n FROM upi_payment_requests GROUP BY status ORDER BY status");
  console.table(left.rows);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
