const { pool } = require('../../db');
(async () => {
  const trg = await pool.query(`
    SELECT tgname, relname, pg_get_triggerdef(t.oid) def
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY relname, tgname`);
  console.table(trg.rows.map(r => ({ table: r.relname, trigger: r.tgname, def: r.def.slice(0, 160) })));

  const leftover = await pool.query(`SELECT id, name FROM groups WHERE name LIKE 'PAY Audit %' OR name LIKE 'AUDIT Circle %' OR name LIKE 'BROWSER Circle %' ORDER BY id`);
  console.log('leftover test groups:', leftover.rows);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
