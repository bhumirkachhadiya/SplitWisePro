const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/splitwise'
});

async function runSync() {
    try {
        console.log('--- Syncing all groups into chat_conversations ---');
        const insConvs = await pool.query(`
            INSERT INTO chat_conversations (group_id, title, type, created_by)
            SELECT g.id, g.name, 'group', COALESCE(g.created_by, 1)
            FROM groups g
            WHERE NOT EXISTS (
                SELECT 1 FROM chat_conversations c WHERE c.group_id = g.id
            )
            RETURNING id, title;
        `);
        console.log(`Created ${insConvs.rowCount} new circle threads:`, insConvs.rows);

        const insMembers = await pool.query(`
            INSERT INTO chat_conversation_members (conversation_id, user_id)
            SELECT c.id, gm.user_id
            FROM chat_conversations c
            JOIN group_members gm ON gm.group_id = c.group_id
            ON CONFLICT (conversation_id, user_id) DO NOTHING
            RETURNING *;
        `);
        console.log(`Enrolled ${insMembers.rowCount} members into circle threads`);

        // Check conversations for user 23 (Charlie)
        const charlieConvs = await pool.query(`
            SELECT c.id, c.title, c.type, g.name as group_name
            FROM chat_conversations c
            JOIN chat_conversation_members cm ON cm.conversation_id = c.id
            LEFT JOIN groups g ON g.id = c.group_id
            WHERE cm.user_id = 23;
        `);
        console.log("Charlie's conversations now:", charlieConvs.rows);
    } catch (e) {
        console.error('Error during sync:', e.message);
    } finally {
        await pool.end();
    }
}

runSync();
