const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function clean() {
    console.log('Cleaning up leftover automated test groups...');
    
    // Unmark settled on splits for test groups
    await pool.query(`
        UPDATE expense_splits 
        SET is_settled = false 
        WHERE expense_id IN (SELECT id FROM expenses WHERE group_id IN (SELECT id FROM groups WHERE name LIKE 'Feedback_Test_%'))
    `);

    // Delete settlement allocations
    await pool.query(`
        DELETE FROM settlement_allocations 
        WHERE expense_id IN (SELECT id FROM expenses WHERE group_id IN (SELECT id FROM groups WHERE name LIKE 'Feedback_Test_%'))
    `);

    // Delete settlements for test groups
    await pool.query(`
        DELETE FROM settlements 
        WHERE group_id IN (SELECT id FROM groups WHERE name LIKE 'Feedback_Test_%')
    `);

    // Delete expense splits
    await pool.query(`
        DELETE FROM expense_splits 
        WHERE expense_id IN (SELECT id FROM expenses WHERE group_id IN (SELECT id FROM groups WHERE name LIKE 'Feedback_Test_%'))
    `);

    await pool.query(`
        DELETE FROM expense_payers 
        WHERE expense_id IN (SELECT id FROM expenses WHERE group_id IN (SELECT id FROM groups WHERE name LIKE 'Feedback_Test_%'))
    `);

    await pool.query(`
        DELETE FROM expenses 
        WHERE group_id IN (SELECT id FROM groups WHERE name LIKE 'Feedback_Test_%')
    `);

    await pool.query(`
        DELETE FROM chat_messages 
        WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id IN (SELECT id FROM groups WHERE name LIKE 'Feedback_Test_%'))
    `);

    await pool.query(`
        DELETE FROM chat_conversation_members 
        WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id IN (SELECT id FROM groups WHERE name LIKE 'Feedback_Test_%'))
    `);

    await pool.query(`
        DELETE FROM chat_conversations 
        WHERE group_id IN (SELECT id FROM groups WHERE name LIKE 'Feedback_Test_%')
    `);

    await pool.query(`
        DELETE FROM payment_requests 
        WHERE group_id IN (SELECT id FROM groups WHERE name LIKE 'Feedback_Test_%')
    `);

    await pool.query(`
        DELETE FROM group_members 
        WHERE group_id IN (SELECT id FROM groups WHERE name LIKE 'Feedback_Test_%')
    `);

    const delRes = await pool.query(`
        DELETE FROM groups 
        WHERE name LIKE 'Feedback_Test_%'
    `);

    console.log(`Successfully deleted ${delRes.rowCount} test groups.`);

    const remaining = await pool.query('SELECT id, name, category, cover_photo_url, icon_url FROM groups ORDER BY id ASC');
    console.log('Remaining real user groups:');
    remaining.rows.forEach(g => {
        console.log(`- [ID: ${g.id}] ${g.name} (${g.category})`);
    });

    // Also clean up broken avatar_url on user 1
    const userRes = await pool.query(`
        UPDATE users 
        SET avatar_url = NULL 
        WHERE id = 1 AND avatar_url LIKE '/uploads/avatars/%'
    `);
    console.log('Reset broken ephemeral avatar_url for user 1:', userRes.rowCount);

    await pool.end();
}

clean().catch(err => {
    console.error('Error in cleanup:', err);
    process.exit(1);
});
