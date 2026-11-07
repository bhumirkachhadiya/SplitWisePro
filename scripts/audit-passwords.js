const { pool } = require('../db');

async function run() {
  const res = await pool.query(`
    SELECT id, name, email, user_code,
           CASE 
             WHEN password_hash LIKE '$2b$%' OR password_hash LIKE '$2a$%' THEN 'bcrypt'
             WHEN password_hash LIKE '$argon2%' THEN 'argon2'
             WHEN password_hash IS NOT NULL THEN 'other_hash (' || length(password_hash) || ' chars)'
             ELSE 'NO_HASH'
           END as hash_type,
           is_verified
    FROM users
    ORDER BY id ASC;
  `);

  console.log(`Total users: ${res.rows.length}`);
  console.table(res.rows);
  const weak = res.rows.filter(r => r.hash_type === 'NO_HASH');
  console.log(weak.length === 0 ? '✓ Every account has a hashed password.' : `✗ ${weak.length} account(s) have no password hash!`);

  await pool.end();
  process.exit(weak.length === 0 ? 0 : 1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
