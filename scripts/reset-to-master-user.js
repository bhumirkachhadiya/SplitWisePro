/**
 * ==============================================================================
 * RESET DATABASE TO FRESH PRODUCTION STATE WITH SINGLE MASTER USER CHARLIE
 * ==============================================================================
 * This script:
 * 1. Truncates all transaction, split, settlement, group, chat, and activity data.
 * 2. Purges all test users, sessions, and audit entries.
 * 3. Preserves ONLY Charlie (nxtcharlie20@gmail.com) as Master Admin (ID 1).
 * 4. Resets all auto-increment sequences for a clean live start.
 * ==============================================================================
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function resetDatabase() {
    const client = await pool.connect();
    try {
        console.log('================================================================');
        console.log('🚀 INITIALIZING FRESH PROJECT DATABASE WITH SINGLE MASTER USER');
        console.log('================================================================\n');

        await client.query('BEGIN');

        // 1. Verify Charlie exists before truncating
        const charlieCheck = await client.query(`
            SELECT id, name, email, username, password_hash, upi_id, phone, user_code 
            FROM users 
            WHERE LOWER(email) = 'nxtcharlie20@gmail.com'
        `);

        if (charlieCheck.rows.length === 0) {
            throw new Error('User Charlie (nxtcharlie20@gmail.com) was not found in users table. Aborting reset.');
        }

        const charlie = charlieCheck.rows[0];
        console.log(`✓ Located master user: ${charlie.name} (${charlie.email})`);

        // 2. Truncate all project transaction & activity tables
        console.log('\n[1/5] Truncating all operational, financial, and activity tables...');
        const tablesToTruncate = [
            'activity_logs',
            'admin_audit_logs',
            'ai_agent_actions',
            'chat_conversation_members',
            'chat_conversations',
            'chat_messages',
            'chat_participants',
            'email_verifications',
            'expense_corrections',
            'expense_splits',
            'expenses',
            'friend_requests',
            'friends',
            'group_members',
            'groups',
            'master_password_audit',
            'payment_requests',
            'settlements',
            'system_error_occurrences',
            'system_errors',
            'upi_payment_requests',
            'user_sessions',
            'expenses_backup_v3',
            'expense_splits_backup_v3',
            'settlements_backup_v3'
        ];

        for (const t of tablesToTruncate) {
            try {
                await client.query(`TRUNCATE TABLE "${t}" CASCADE`);
                console.log(`  ✓ Truncated: ${t}`);
            } catch (err) {
                console.warn(`  ⚠️ Could not truncate ${t}: ${err.message}`);
            }
        }

        // 3. Clear foreign key references in configuration tables
        console.log('\n[2/5] Detaching user references in configuration tables...');
        await client.query(`UPDATE custom_email_templates SET updated_by = NULL`);
        await client.query(`UPDATE system_security_settings SET updated_by = NULL`);
        console.log('  ✓ Updated custom_email_templates and system_security_settings');

        // 4. Purge all other profiles and users
        console.log('\n[3/5] Purging all users except Charlie...');
        const delProfiles = await client.query(`
            DELETE FROM profiles WHERE LOWER(email) != 'nxtcharlie20@gmail.com'
        `);
        console.log(`  ✓ Removed ${delProfiles.rowCount} other profiles`);

        const delUsers = await client.query(`
            DELETE FROM users WHERE LOWER(email) != 'nxtcharlie20@gmail.com'
        `);
        console.log(`  ✓ Removed ${delUsers.rowCount} other users`);

        // 5. Elevate and standardize Charlie as Master User (ID 1)
        console.log('\n[4/5] Elevating Charlie to Master User (ID 1, role: master_admin)...');
        const updateCharlie = await client.query(`
            UPDATE users SET 
                id = 1,
                name = 'Charlie',
                username = 'Charlie',
                email = 'nxtcharlie20@gmail.com',
                role = 'master_admin',
                is_active = TRUE,
                is_verified = TRUE,
                avatar_initials = 'CH',
                default_currency = 'INR',
                phone = COALESCE($1, '+91 98765 00000'),
                upi_id = COALESCE($2, 'nxtcharlie20@oksbi'),
                user_code = 'SW-CHARLIE',
                updated_at = NOW()
            WHERE LOWER(email) = 'nxtcharlie20@gmail.com'
            RETURNING id, name, email, username, role, is_active, upi_id, phone, user_code, default_currency
        `, [charlie.phone, charlie.upi_id]);

        const masterUser = updateCharlie.rows[0];
        console.log('  ✓ Master User Record Active:', masterUser);

        // Ensure profile matches
        await client.query(`
            UPDATE profiles SET 
                name = 'Charlie',
                avatar_initials = 'CH',
                upi_id = $1,
                phone = $2,
                updated_at = NOW()
            WHERE LOWER(email) = 'nxtcharlie20@gmail.com'
        `, [masterUser.upi_id, masterUser.phone]);
        console.log('  ✓ Profile synchronized');

        // 6. Reset all sequences so new groups, expenses, and users start from 1
        console.log('\n[5/5] Resetting auto-increment sequences for clean start...');
        const sequencesToReset = [
            { name: 'users_id_seq', val: 2 }, // next user will be ID 2
            { name: 'groups_id_seq', val: 1 },
            { name: 'expenses_id_seq', val: 1 },
            { name: 'expense_splits_id_seq', val: 1 },
            { name: 'settlements_id_seq', val: 1 },
            { name: 'payment_requests_id_seq', val: 1 },
            { name: 'upi_payment_requests_id_seq', val: 1 },
            { name: 'activity_logs_id_seq', val: 1 },
            { name: 'admin_audit_logs_id_seq', val: 1 },
            { name: 'ai_agent_actions_id_seq', val: 1 },
            { name: 'chat_conversations_id_seq', val: 1 },
            { name: 'chat_conversation_members_id_seq', val: 1 },
            { name: 'chat_messages_id_seq', val: 1 },
            { name: 'chat_participants_id_seq', val: 1 },
            { name: 'email_verifications_id_seq', val: 1 },
            { name: 'expense_corrections_id_seq', val: 1 },
            { name: 'friend_requests_id_seq', val: 1 },
            { name: 'friends_id_seq', val: 1 },
            { name: 'group_members_id_seq', val: 1 },
            { name: 'master_password_audit_id_seq', val: 1 },
            { name: 'system_error_occurrences_id_seq', val: 1 },
            { name: 'user_sessions_id_seq', val: 1 }
        ];

        for (const s of sequencesToReset) {
            try {
                await client.query(`ALTER SEQUENCE "${s.name}" RESTART WITH ${s.val}`);
                console.log(`  ✓ Sequence ${s.name} reset to ${s.val}`);
            } catch (err) {
                console.warn(`  ⚠️ Sequence reset notice for ${s.name}: ${err.message}`);
            }
        }

        // 7. Initial system initialization activity log
        await client.query(`
            INSERT INTO activity_logs (user_id, activity_type, message) 
            VALUES (1, 'SYSTEM_INIT', 'System initialized for live production with Master Admin Charlie (nxtcharlie20@gmail.com)')
        `);

        await client.query('COMMIT');
        console.log('\n================================================================');
        console.log('🎉 DATABASE CLEANUP COMPLETE! FRESH PROJECT READY FOR LIVE USE');
        console.log('================================================================');
        console.log(`Single Active User:`);
        console.log(`- ID: ${masterUser.id}`);
        console.log(`- Name: ${masterUser.name}`);
        console.log(`- Email: ${masterUser.email}`);
        console.log(`- Username: ${masterUser.username}`);
        console.log(`- Role: ${masterUser.role}`);
        console.log(`- Currency: ${masterUser.default_currency}`);
        console.log(`- User Code: ${masterUser.user_code}`);
        console.log(`- UPI ID: ${masterUser.upi_id}`);
        console.log(`- Phone: ${masterUser.phone}`);
        console.log('================================================================\n');

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Error during database reset. Transaction rolled back:', e);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

resetDatabase();
