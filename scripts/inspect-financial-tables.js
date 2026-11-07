const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function inspectSchema() {
    try {
        const tables = ['groups', 'expenses', 'expense_splits', 'settlements'];
        for (const t of tables) {
            const cols = await pool.query(`
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = $1
                ORDER BY ordinal_position ASC
            `, [t]);
            console.log(`\n=== Table: ${t} (${cols.rows.length} columns) ===`);
            console.table(cols.rows);
        }
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}
inspectSchema();
