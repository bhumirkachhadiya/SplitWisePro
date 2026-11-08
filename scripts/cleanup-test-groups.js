const { pool } = require('../db');

async function cleanTestGroups() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const groups = await client.query(`SELECT id FROM groups WHERE name LIKE 'Automated Test Group%'`);
        for (const g of groups.rows) {
            const exps = await client.query(`SELECT id FROM expenses WHERE group_id = $1`, [g.id]);
            for (const e of exps.rows) {
                await client.query(`DELETE FROM settlement_allocations WHERE expense_id = $1`, [e.id]);
                await client.query(`DELETE FROM payment_requests WHERE expense_id = $1`, [e.id]);
                await client.query(`UPDATE expense_splits SET is_settled = false, settled_amount = 0, settled_amount_base = 0 WHERE expense_id = $1`, [e.id]);
                await client.query(`DELETE FROM expense_splits WHERE expense_id = $1`, [e.id]);
                await client.query(`DELETE FROM expense_payers WHERE expense_id = $1`, [e.id]);
                await client.query(`DELETE FROM expenses WHERE id = $1`, [e.id]);
            }
            await client.query(`DELETE FROM settlement_allocations WHERE settlement_id IN (SELECT id FROM settlements WHERE group_id = $1)`, [g.id]);
            await client.query(`DELETE FROM payment_requests WHERE group_id = $1`, [g.id]);
            await client.query(`DELETE FROM settlements WHERE group_id = $1`, [g.id]);
            await client.query(`DELETE FROM group_members WHERE group_id = $1`, [g.id]);
            await client.query(`DELETE FROM groups WHERE id = $1`, [g.id]);
            console.log(`Cleaned leftover test group #${g.id}`);
        }
        await client.query('COMMIT');
        console.log('Finished cleaning test groups.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error cleaning test groups:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

cleanTestGroups();
