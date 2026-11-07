const { pool } = require('../../db');
(async () => {
  for (const name of ['activity_logs', 'groups', 'group_members', 'users']) {
    const c = await pool.query("SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position", [name]);
    console.log('\n== ' + name + ' ==');
    console.table(c.rows);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
