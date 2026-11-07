const { pool } = require('../../db');
(async () => {
  const q = async (label, sql, p = []) => { const r = await pool.query(sql, p); console.log('\n=== ' + label + ' ==='); console.table(r.rows); };
  await q('splits with base_amount=0', `
    SELECT COUNT(*)::int n, SUM(amount)::numeric total
    FROM expense_splits WHERE base_amount = 0 AND amount > 0`);
  await q('orphan splits settled', `
    SELECT COUNT(*)::int n, SUM(amount)::numeric total
    FROM expense_splits es WHERE NOT EXISTS (SELECT 1 FROM expenses e WHERE e.id=es.expense_id) AND es.is_settled`);
  await q('existing splits settled', `
    SELECT COUNT(*)::int n, SUM(amount)::numeric total
    FROM expense_splits es WHERE EXISTS (SELECT 1 FROM expenses e WHERE e.id=es.expense_id) AND es.is_settled`);
  await q('existing splits with base=0', `
    SELECT COUNT(*)::int n FROM expense_splits es JOIN expenses e ON e.id=es.expense_id WHERE es.base_amount=0 AND es.amount>0`);
  await q('base sum vs converted', `
    SELECT e.id, e.amount, e.converted_amount, SUM(es.base_amount) base_sum
    FROM expenses e JOIN expense_splits es ON es.expense_id=e.id
    GROUP BY e.id HAVING ABS(SUM(es.base_amount) - COALESCE(e.converted_amount,e.amount)) > 0.02 ORDER BY e.id LIMIT 20`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
