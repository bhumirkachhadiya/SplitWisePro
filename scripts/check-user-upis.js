const { pool } = require('../db');

async function main() {
  try {
    const res = await pool.query("SELECT id, name, email, upi_id FROM users ORDER BY id ASC");
    console.log("=== USERS & UPI IDs ===");
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();
