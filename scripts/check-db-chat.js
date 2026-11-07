const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/splitwise'
});

async function check() {
    try {
        const groups = await pool.query('SELECT id, name FROM groups');
        console.log('Groups in DB:', groups.rows);

        const groupMembers = await pool.query('SELECT * FROM group_members');
        console.log('Group members in DB:', groupMembers.rows);

        const convs = await pool.query('SELECT * FROM chat_conversations');
        console.log('Chat conversations in DB:', convs.rows);

        const convMembers = await pool.query('SELECT * FROM chat_conversation_members');
        console.log('Chat conversation members in DB:', convMembers.rows);
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await pool.end();
    }
}

check();
