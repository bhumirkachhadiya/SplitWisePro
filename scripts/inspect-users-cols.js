const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function inspectColumns() {
    try {
        const res = await pool.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'users'
            ORDER BY ordinal_position ASC;
        `);
        console.table(res.rows);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

inspectColumns();
