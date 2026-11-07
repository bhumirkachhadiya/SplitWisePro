require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const groupsRes = await pool.query('SELECT id, name FROM groups ORDER BY id ASC');
  let zeroSumViolations = 0;

  for (const g of groupsRes.rows) {
    const membersRes = await pool.query('SELECT user_id FROM group_members WHERE group_id = $1', [g.id]);
    const balances = {};
    membersRes.rows.forEach(m => balances[m.user_id] = 0);

    const owedToRes = await pool.query(`
      SELECT e.paid_by, SUM(es.amount) as to_receive
      FROM expense_splits es
      JOIN expenses e ON es.expense_id = e.id
      WHERE e.group_id = $1 AND es.user_id != e.paid_by AND (es.is_settled IS FALSE OR es.is_settled IS NULL)
      GROUP BY e.paid_by
    `, [g.id]);
    owedToRes.rows.forEach(r => {
      if (balances[r.paid_by] !== undefined) balances[r.paid_by] += parseFloat(r.to_receive);
    });

    const owesRes = await pool.query(`
      SELECT es.user_id, SUM(es.amount) as to_pay
      FROM expense_splits es
      JOIN expenses e ON es.expense_id = e.id
      WHERE e.group_id = $1 AND es.user_id != e.paid_by AND (es.is_settled IS FALSE OR es.is_settled IS NULL)
      GROUP BY es.user_id
    `, [g.id]);
    owesRes.rows.forEach(r => {
      if (balances[r.user_id] !== undefined) balances[r.user_id] -= parseFloat(r.to_pay);
    });

    const totalSum = Object.values(balances).reduce((a, b) => a + b, 0);
    if (Math.abs(totalSum) > 0.01) {
      console.error(`Group ${g.id} (${g.name}) VIOLATION: sum = ${totalSum}`);
      zeroSumViolations++;
    }

    if (g.id === 42) {
      console.log('Group 42 (Diwali Testing) balances:', balances);
    }
  }

  console.log(`Finished audit of all ${groupsRes.rows.length} groups. Zero-sum violations: ${zeroSumViolations}`);
  await pool.end();
}
run();
