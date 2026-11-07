const { pool } = require('../../db');
(async () => {
  const q = await pool.query(`SELECT
    (SELECT count(*)::int FROM users) users,
    (SELECT count(*)::int FROM groups) groups,
    (SELECT count(*)::int FROM expenses) expenses,
    (SELECT count(*)::int FROM expense_splits) splits,
    (SELECT count(*)::int FROM settlements) settlements,
    (SELECT count(*)::int FROM activity_logs) activity,
    (SELECT count(*)::int FROM upi_payment_requests) upi,
    (SELECT count(*)::int FROM upi_payment_requests WHERE status='PENDING') pending`);
  console.log(q.rows[0]);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
