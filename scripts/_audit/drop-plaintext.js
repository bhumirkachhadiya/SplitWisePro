const { pool } = require('../../db');
(async () => {
  await pool.query('ALTER TABLE users DROP COLUMN IF EXISTS plaintext_password');
  const r = await pool.query("select column_name from information_schema.columns where table_name='users' and column_name='plaintext_password'");
  console.log('remaining plaintext columns:', r.rowCount);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
