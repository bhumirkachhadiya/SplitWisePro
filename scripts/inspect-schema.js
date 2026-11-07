require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        const splitsCols = await pool.query(`
            SELECT column_name, data_type, is_nullable, column_default 
            FROM information_schema.columns 
            WHERE table_name = 'expense_splits'
            ORDER BY ordinal_position
        `);
        console.log('expense_splits columns:', splitsCols.rows);

        const expCols = await pool.query(`
            SELECT column_name, data_type, is_nullable, column_default 
            FROM information_schema.columns 
            WHERE table_name = 'expenses'
            ORDER BY ordinal_position
        `);
        console.log('expenses columns:', expCols.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
main();
