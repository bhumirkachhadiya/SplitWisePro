/**
 * SPLITWISE KNOWLEDGE & CONTEXT SERVICE (Domain Layer)
 * 
 * Provides comprehensive, structured knowledge about SplitWise/SplitEase:
 * - Domain entities: Groups/Circles, Expenses, Splits, Settlements, Friends, Users, Master Admin
 * - Business logic & permissions: Admin, Editor, Member roles, Lock status, Debt simplification
 * - Real-time system telemetry and context retrieval for AI Voice Assistant
 */

const SPLITWISE_KNOWLEDGE_BASE = {
    appName: "SplitEase (SplitWise Pro)",
    description: "Intelligent shared expense tracking and financial settlement ledger platform.",
    supportedCurrencies: ['INR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'],
    defaultCurrency: 'INR',
    roles: {
        admin: {
            title: 'Circle Admin',
            permissions: ['ADD_EXPENSE', 'EDIT_EXPENSE', 'DELETE_EXPENSE', 'ADD_MEMBER', 'REMOVE_MEMBER', 'EDIT_CIRCLE', 'LOCK_CIRCLE', 'ARCHIVE_CIRCLE', 'DELETE_CIRCLE'],
            description: 'Full administrative rights to manage members, record expenses, edit details, and lock or archive the circle.'
        },
        editor: {
            title: 'Circle Editor',
            permissions: ['ADD_EXPENSE', 'EDIT_EXPENSE', 'INVITE_MEMBER'],
            description: 'Can record shared expenses and invite friends to the circle, but cannot remove members or delete the circle.'
        },
        member: {
            title: 'Circle Member',
            permissions: ['VIEW_EXPENSES', 'SPLIT_EXPENSES', 'COMMENT', 'SETTLE_UP'],
            description: 'Can view expenses, participate in bill splits, comment, and record personal settlements.'
        }
    },
    splitModes: {
        equal: {
            name: 'Equal Split',
            formula: 'Total amount divided equally among all N participants. 1-cent/1-paisa rounding remainder assigned to payer/first member to guarantee 100% exact balance.'
        },
        exact: {
            name: 'Exact / Fixed Amount',
            formula: 'Each participant is assigned a specific currency amount. The sum of all individual shares must precisely match the total expense.'
        },
        percentage: {
            name: 'Percentage Split',
            formula: 'Each participant owes a specific percentage. The sum of all participant percentages must equal exactly 100.00%.'
        },
        smart_custom: {
            name: 'Smart Custom Split (Lock & Auto Distribute)',
            formula: 'Specific participants are locked at fixed amounts; the remaining unallocated balance is automatically distributed equally across all remaining unlocked members.'
        }
    },
    payerModes: {
        single: {
            name: 'Single Payer (Default)',
            description: 'One group member pays the entire bill upfront; other participants owe their split shares to this payer.'
        },
        multiple: {
            name: 'Multiple Payers',
            description: 'Two or more members contribute towards paying the bill simultaneously (e.g. Charlie pays ₹2000, Bob pays ₹1000 for a ₹3000 expense). Balances and debt simplification apply proportional credits to all payers.'
        }
    },
    settlementTypes: {
        manual: 'Direct cash or external payment settlement recorded by user.',
        mark_as_paid: 'Debtor marks payment as sent; creditor receives confirmation request to verify receipt before balances clear.',
        upi_qr: 'Dynamic UPI QR code and deep-link (upi://pay) generated using registered VPA/UPI ID for instant scan-and-pay.'
    },
    systemRules: [
        'Locked circles strictly reject any new expense entries until unlocked by an Admin.',
        'Settled expenses (where participant shares are paid) cannot be directly deleted or tampered with to prevent ledger fraud.',
        'Group members cannot leave or be removed if they have unsettled debt balances within that circle.',
        'Financial actions executed via AI Voice Assistant require explicit user confirmation before modifying the database.'
    ]
};

/**
 * Builds user-specific domain context from live PostgreSQL records
 */
async function buildUserSystemContext(pool, userId, isMasterAdmin = false) {
    const userRes = await pool.query(
        'SELECT id, name, email, phone, upi_id, default_currency, avatar_initials, user_code FROM users WHERE id = $1',
        [userId]
    );
    if (userRes.rows.length === 0) return null;

    const currentUser = userRes.rows[0];

    const [groupsRes, expensesRes, friendsRes, pendingReqsRes] = await Promise.all([
        pool.query(`
            SELECT g.id, g.name, g.category, g.is_locked, gm.role,
                   COUNT(DISTINCT gm2.user_id) as member_count,
                   COALESCE((SELECT SUM(COALESCE(e.converted_amount, e.amount)) FROM expenses e WHERE e.group_id = g.id), 0) as total_spend
            FROM groups g
            JOIN group_members gm ON g.id = gm.group_id AND gm.user_id = $1
            LEFT JOIN group_members gm2 ON g.id = gm2.group_id
            GROUP BY g.id, g.name, g.category, g.is_locked, gm.role
            ORDER BY total_spend DESC
        `, [userId]),
        pool.query(`
            SELECT e.id, e.description, e.amount, e.currency, e.expense_date, e.category, e.paid_by,
                   u.name as paid_by_name, g.name as group_name, g.id as group_id
            FROM expenses e
            LEFT JOIN users u ON e.paid_by = u.id
            LEFT JOIN groups g ON e.group_id = g.id
            WHERE e.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1) OR e.paid_by = $1
            ORDER BY e.expense_date DESC, e.id DESC
            LIMIT 25
        `, [userId]),
        pool.query(`
            SELECT u.id, u.name, u.email, u.phone, u.upi_id, u.user_code
            FROM users u
            WHERE u.id IN (SELECT friend_id FROM friends WHERE user_id = $1)
               OR u.id IN (
                   SELECT gm2.user_id FROM group_members gm1
                   JOIN group_members gm2 ON gm1.group_id = gm2.group_id
                   WHERE gm1.user_id = $1 AND gm2.user_id != $1
               )
        `, [userId]),
        pool.query(`
            SELECT fr.id, fr.sender_id, fr.receiver_id, fr.status, u.name as sender_name
            FROM friend_requests fr
            JOIN users u ON fr.sender_id = u.id
            WHERE fr.receiver_id = $1 AND fr.status = 'pending'
        `, [userId])
    ]);

    let masterAdminTelemetry = null;
    if (isMasterAdmin) {
        const [totalUsersRes, totalGroupsRes, totalExpensesRes, errorLogsRes] = await Promise.all([
            pool.query('SELECT COUNT(*)::int as count FROM users'),
            pool.query('SELECT COUNT(*)::int as count FROM groups'),
            pool.query('SELECT COUNT(*)::int as count, COALESCE(SUM(amount), 0) as total_vol FROM expenses'),
            pool.query('SELECT COUNT(*)::int as count FROM system_error_logs WHERE resolved = FALSE').catch(() => ({ rows: [{ count: 0 }] }))
        ]);

        masterAdminTelemetry = {
            totalUsers: totalUsersRes.rows[0].count,
            totalGroups: totalGroupsRes.rows[0].count,
            totalExpensesCount: totalExpensesRes.rows[0].count,
            totalExpenseVolume: parseFloat(totalExpensesRes.rows[0].total_vol || 0),
            unresolvedErrors: errorLogsRes.rows[0]?.count || 0,
            systemHealth: 'OPERATIONAL',
            databaseProvider: 'Supabase PostgreSQL'
        };
    }

    return {
        user: currentUser,
        isMasterAdmin,
        groups: groupsRes.rows,
        recentExpenses: expensesRes.rows,
        knownPeers: friendsRes.rows,
        pendingFriendRequests: pendingReqsRes.rows,
        masterAdminTelemetry,
        knowledgeBase: SPLITWISE_KNOWLEDGE_BASE
    };
}

module.exports = {
    SPLITWISE_KNOWLEDGE_BASE,
    buildUserSystemContext
};
