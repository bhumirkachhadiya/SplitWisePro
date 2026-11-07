const { pool } = require('../db');

async function main() {
  try {
    const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'groups'
      ORDER BY ordinal_position
    `);
    console.log("=== GROUPS COLUMNS ===");
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();
