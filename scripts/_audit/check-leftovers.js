const { pool } = require('../../db');
(async () => {
  const c = await pool.query(`SELECT
    (SELECT count(*)::int FROM groups) groups,
    (SELECT count(*)::int FROM expenses) expenses,
    (SELECT count(*)::int FROM expense_splits) splits,
    (SELECT count(*)::int FROM settlements) settlements,
    (SELECT count(*)::int FROM users) users`);
  console.table(c.rows);
  const g = await pool.query(`SELECT id, name, created_at FROM groups ORDER BY id DESC LIMIT 8`);
  console.table(g.rows);
  const e = await pool.query(`SELECT id, group_id, paid_by, amount, description, created_at FROM expenses ORDER BY id DESC LIMIT 8`);
  console.table(e.rows);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
