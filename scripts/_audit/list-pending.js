const { pool } = require('../../db');
(async () => {
  const r = await pool.query(`
    SELECT u.request_id, u.payer_id, p.name payer, u.receiver_id, r.name receiver,
           u.amount, u.status, u.claimed_at, u.group_id, u.created_at
    FROM upi_payment_requests u
    LEFT JOIN users p ON p.id = u.payer_id
    LEFT JOIN users r ON r.id = u.receiver_id
    WHERE u.status = 'PENDING'
    ORDER BY u.created_at DESC
  `);
  console.table(r.rows);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
