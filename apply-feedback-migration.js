const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function applyMigration() {
    console.log('--- Applying Migration 003: Feedback Improvements ---');
    const sqlPath = path.join(__dirname, 'migrations', '003_feedback_improvements.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    const client = await pool.connect();
    try {
        await client.query(sql);
        console.log('✓ Migration 003 successfully applied!');

        // Verify columns
        const cols = await client.query(`
            SELECT table_name, column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
              AND (
                (table_name = 'users' AND column_name = 'avatar_url') OR
                (table_name = 'groups' AND column_name IN ('cover_photo_url', 'icon_url', 'invite_code')) OR
                (table_name = 'chat_messages' AND column_name IN ('message_type', 'media_url', 'file_name'))
              )
        `);
        console.log('Verified columns created:', cols.rows);
    } catch (err) {
        console.error('Migration failed:', err.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

applyMigration();
