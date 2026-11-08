const { pool } = require('./db');

async function rollbackMigration() {
    console.log('--- Rolling back Migration 003: Feedback Improvements ---');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`ALTER TABLE public.users DROP COLUMN IF EXISTS avatar_url`);
        await client.query(`ALTER TABLE public.profiles DROP COLUMN IF EXISTS avatar_url`);
        await client.query(`ALTER TABLE public.groups DROP COLUMN IF EXISTS cover_photo_url`);
        await client.query(`ALTER TABLE public.groups DROP COLUMN IF EXISTS icon_url`);
        await client.query(`ALTER TABLE public.groups DROP COLUMN IF EXISTS invite_code`);
        await client.query(`ALTER TABLE public.groups DROP COLUMN IF EXISTS invite_expires_at`);
        await client.query(`ALTER TABLE public.chat_messages DROP COLUMN IF EXISTS message_type`);
        await client.query(`ALTER TABLE public.chat_messages DROP COLUMN IF EXISTS media_url`);
        await client.query(`ALTER TABLE public.chat_messages DROP COLUMN IF EXISTS file_name`);
        await client.query(`ALTER TABLE public.chat_messages DROP COLUMN IF EXISTS file_size`);
        await client.query(`ALTER TABLE public.chat_messages DROP COLUMN IF EXISTS delivered_at`);
        await client.query(`ALTER TABLE public.chat_messages DROP COLUMN IF EXISTS read_at`);
        await client.query('COMMIT');
        console.log('✓ Migration 003 rollback completed.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Rollback error:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    rollbackMigration();
}

module.exports = { rollbackMigration };
