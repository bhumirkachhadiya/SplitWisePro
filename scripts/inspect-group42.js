require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const splits = await pool.query(`
    SELECT es.*, u.name 
    FROM expense_splits es 
    JOIN users u ON es.user_id = u.id 
    WHERE es.expense_id = 45
  `);
  console.log('Splits for Expense 45:', splits.rows);

  const settlements = await pool.query(`
    SELECT s.*, p.name as payer_name, r.name as receiver_name 
    FROM settlements s
    JOIN users p ON s.payer_id = p.id
    JOIN users r ON s.receiver_id = r.id
    WHERE s.group_id = 42 OR (s.payer_id IN (1,3,4,13) AND s.receiver_id IN (1,3,4,13))
  `);
  console.log('Settlements:', settlements.rows);

  await pool.end();
}
run();
