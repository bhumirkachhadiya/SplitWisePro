require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const groupsRes = await pool.query('SELECT id, name FROM groups ORDER BY id ASC');
  for (const g of groupsRes.rows) {
    const expenses = await pool.query('SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as sum FROM expenses WHERE group_id = $1', [g.id]);
    const splits = await pool.query(`
      SELECT COUNT(*) as total_splits,
             COUNT(CASE WHEN es.is_settled THEN 1 END) as settled_splits,
             COALESCE(SUM(es.amount), 0) as total_split_amt,
             COALESCE(SUM(CASE WHEN es.is_settled THEN es.amount ELSE 0 END), 0) as settled_split_amt
      FROM expense_splits es
      JOIN expenses e ON es.expense_id = e.id
      WHERE e.group_id = $1
    `, [g.id]);
    const settlements = await pool.query('SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as sum FROM settlements WHERE group_id = $1', [g.id]);
    
    if (parseInt(splits.rows[0].settled_splits) > 0 || parseInt(settlements.rows[0].c) > 0) {
      console.log(`Group ${g.id} (${g.name}): Expenses = ₹${expenses.rows[0].sum} (${expenses.rows[0].c}), Settled Splits = ${splits.rows[0].settled_splits}/${splits.rows[0].total_splits} (₹${splits.rows[0].settled_split_amt}), Group Settlements = ${settlements.rows[0].c} (₹${settlements.rows[0].sum})`);
    }
  }
  await pool.end();
}
run();
