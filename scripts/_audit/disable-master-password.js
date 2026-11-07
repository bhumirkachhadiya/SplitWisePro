const { pool } = require('../../db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
(async () => {
  const hash = await bcrypt.hash(crypto.randomBytes(48).toString('hex'), 10);
  const r = await pool.query(
    "UPDATE system_security_settings SET is_enabled = FALSE, value_hash = $1, updated_at = NOW() WHERE key = 'master_password' RETURNING key, is_enabled",
    [hash]
  );
  console.table(r.rows);
  console.log('master password credential randomised and disabled.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
