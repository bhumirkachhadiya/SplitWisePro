const { pool } = require('../db');

async function main() {
  try {
    const res = await pool.query("SELECT * FROM settlements ORDER BY id DESC LIMIT 20");
    console.log("=== RECENT SETTLEMENTS ===");
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();
