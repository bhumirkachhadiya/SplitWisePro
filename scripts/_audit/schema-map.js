const { pool } = require('../../db');
(async () => {
  const t = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
  console.log(t.rows.map(r => r.table_name).join('\n'));
  for (const name of ['settlements', 'expense_splits', 'upi_payment_requests', 'notifications', 'expenses']) {
    const c = await pool.query("SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position", [name]);
    console.log('\n== ' + name + ' ==');
    console.table(c.rows);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
