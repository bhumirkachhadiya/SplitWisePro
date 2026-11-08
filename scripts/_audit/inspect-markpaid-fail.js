const { pool } = require('../../db');
(async () => {
  const g = await pool.query("SELECT id,name,created_by FROM groups WHERE name ILIKE 'MARKPAID UI%' ORDER BY id DESC LIMIT 3");
  console.table(g.rows);
  for (const row of g.rows) {
    const e = await pool.query('SELECT id,description,paid_by,amount FROM expenses WHERE group_id=$1', [row.id]);
    console.table(e.rows);
  }
  const u = await pool.query("SELECT id,name,username FROM users WHERE name ILIKE 'Browser Debtor%' ORDER BY id DESC LIMIT 3");
  console.table(u.rows);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
