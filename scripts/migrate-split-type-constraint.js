const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres123@localhost:5432/splitwise_db',
    ssl: (process.env.NODE_ENV === 'production' || (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase'))) 
        ? { rejectUnauthorized: false } 
        : false
});

async function migrate() {
    console.log('--- Migrating expenses.split_type constraint ---');
    try {
        const checkRes = await pool.query(`
            SELECT conname, pg_get_constraintdef(oid) as def 
            FROM pg_constraint 
            WHERE conrelid = 'expenses'::regclass AND contype = 'c';
        `);
        console.log('Existing constraints on expenses:', checkRes.rows);

        console.log('Dropping expenses_split_type_check if exists...');
        await pool.query('ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_split_type_check;');

        console.log('Adding new constraint with smart_custom...');
        await pool.query(`
            ALTER TABLE expenses 
            ADD CONSTRAINT expenses_split_type_check 
            CHECK (split_type IN ('equal', 'exact', 'percentage', 'shares', 'smart_custom'));
        `);

        console.log('✓ Successfully updated expenses_split_type_check constraint!');
    } catch (e) {
        console.error('Migration failed:', e);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
