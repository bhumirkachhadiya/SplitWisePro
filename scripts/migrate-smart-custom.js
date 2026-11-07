require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
    try {
        console.log('Ensuring is_locked column exists on expense_splits...');
        await pool.query(`
            ALTER TABLE expense_splits 
            ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE;
        `);
        console.log('✓ Successfully ensured is_locked column exists on expense_splits!');
    } catch (err) {
        console.error('Migration error:', err);
    } finally {
        await pool.end();
    }
}
migrate();
