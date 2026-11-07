const { pool } = require('../../db');
(async () => {
  const r = await pool.query("select currency, count(*) n, sum(amount) total from expenses group by currency order by n desc");
  console.table(r.rows);
  const g = await pool.query("select base_currency, count(*) n from groups group by base_currency");
  console.table(g.rows);
  const s = await pool.query("select currency, count(*) n from settlements group by currency");
  console.table(s.rows);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
