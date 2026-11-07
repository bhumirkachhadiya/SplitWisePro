const { pool } = require('../../db');
(async () => {
  const r = await pool.query("DELETE FROM chat_messages WHERE message LIKE 'Browser chat audit%' OR message LIKE '%<img src=x%' RETURNING id");
  console.log('removed', r.rowCount);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
