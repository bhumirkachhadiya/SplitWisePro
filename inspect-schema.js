const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function inspect() {
  const tablesRes = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `);
  console.log('--- TABLES ---');
  console.log(tablesRes.rows.map(r => r.table_name));

  const colsRes = await pool.query(`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position;
  `);
  
  const tableCols = {};
  colsRes.rows.forEach(r => {
    if (!tableCols[r.table_name]) tableCols[r.table_name] = [];
    tableCols[r.table_name].push(`${r.column_name} (${r.data_type})`);
  });

  console.log('--- COLUMNS ---');
  for (const [tbl, cols] of Object.entries(tableCols)) {
    console.log(`\nTable: ${tbl}`);
    console.log('  ' + cols.join(', '));
  }

  await pool.end();
}

inspect().catch(err => {
  console.error(err);
  process.exit(1);
});
