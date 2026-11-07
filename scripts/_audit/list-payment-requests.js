const { pool } = require('../../db');
(async () => {
  const r = await pool.query(`SELECT pr.id, pr.request_code, pr.payer_id, p.name payer, pr.receiver_id, r.name receiver,
    pr.group_id, pr.expense_id, pr.amount, pr.status, pr.created_at
    FROM payment_requests pr LEFT JOIN users p ON p.id=pr.payer_id LEFT JOIN users r ON r.id=pr.receiver_id
    ORDER BY pr.id`);
  console.table(r.rows);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
