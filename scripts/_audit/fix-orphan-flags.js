const { pool } = require('../../db');
(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL session_replication_role = 'replica'");
    const r = await client.query(`
      UPDATE expense_splits es
      SET base_amount = es.amount,
          settled_amount = CASE WHEN b.is_settled THEN es.amount ELSE 0 END,
          settled_amount_base = CASE WHEN b.is_settled THEN es.amount ELSE 0 END,
          is_settled = b.is_settled,
          settled_at = b.settled_at
      FROM expense_splits_backup_v3 b
      WHERE es.id = b.id
        AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.id = es.expense_id)
    `);
    await client.query('COMMIT');
    console.log('orphan splits restored:', r.rowCount);
    const chk = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM expense_splits es WHERE NOT EXISTS (SELECT 1 FROM expenses e WHERE e.id=es.expense_id) AND es.is_settled) orphan_settled,
        (SELECT COALESCE(SUM(amount),0)::numeric FROM expense_splits WHERE is_settled) settled_total,
        (SELECT COUNT(*)::int FROM expense_splits WHERE is_settled) settled_count
    `);
    console.table(chk.rows);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit();
  }
})();
