const { pool } = require('../../db');
(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL session_replication_role = 'replica'");
    const r = await client.query(`
      UPDATE expense_splits es
      SET settled_amount = 0,
          settled_amount_base = 0,
          is_settled = TRUE
      FROM expenses e
      WHERE e.id = es.expense_id
        AND es.user_id = e.paid_by
        AND (es.settled_amount <> 0 OR es.settled_amount_base <> 0)
    `);
    await client.query('COMMIT');
    console.log('payer-owned split rows normalised:', r.rowCount);
    const chk = await client.query(`
      SELECT COUNT(*)::int n FROM expense_splits es
      JOIN expenses e ON e.id = es.expense_id
      WHERE es.user_id = e.paid_by AND (es.settled_amount <> 0 OR es.settled_amount_base <> 0)
    `);
    console.log('remaining payer rows with settled amounts:', chk.rows[0].n);
  } catch (e) {
    await client.query('ROLLBACK'); console.error(e.message); process.exitCode = 1;
  } finally { client.release(); process.exit(); }
})();
