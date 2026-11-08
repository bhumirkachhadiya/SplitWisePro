const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    const prRes = await pool.query(`
        SELECT pr.*, u_payer.name as payer_name, u_rec.name as rec_name 
        FROM payment_requests pr
        LEFT JOIN users u_payer ON u_payer.id = pr.payer_id
        LEFT JOIN users u_rec ON u_rec.id = pr.receiver_id
        ORDER BY pr.id DESC
        LIMIT 10
    `);
    console.log('--- RECENT PAYMENT REQUESTS ---');
    console.log(JSON.stringify(prRes.rows, null, 2));

    for (const pr of prRes.rows) {
        if (pr.expense_id) {
            const expRes = await pool.query('SELECT * FROM expenses WHERE id = $1', [pr.expense_id]);
            console.log(`\nExpense for request ${pr.id}:`, expRes.rows[0]);

            const splitsRes = await pool.query('SELECT * FROM expense_splits WHERE expense_id = $1', [pr.expense_id]);
            console.log(`Splits for request ${pr.id}:`, splitsRes.rows);

            const allocRes = await pool.query('SELECT * FROM settlement_expense_allocations WHERE expense_id = $1', [pr.expense_id]);
            console.log(`Allocations for request ${pr.id}:`, allocRes.rows);
        }
    }

    await pool.end();
}

run().catch(console.error);
