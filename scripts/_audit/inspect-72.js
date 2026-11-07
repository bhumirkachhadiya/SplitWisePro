const { pool } = require('../../db');
(async () => {
  const e = await pool.query("SELECT id, group_id, paid_by, description, amount, currency, split_type, created_at FROM expenses WHERE id=72");
  console.table(e.rows);
  const s = await pool.query("SELECT id, user_id, amount, base_amount, is_settled, settled_amount, settled_amount_base FROM expense_splits WHERE expense_id=72");
  console.table(s.rows);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
