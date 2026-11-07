/**
 * SplitWise v3 migration:
 *  1. Session table
 *  2. expense_splits.settled_amount (partial settlement support)
 *  3. Reconcile historical settlements that were never reflected on splits
 *  4. Add missing integrity constraints / foreign keys (NOT VALID for legacy rows)
 *
 * Safety: full backups of financial tables are created before any update.
 * Idempotent: safe to run multiple times.
 */
const { pool } = require('../../db');
const auth = require('../../authService');

const EPS = 0.005;

async function main() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log('1) Backing up financial tables...');
        await client.query(`CREATE TABLE IF NOT EXISTS expense_splits_backup_v3 AS SELECT * FROM expense_splits`);
        await client.query(`CREATE TABLE IF NOT EXISTS settlements_backup_v3 AS SELECT * FROM settlements`);
        await client.query(`CREATE TABLE IF NOT EXISTS expenses_backup_v3 AS SELECT * FROM expenses`);

        console.log('2) Ensuring user_sessions table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id SERIAL PRIMARY KEY,
                token_hash VARCHAR(128) UNIQUE NOT NULL,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL,
                ip_address VARCHAR(128),
                user_agent TEXT,
                revoked_at TIMESTAMPTZ
            );
            CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, expires_at DESC);
            CREATE INDEX IF NOT EXISTS idx_user_sessions_hash ON user_sessions(token_hash);
        `);

        console.log('3) Adding expense_splits.settled_amount...');
        await client.query(`ALTER TABLE expense_splits ADD COLUMN IF NOT EXISTS settled_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);

        console.log('4) Migrating currently-settled splits into settled_amount...');
        await client.query(`
            UPDATE expense_splits
            SET settled_amount = amount
            WHERE is_settled = TRUE AND settled_amount = 0
        `);

        console.log('5) Reconciling settlement history not yet reflected on splits...');
        const pairs = await client.query(`
            SELECT payer_id, receiver_id, SUM(amount)::numeric AS total
            FROM settlements
            GROUP BY payer_id, receiver_id
        `);

        let reconciled = 0;
        let unappliedTotal = 0;
        for (const pair of pairs.rows) {
            const representedRes = await client.query(`
                SELECT COALESCE(SUM(es.settled_amount), 0)::numeric AS represented
                FROM expense_splits es
                JOIN expenses e ON e.id = es.expense_id
                WHERE es.user_id = $1 AND e.paid_by = $2
            `, [pair.payer_id, pair.receiver_id]);
            const represented = parseFloat(representedRes.rows[0].represented) || 0;
            let excess = Math.round((parseFloat(pair.total) - represented) * 100) / 100;
            if (excess <= EPS) continue;

            const splitsRes = await client.query(`
                SELECT es.id, es.amount, es.settled_amount, e.group_id
                FROM expense_splits es
                JOIN expenses e ON e.id = es.expense_id
                WHERE es.user_id = $1 AND e.paid_by = $2
                  AND es.settled_amount < es.amount - ${EPS}
                ORDER BY e.expense_date ASC, es.id ASC
                FOR UPDATE OF es
            `, [pair.payer_id, pair.receiver_id]);

            let remaining = excess;
            for (const s of splitsRes.rows) {
                if (remaining <= EPS) break;
                const outstanding = Math.round((parseFloat(s.amount) - parseFloat(s.settled_amount)) * 100) / 100;
                const applied = Math.min(remaining, outstanding);
                if (applied <= 0) continue;
                const newSettled = Math.round((parseFloat(s.settled_amount) + applied) * 100) / 100;
                await client.query(`
                    UPDATE expense_splits
                    SET settled_amount = $1,
                        is_settled = ($1 >= amount - ${EPS}),
                        settled_at = CASE WHEN $1 >= amount - ${EPS} THEN COALESCE(settled_at, NOW()) ELSE settled_at END
                    WHERE id = $2
                `, [newSettled, s.id]);
                remaining = Math.round((remaining - applied) * 100) / 100;
                reconciled += 1;
            }
            if (remaining > EPS) unappliedTotal += remaining;
        }
        console.log(`   Reconciled ${reconciled} split allocations; unapplied historical excess: ₹${unappliedTotal.toFixed(2)}`);

        console.log('6) Normalising is_settled flags against settled_amount...');
        await client.query(`
            UPDATE expense_splits
            SET is_settled = (settled_amount >= amount - ${EPS}),
                settled_at = CASE
                    WHEN settled_amount >= amount - ${EPS} THEN COALESCE(settled_at, NOW())
                    WHEN settled_amount = 0 THEN NULL
                    ELSE settled_at
                END
        `);

        console.log('7) Adding integrity constraints (NOT VALID for legacy rows)...');
        const trySql = async (label, sql) => {
            try { await client.query(sql); console.log('   ok:', label); }
            catch (e) { console.log('   skip:', label, '-', e.message.split('\n')[0]); }
        };

        await trySql('expense_splits -> expenses FK', `
            ALTER TABLE expense_splits ADD CONSTRAINT fk_expense_splits_expense
            FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE NOT VALID`);
        await trySql('expense_splits -> users FK', `
            ALTER TABLE expense_splits ADD CONSTRAINT fk_expense_splits_user
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID`);
        await trySql('expenses -> groups FK', `
            ALTER TABLE expenses ADD CONSTRAINT fk_expenses_group
            FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE NOT VALID`);
        await trySql('expenses -> users FK', `
            ALTER TABLE expenses ADD CONSTRAINT fk_expenses_payer
            FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE CASCADE NOT VALID`);
        await trySql('group_members -> groups FK', `
            ALTER TABLE group_members ADD CONSTRAINT fk_group_members_group
            FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE NOT VALID`);
        await trySql('group_members -> users FK', `
            ALTER TABLE group_members ADD CONSTRAINT fk_group_members_user
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID`);
        await trySql('settlements -> groups FK', `
            ALTER TABLE settlements ADD CONSTRAINT fk_settlements_group
            FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL NOT VALID`);
        await trySql('settlements -> payer FK', `
            ALTER TABLE settlements ADD CONSTRAINT fk_settlements_payer
            FOREIGN KEY (payer_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID`);
        await trySql('settlements -> receiver FK', `
            ALTER TABLE settlements ADD CONSTRAINT fk_settlements_receiver
            FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID`);
        await trySql('friends -> users FK', `
            ALTER TABLE friends ADD CONSTRAINT fk_friends_user
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID`);
        await trySql('friends -> friend FK', `
            ALTER TABLE friends ADD CONSTRAINT fk_friends_friend
            FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID`);
        await trySql('friend_requests -> sender FK', `
            ALTER TABLE friend_requests ADD CONSTRAINT fk_friend_requests_sender
            FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID`);
        await trySql('friend_requests -> receiver FK', `
            ALTER TABLE friend_requests ADD CONSTRAINT fk_friend_requests_receiver
            FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID`);
        await trySql('chat_messages -> conversation FK', `
            ALTER TABLE chat_messages ADD CONSTRAINT fk_chat_messages_conversation
            FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE NOT VALID`);
        await trySql('chat_messages -> sender FK', `
            ALTER TABLE chat_messages ADD CONSTRAINT fk_chat_messages_sender
            FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID`);

        await trySql('expense amount > 0', `
            ALTER TABLE expenses ADD CONSTRAINT chk_expenses_amount_positive CHECK (amount > 0) NOT VALID`);
        await trySql('expense split amount >= 0', `
            ALTER TABLE expense_splits ADD CONSTRAINT chk_splits_amount_nonneg CHECK (amount >= 0) NOT VALID`);
        await trySql('split type allowlist', `
            ALTER TABLE expenses ADD CONSTRAINT chk_expenses_split_type
            CHECK (split_type IN ('equal','exact','percentage','shares','smart_custom','single')) NOT VALID`);
        await trySql('group role allowlist', `
            ALTER TABLE group_members ADD CONSTRAINT chk_group_members_role
            CHECK (role IN ('admin','editor','member')) NOT VALID`);
        await trySql('settlement amount > 0', `
            ALTER TABLE settlements ADD CONSTRAINT chk_settlements_amount_positive CHECK (amount > 0) NOT VALID`);
        await trySql('friends no self', `
            ALTER TABLE friends ADD CONSTRAINT chk_friends_not_self CHECK (user_id <> friend_id) NOT VALID`);

        await trySql('session index', `CREATE INDEX IF NOT EXISTS idx_user_sessions_expiry ON user_sessions(expires_at)`);

        await client.query('COMMIT');
        console.log('\n✅ Migration completed.');
        console.log('Backups: expense_splits_backup_v3, settlements_backup_v3, expenses_backup_v3');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Migration failed:', err);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

main();
