const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    console.log('=== CHECKING EXPENSE 65 (Hotel Booking) ===');
    const exp = await pool.query('SELECT * FROM expenses WHERE id = 65');
    console.log('Expense 65:', exp.rows[0]);

    const splits = await pool.query('SELECT es.*, u.name FROM expense_splits es JOIN users u ON u.id = es.user_id WHERE expense_id = 65');
    console.log('Splits for Expense 65:', splits.rows);

    const payers = await pool.query('SELECT ep.*, u.name FROM expense_payers ep JOIN users u ON u.id = ep.user_id WHERE expense_id = 65');
    console.log('Payers for Expense 65:', payers.rows);

    const allocs = await pool.query('SELECT * FROM settlement_allocations WHERE expense_id = 65');
    console.log('settlement_allocations for Expense 65:', allocs.rows);

    const settlements = await pool.query('SELECT * FROM settlements WHERE expense_id = 65');
    console.log('settlements for Expense 65:', settlements.rows);

    // Also check all settlements between Amit (26) and Charlie (1)
    const directSettlements = await pool.query(`
        SELECT * FROM settlements 
        WHERE (payer_id = 26 AND receiver_id = 1) OR (payer_id = 1 AND receiver_id = 26)
        ORDER BY created_at DESC
    `);
    console.log('All Settlements between Amit (26) and Charlie (1):', directSettlements.rows);

    await pool.end();
}

run().catch(console.error);
