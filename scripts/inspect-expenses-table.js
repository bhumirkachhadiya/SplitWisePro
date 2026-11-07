const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres123@localhost:5432/splitwise_db',
    ssl: (process.env.NODE_ENV === 'production' || (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase'))) ? { rejectUnauthorized: false } : false
});

async function check() {
    const res1 = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'expense_splits'");
    console.log('Columns in expense_splits:');
    res1.rows.forEach(r => console.log(` - ${r.column_name}: ${r.data_type}`));

    const res2 = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'settlements'");
    console.log('\nColumns in settlements:');
    res2.rows.forEach(r => console.log(` - ${r.column_name}: ${r.data_type}`));

    await pool.end();
}

check().catch(console.error);
