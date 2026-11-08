const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function runMigration() {
    console.log('Applying dual settlement schema migration...');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(`
            ALTER TABLE settlements ADD COLUMN IF NOT EXISTS settlement_type VARCHAR(32) DEFAULT 'DIRECT';
            ALTER TABLE settlements ADD COLUMN IF NOT EXISTS expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL;

            ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS settlement_type VARCHAR(32) DEFAULT 'EXPENSE_WISE';
            ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS expense_allocations JSONB;

            CREATE TABLE IF NOT EXISTS settlement_allocations (
                id SERIAL PRIMARY KEY,
                settlement_id INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
                expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
                debtor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                creditor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_settlement_allocations_settlement ON settlement_allocations(settlement_id);
            CREATE INDEX IF NOT EXISTS idx_settlement_allocations_expense ON settlement_allocations(expense_id);
            CREATE INDEX IF NOT EXISTS idx_settlement_allocations_debtor ON settlement_allocations(debtor_id);
            CREATE INDEX IF NOT EXISTS idx_settlement_allocations_creditor ON settlement_allocations(creditor_id);
        `);

        await client.query('COMMIT');
        console.log('✓ Dual settlement schema migration completed successfully!');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Migration failed:', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration();
