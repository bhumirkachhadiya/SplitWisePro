const { pool } = require('../db');
const fs = require('fs');

async function main() {
  try {
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND (table_name LIKE '%audit%' OR table_name LIKE '%activ%')
    `);
    console.log("=== AUDIT / ACTIVITY TABLES IN DB ===");
    console.log(tables.rows);

    for (const t of tables.rows) {
      const cols = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = $1 
        ORDER BY ordinal_position
      `, [t.table_name]);
      console.log(`\nColumns for ${t.table_name}:`);
      console.log(cols.rows.map(c => `${c.column_name} (${c.data_type})`).join(', '));

      const count = await pool.query(`SELECT COUNT(*)::int as count FROM ${t.table_name}`);
      console.log(`Total rows in ${t.table_name}:`, count.rows[0].count);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();
