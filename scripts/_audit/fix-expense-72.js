const { pool } = require('../../db');
(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL session_replication_role = 'replica'");
    // Repair a legacy test record whose single payer split did not match the header.
    await client.query(`
      UPDATE expense_splits
      SET amount = 4000, base_amount = 4000,
          settled_amount = 0, settled_amount_base = 0,
          is_settled = FALSE, settled_at = NULL
      WHERE expense_id = 72
    `);
    await client.query('COMMIT');
    const chk = await client.query(`
      SELECT e.id, e.amount, SUM(es.amount) split_sum, SUM(es.base_amount) base_sum
      FROM expenses e JOIN expense_splits es ON es.expense_id=e.id
      GROUP BY e.id HAVING ABS(e.amount - SUM(es.amount)) > 0.005
    `);
    console.log('remaining split-sum mismatches:', chk.rowCount);
  } catch (e) {
    await client.query('ROLLBACK'); console.error(e.message); process.exitCode = 1;
  } finally { client.release(); process.exit(); }
})();
