const { pool } = require('../../db');
(async () => {
  const r = await pool.query(`
    SELECT es.id, es.expense_id, e.group_id, es.user_id, es.base_amount, es.settled_amount_base, es.settled_at
    FROM expense_splits es JOIN expenses e ON e.id=es.expense_id
    WHERE es.settled_at >= '2026-11-07 23:31:00+00' AND es.settled_at <= '2026-11-07 23:32:00+00'
    ORDER BY es.id
  `);
  console.table(r.rows);
  const s = await pool.query("SELECT SUM(base_amount)::numeric total FROM expense_splits WHERE settled_at >= '2026-11-07 23:31:00+00' AND settled_at <= '2026-11-07 23:32:00+00'");
  console.log('sum base', s.rows[0].total);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
