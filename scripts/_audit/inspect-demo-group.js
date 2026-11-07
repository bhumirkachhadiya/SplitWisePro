const { pool } = require('../../db');
(async () => {
  const g = await pool.query("SELECT id, name, created_by, is_locked FROM groups WHERE name ILIKE '%demofrjbt%' OR name ILIKE '%demo%' ORDER BY id DESC LIMIT 5");
  console.table(g.rows);
  for (const row of g.rows) {
    console.log('\nGROUP', row.id, row.name);
    const e = await pool.query("SELECT id, description, amount, paid_by, split_type, created_at FROM expenses WHERE group_id=$1 ORDER BY id", [row.id]);
    console.table(e.rows);
    for (const exp of e.rows) {
      const s = await pool.query("SELECT user_id, amount, settled_amount, is_settled, is_locked FROM expense_splits WHERE expense_id=$1 ORDER BY user_id", [exp.id]);
      console.table(s.rows);
    }
    const st = await pool.query("SELECT payer_id, receiver_id, amount, created_at FROM settlements WHERE group_id=$1 ORDER BY id", [row.id]);
    console.table(st.rows);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
