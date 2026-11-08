const { pool } = require('../db');

async function runMigration() {
    console.log('Migrating: Creating expense_payers table...');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.expense_payers (
            id SERIAL PRIMARY KEY,
            expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id),
            amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(expense_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_expense_payers_expense_id ON expense_payers(expense_id);
        CREATE INDEX IF NOT EXISTS idx_expense_payers_user_id ON expense_payers(user_id);

        INSERT INTO expense_payers (expense_id, user_id, amount)
        SELECT id, paid_by, amount FROM expenses
        WHERE paid_by IS NOT NULL
        ON CONFLICT (expense_id, user_id) DO NOTHING;
    `);
    console.log('✓ expense_payers table created and backfilled successfully');
    const r = await pool.query('SELECT count(*) FROM expense_payers');
    console.log('Count in expense_payers:', r.rows[0].count);
}

runMigration().then(() => pool.end()).catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
