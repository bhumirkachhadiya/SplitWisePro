const { pool } = require('../../db');

(async () => {
  const t = await pool.query(
    "select table_name, table_type from information_schema.tables where table_schema='public' order by table_type, table_name"
  );
  console.log('TABLES/VIEWS:', t.rows.length);
  for (const r of t.rows) {
    let n = '';
    if (r.table_type === 'BASE TABLE') {
      const c = await pool.query(`select count(*)::int n from "${r.table_name}"`);
      n = c.rows[0].n;
    }
    console.log(' ', r.table_type.padEnd(10), r.table_name.padEnd(32), n);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
