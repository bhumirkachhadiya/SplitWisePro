const { pool } = require('../../db');

(async () => {
  const q = async (label, sql, params = []) => {
    const r = await pool.query(sql, params);
    console.log('\n=== ' + label + ' ===');
    console.table(r.rows);
  };

  await q('expenses: split sum vs amount mismatches', `
    SELECT e.id, e.amount, COALESCE(SUM(es.amount),0) split_sum,
           (e.amount - COALESCE(SUM(es.amount),0)) diff, e.split_type, e.group_id, e.paid_by, e.description
    FROM expenses e LEFT JOIN expense_splits es ON es.expense_id=e.id
    GROUP BY e.id HAVING ABS(e.amount - COALESCE(SUM(es.amount),0)) > 0.005
    ORDER BY e.id`);

  await q('expense count / split count / settled', `
    SELECT (SELECT COUNT(*) FROM expenses) expenses,
           (SELECT COUNT(*) FROM expense_splits) splits,
           (SELECT COUNT(*) FROM expense_splits WHERE is_settled) settled_splits,
           (SELECT COUNT(*) FROM settlements) settlements,
           (SELECT COALESCE(SUM(amount),0) FROM settlements) settlement_total,
           (SELECT COALESCE(SUM(amount),0) FROM expense_splits WHERE is_settled) settled_split_total`);

  await q('per-pair: split debt vs recorded settlements', `
    WITH debt AS (
      SELECT es.user_id debtor, e.paid_by creditor, SUM(es.amount) amt,
             SUM(CASE WHEN es.is_settled THEN es.amount ELSE 0 END) settled_amt
      FROM expense_splits es JOIN expenses e ON e.id=es.expense_id
      WHERE es.user_id <> e.paid_by GROUP BY 1,2
    ), sett AS (
      SELECT payer_id debtor, receiver_id creditor, SUM(amount) amt FROM settlements GROUP BY 1,2
    )
    SELECT COALESCE(d.debtor,s.debtor) debtor, COALESCE(d.creditor,s.creditor) creditor,
           COALESCE(d.amt,0) debt, COALESCE(d.settled_amt,0) settled_splits,
           COALESCE(s.amt,0) settlements,
           ROUND(COALESCE(d.amt,0)-COALESCE(s.amt,0),2) debt_minus_settlements,
           ROUND(COALESCE(d.amt,0)-COALESCE(d.settled_amt,0),2) outstanding_by_flag
    FROM debt d FULL OUTER JOIN sett s ON d.debtor=s.debtor AND d.creditor=s.creditor
    ORDER BY ABS(COALESCE(d.amt,0)-COALESCE(s.amt,0)) DESC`);

  await q('groups totals', `
    SELECT g.id, g.name, g.is_locked, COUNT(DISTINCT e.id) exp_count,
           COALESCE(SUM(DISTINCT e.amount),0) sum_distinct, COALESCE(SUM(e.amount),0) naive_sum
    FROM groups g LEFT JOIN expenses e ON e.group_id=g.id GROUP BY g.id ORDER BY g.id`);

  await q('duplicate expense signatures', `
    SELECT group_id, paid_by, amount, lower(description) d, COUNT(*) c
    FROM expenses GROUP BY 1,2,3,4 HAVING COUNT(*)>1 ORDER BY c DESC`);

  await q('orphan checks', `
    SELECT
      (SELECT COUNT(*) FROM expense_splits es LEFT JOIN expenses e ON e.id=es.expense_id WHERE e.id IS NULL) orphan_splits,
      (SELECT COUNT(*) FROM expense_splits es LEFT JOIN users u ON u.id=es.user_id WHERE u.id IS NULL) split_bad_user,
      (SELECT COUNT(*) FROM expenses e LEFT JOIN groups g ON g.id=e.group_id WHERE g.id IS NULL) expense_bad_group,
      (SELECT COUNT(*) FROM expenses e LEFT JOIN users u ON u.id=e.paid_by WHERE u.id IS NULL) expense_bad_payer`);

  await q('members not in any group vs settlements', `SELECT COUNT(*) FROM settlements WHERE group_id IS NULL`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
