const { pool } = require('../../db');
const bcrypt = require('bcrypt');
(async () => {
  const password = process.env.INITIAL_MASTER_PASSWORD || 'SplitWiseMaster@2026';
  const hash = await bcrypt.hash(password, 10);
  const r = await pool.query(`
    UPDATE system_security_settings
    SET value_hash = $1, is_enabled = TRUE,
        metadata = COALESCE(metadata, '{}'::jsonb) || '{"algorithm":"bcrypt","scope":"development"}'::jsonb,
        updated_at = NOW()
    WHERE key = 'master_password'
    RETURNING key, is_enabled
  `, [hash]);
  console.table(r.rows);
  const check = await bcrypt.compare(password, (await pool.query("SELECT value_hash FROM system_security_settings WHERE key='master_password'")).rows[0].value_hash);
  console.log('password verifies against stored hash:', check);
  process.exit(check ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
