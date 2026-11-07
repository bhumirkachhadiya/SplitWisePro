/**
 * ==============================================================================
 * MASTER ADMIN & GLOBAL ERROR MONITORING SERVICE
 * ==============================================================================
 * Comprehensive administration engine providing:
 *  - Platform-wide telemetry (Users, Circles, Expenses, Settlements, Health)
 *  - Secure User Management (Search, inspect, status toggling)
 *  - Global Group Audit (Read-only inspection, financial volume)
 *  - Global Financial Monitoring (Cross-circle ledgers, currency conversions)
 *  - System Errors & Issue Tracker (Fingerprinted grouping, occurrences, workflow)
 *  - Antigravity Resolution Prompt Generator
 * ==============================================================================
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { pool } = require('./db');

// Initialize Master Password Security Schema & Tables
async function initMasterPasswordSecurityTables() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.system_security_settings (
                key VARCHAR(64) PRIMARY KEY,
                value_hash VARCHAR(255) NOT NULL,
                is_enabled BOOLEAN DEFAULT TRUE,
                metadata JSONB DEFAULT '{}'::jsonb,
                updated_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS public.master_password_audit (
                id SERIAL PRIMARY KEY,
                target_user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
                target_user_email VARCHAR(255),
                target_user_name VARCHAR(255),
                login_method VARCHAR(64) DEFAULT 'master_password',
                ip_address VARCHAR(128),
                user_agent TEXT,
                environment VARCHAR(32) DEFAULT 'development',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_mp_audit_target_user ON public.master_password_audit(target_user_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_mp_audit_created ON public.master_password_audit(created_at DESC);
        `);

        // Check if master_password row exists
        const existing = await pool.query("SELECT key FROM public.system_security_settings WHERE key = 'master_password'");
        if (existing.rows.length === 0) {
            // Seed a secure initial master password for development: 'SplitWiseMaster@2026'
            const initialDevPassword = process.env.INITIAL_MASTER_PASSWORD || 'SplitWiseMaster@2026';
            const initialHash = await bcrypt.hash(initialDevPassword, 10);
            await pool.query(`
                INSERT INTO public.system_security_settings (key, value_hash, is_enabled, metadata, updated_at)
                VALUES ('master_password', $1, TRUE, $2, NOW())
            `, [
                initialHash,
                JSON.stringify({
                    description: 'Development Master Password for authorized administrator testing',
                    algorithm: 'bcrypt-10',
                    last_action: 'INITIAL_PROVISION'
                })
            ]);
            console.log('✓ Master Password Security Subsystem Provisioned with Default Dev Credentials');
        }
    } catch (err) {
        console.error('[AdminService] Error initializing master password tables:', err.message);
    }
}
initMasterPasswordSecurityTables();

// Helper: Sanitize sensitive data from objects
function sanitizeData(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const sensitiveKeys = ['password', 'password_hash', 'plaintext_password', 'token', 'secret', 'key', 'otp', 'access_token', 'refresh_token'];
    const sanitized = Array.isArray(obj) ? [] : {};
    for (const [k, v] of Object.entries(obj)) {
        if (sensitiveKeys.some(sk => k.toLowerCase().includes(sk))) {
            sanitized[k] = '[REDACTED]';
        } else if (typeof v === 'object' && v !== null) {
            sanitized[k] = sanitizeData(v);
        } else {
            sanitized[k] = v;
        }
    }
    return sanitized;
}

// -------------------------------------------------------------
// 1. PLATFORM OVERVIEW & METRICS
// -------------------------------------------------------------
async function getPlatformOverview() {
    try {
        const [
            usersCount,
            activeUsersCount,
            groupsCount,
            archivedGroupsCount,
            expensesStats,
            settlementsStats,
            currencyStats,
            errorsStats
        ] = await Promise.all([
            pool.query('SELECT COUNT(*)::int AS count FROM public.users'),
            pool.query('SELECT COUNT(*)::int AS count FROM public.users WHERE is_active = TRUE'),
            pool.query('SELECT COUNT(*)::int AS count FROM public.groups'),
            pool.query('SELECT COUNT(*)::int AS count FROM public.groups WHERE is_archived = TRUE'),
            pool.query(`
                SELECT 
                    COUNT(*)::int AS count, 
                    COALESCE(SUM(amount), 0)::numeric(14,2) AS total_volume,
                    COALESCE(AVG(amount), 0)::numeric(14,2) AS avg_expense
                FROM public.expenses
            `),
            pool.query(`
                SELECT 
                    COUNT(*)::int AS total_count,
                    COALESCE(SUM(amount), 0)::numeric(14,2) AS total_settled,
                    COUNT(CASE WHEN status = 'COMPLETED' OR status = 'SUCCESS' OR status IS NULL THEN 1 END)::int AS completed_count,
                    COUNT(CASE WHEN status = 'PENDING' THEN 1 END)::int AS pending_count,
                    COUNT(CASE WHEN status = 'FAILED' THEN 1 END)::int AS failed_count
                FROM public.settlements
            `),
            pool.query(`
                SELECT 
                    COALESCE(currency, 'INR') AS currency,
                    COUNT(*)::int AS count,
                    COALESCE(SUM(amount), 0)::numeric(14,2) AS volume
                FROM public.expenses
                GROUP BY COALESCE(currency, 'INR')
                ORDER BY volume DESC
            `),
            pool.query(`
                SELECT 
                    COUNT(*)::int AS total,
                    COUNT(CASE WHEN status = 'new' THEN 1 END)::int AS new_count,
                    COUNT(CASE WHEN severity = 'critical' THEN 1 END)::int AS critical_count,
                    COUNT(CASE WHEN last_seen >= NOW() - INTERVAL '24 hours' THEN 1 END)::int AS errors_today,
                    COUNT(CASE WHEN status = 'resolved' THEN 1 END)::int AS resolved_count
                FROM public.system_errors
            `)
        ]);

        const totalUsers = usersCount.rows[0].count;
        const activeUsers = activeUsersCount.rows[0].count;
        const disabledUsers = Math.max(0, totalUsers - activeUsers);

        const totalGroups = groupsCount.rows[0].count;
        const archivedGroups = archivedGroupsCount.rows[0].count;
        const activeGroups = Math.max(0, totalGroups - archivedGroups);

        const exp = expensesStats.rows[0];
        const sett = settlementsStats.rows[0];
        const err = errorsStats.rows[0];

        return {
            users: {
                total: totalUsers,
                active: activeUsers,
                disabled: disabledUsers
            },
            groups: {
                total: totalGroups,
                active: activeGroups,
                archived: archivedGroups
            },
            expenses: {
                count: exp.count,
                totalVolume: parseFloat(exp.total_volume),
                avgExpense: parseFloat(exp.avg_expense)
            },
            settlements: {
                total: sett.total_count,
                settledVolume: parseFloat(sett.total_settled),
                completed: sett.completed_count,
                pending: sett.pending_count,
                failed: sett.failed_count
            },
            currencies: currencyStats.rows.map(r => ({
                currency: r.currency,
                count: r.count,
                volume: parseFloat(r.volume)
            })),
            errors: {
                total: err.total,
                newCount: err.new_count,
                critical: err.critical_count,
                today: err.errors_today,
                resolved: err.resolved_count
            },
            health: {
                status: 'HEALTHY',
                database: 'CONNECTED',
                timestamp: new Date().toISOString(),
                uptimeSeconds: Math.floor(process.uptime()),
                nodeVersion: process.version,
                memoryUsageMB: Math.round(process.memoryUsage().rss / (1024 * 1024))
            }
        };
    } catch (err) {
        console.error('[AdminService] Error loading platform overview:', err);
        throw err;
    }
}

// -------------------------------------------------------------
// 2. USER MANAGEMENT
// -------------------------------------------------------------
async function listUsers({ search = '', role = '', status = '', page = 1, limit = 50 }) {
    const offset = Math.max(0, (page - 1) * limit);
    const conditions = [];
    const params = [];
    let pIdx = 1;

    if (search && search.trim()) {
        const q = `%${search.trim().toLowerCase()}%`;
        conditions.push(`(
            LOWER(u.name) LIKE $${pIdx} OR 
            LOWER(u.email) LIKE $${pIdx} OR 
            LOWER(COALESCE(u.username, '')) LIKE $${pIdx} OR 
            LOWER(COALESCE(u.user_code, '')) LIKE $${pIdx}
        )`);
        params.push(q);
        pIdx++;
    }

    if (role && role.trim()) {
        conditions.push(`u.role = $${pIdx}`);
        params.push(role.trim());
        pIdx++;
    }

    if (status === 'active') {
        conditions.push(`u.is_active = TRUE`);
    } else if (status === 'disabled') {
        conditions.push(`u.is_active = FALSE`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await pool.query(`SELECT COUNT(*)::int AS count FROM public.users u ${whereClause}`, params);
    const total = countRes.rows[0].count;

    params.push(limit, offset);
    const dataRes = await pool.query(`
        SELECT 
            u.id, 
            u.name, 
            u.email, 
            COALESCE(u.username, '') AS username, 
            u.user_code, 
            COALESCE(u.role, 'user') AS role,
            COALESCE(u.is_active, TRUE) AS is_active,
            u.is_verified,
            u.avatar_initials,
            u.upi_id,
            u.phone,
            u.default_currency,
            u.created_at,
            u.last_login_at,
            (SELECT COUNT(*)::int FROM public.group_members gm WHERE gm.user_id = u.id) AS groups_count,
            (SELECT COUNT(*)::int FROM public.expenses e WHERE e.paid_by = u.id) AS expenses_paid_count
        FROM public.users u
        ${whereClause}
        ORDER BY u.id ASC
        LIMIT $${pIdx++} OFFSET $${pIdx++}
    `, params);

    return {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        users: dataRes.rows
    };
}

async function toggleUserStatus(adminId, adminEmail, targetUserId, isActive) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Cannot disable self
        if (parseInt(adminId) === parseInt(targetUserId) && !isActive) {
            throw new Error('You cannot deactivate your own Master Admin account.');
        }

        const userRes = await client.query('SELECT id, name, email, role, is_active FROM public.users WHERE id = $1', [targetUserId]);
        if (userRes.rows.length === 0) throw new Error('User not found.');

        const targetUser = userRes.rows[0];

        await client.query(`
            UPDATE public.users 
            SET is_active = $1, updated_at = NOW() 
            WHERE id = $2
        `, [isActive, targetUserId]);

        // Audit log
        await client.query(`
            INSERT INTO public.admin_audit_logs 
            (admin_id, admin_email, action, target_type, target_id, details)
            VALUES ($1, $2, $3, 'USER', $4, $5)
        `, [
            adminId,
            adminEmail,
            isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
            targetUserId.toString(),
            JSON.stringify({
                targetEmail: targetUser.email,
                targetName: targetUser.name,
                previousStatus: targetUser.is_active,
                newStatus: isActive,
                timestamp: new Date().toISOString()
            })
        ]);

        await client.query('COMMIT');
        return {
            success: true,
            userId: targetUserId,
            is_active: isActive,
            message: `User ${targetUser.name} (${targetUser.email}) has been ${isActive ? 'activated' : 'deactivated'}.`
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// -------------------------------------------------------------
// 3. GLOBAL GROUP MANAGEMENT
// -------------------------------------------------------------
async function listGroups({ search = '', status = '', page = 1, limit = 50 }) {
    const offset = Math.max(0, (page - 1) * limit);
    const conditions = [];
    const params = [];
    let pIdx = 1;

    if (search && search.trim()) {
        const q = `%${search.trim().toLowerCase()}%`;
        conditions.push(`(LOWER(g.name) LIKE $${pIdx} OR LOWER(COALESCE(g.description, '')) LIKE $${pIdx})`);
        params.push(q);
        pIdx++;
    }

    if (status === 'archived') {
        conditions.push('g.is_archived = TRUE');
    } else if (status === 'active') {
        conditions.push('(g.is_archived = FALSE OR g.is_archived IS NULL)');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await pool.query(`SELECT COUNT(*)::int AS count FROM public.groups g ${whereClause}`, params);
    const total = countRes.rows[0].count;

    params.push(limit, offset);
    const dataRes = await pool.query(`
        SELECT 
            g.id,
            g.name,
            g.description,
            g.category,
            g.avatar_color,
            COALESCE(g.base_currency, g.currency, 'INR') AS currency,
            COALESCE(g.is_archived, FALSE) AS is_archived,
            g.created_at,
            g.created_by,
            u.name AS creator_name,
            u.email AS creator_email,
            (SELECT COUNT(*)::int FROM public.group_members gm WHERE gm.group_id = g.id) AS member_count,
            (SELECT COUNT(*)::int FROM public.expenses e WHERE e.group_id = g.id) AS expense_count,
            COALESCE((SELECT SUM(amount)::numeric(14,2) FROM public.expenses e WHERE e.group_id = g.id), 0) AS total_expense_volume,
            COALESCE((SELECT SUM(amount)::numeric(14,2) FROM public.settlements s WHERE s.group_id = g.id), 0) AS total_settled_volume
        FROM public.groups g
        LEFT JOIN public.users u ON g.created_by = u.id
        ${whereClause}
        ORDER BY g.id DESC
        LIMIT $${pIdx++} OFFSET $${pIdx++}
    `, params);

    return {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        groups: dataRes.rows
    };
}

async function getGroupInspection(groupId) {
    const [groupRes, membersRes, expensesRes, settlementsRes] = await Promise.all([
        pool.query(`
            SELECT g.*, u.name AS creator_name, u.email AS creator_email
            FROM public.groups g
            LEFT JOIN public.users u ON g.created_by = u.id
            WHERE g.id = $1
        `, [groupId]),
        pool.query(`
            SELECT gm.role, gm.joined_at, u.id, u.name, u.email, u.user_code, u.avatar_initials, u.upi_id
            FROM public.group_members gm
            JOIN public.users u ON gm.user_id = u.id
            WHERE gm.group_id = $1
            ORDER BY (CASE WHEN gm.role = 'admin' THEN 0 ELSE 1 END), u.id ASC
        `, [groupId]),
        pool.query(`
            SELECT e.id, e.description, e.amount, e.currency, e.category, e.split_type, e.expense_date, e.created_at,
                   u.name AS paid_by_name, u.email AS paid_by_email
            FROM public.expenses e
            JOIN public.users u ON e.paid_by = u.id
            WHERE e.group_id = $1
            ORDER BY e.created_at DESC
            LIMIT 50
        `, [groupId]),
        pool.query(`
            SELECT s.id, s.amount, s.payment_method, s.transaction_reference, s.created_at,
                   p.name AS payer_name, r.name AS receiver_name
            FROM public.settlements s
            JOIN public.users p ON s.payer_id = p.id
            JOIN public.users r ON s.receiver_id = r.id
            WHERE s.group_id = $1
            ORDER BY s.created_at DESC
            LIMIT 50
        `, [groupId])
    ]);

    if (groupRes.rows.length === 0) return null;

    return {
        group: groupRes.rows[0],
        members: membersRes.rows,
        expenses: expensesRes.rows,
        settlements: settlementsRes.rows
    };
}

// -------------------------------------------------------------
// 4. GLOBAL FINANCIAL MONITORING
// -------------------------------------------------------------
async function listFinances({ search = '', currency = '', fromDate = '', toDate = '', page = 1, limit = 50 }) {
    const offset = Math.max(0, (page - 1) * limit);
    const conditions = [];
    const params = [];
    let pIdx = 1;

    if (search && search.trim()) {
        const q = `%${search.trim().toLowerCase()}%`;
        conditions.push(`(
            LOWER(e.description) LIKE $${pIdx} OR 
            LOWER(u.name) LIKE $${pIdx} OR 
            LOWER(g.name) LIKE $${pIdx}
        )`);
        params.push(q);
        pIdx++;
    }

    if (currency && currency.trim()) {
        conditions.push(`e.currency = $${pIdx}`);
        params.push(currency.trim().toUpperCase());
        pIdx++;
    }

    if (fromDate) {
        conditions.push(`e.created_at >= $${pIdx}`);
        params.push(fromDate);
        pIdx++;
    }

    if (toDate) {
        conditions.push(`e.created_at <= $${pIdx}`);
        params.push(toDate);
        pIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await pool.query(`
        SELECT COUNT(*)::int AS count 
        FROM public.expenses e
        LEFT JOIN public.users u ON e.paid_by = u.id
        LEFT JOIN public.groups g ON e.group_id = g.id
        ${whereClause}
    `, params);
    const total = countRes.rows[0].count;

    params.push(limit, offset);
    const dataRes = await pool.query(`
        SELECT 
            e.id,
            e.group_id,
            g.name AS group_name,
            e.paid_by,
            u.name AS paid_by_name,
            e.description,
            e.amount,
            COALESCE(e.currency, 'INR') AS currency,
            e.category,
            e.split_type,
            e.expense_date,
            e.original_amount,
            e.exchange_rate,
            e.converted_amount,
            e.rate_provider,
            e.created_at,
            (SELECT COUNT(*)::int FROM public.expense_splits es WHERE es.expense_id = e.id) AS split_count,
            (SELECT COUNT(*)::int FROM public.expense_splits es WHERE es.expense_id = e.id AND es.is_settled = TRUE) AS settled_splits_count
        FROM public.expenses e
        LEFT JOIN public.users u ON e.paid_by = u.id
        LEFT JOIN public.groups g ON e.group_id = g.id
        ${whereClause}
        ORDER BY e.created_at DESC
        LIMIT $${pIdx++} OFFSET $${pIdx++}
    `, params);

    return {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        expenses: dataRes.rows
    };
}

// -------------------------------------------------------------
// 5. SYSTEM ERRORS & ISSUE TRACKER (With Fingerprinting)
// -------------------------------------------------------------
function generateErrorFingerprint(category, title, message, source) {
    const normMsg = (message || '').replace(/0x[a-f0-9]+/gi, '[HEX]')
        .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/gi, '[DATE]')
        .replace(/id=\d+/gi, 'id=[ID]')
        .replace(/:\d+:\d+/g, ':[LINE]')
        .trim();
    const raw = `${category || 'general'}:${title || 'Error'}:${normMsg}:${source || 'unknown'}`;
    return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
}

async function recordSystemError({
    title = 'Application Error',
    message = '',
    category = 'frontend',
    severity = 'medium',
    module = 'general',
    apiRoute = null,
    httpStatus = null,
    stackTrace = '',
    requestUrl = '',
    requestMethod = 'GET',
    requestBody = null,
    browserInfo = '',
    userId = null,
    groupId = null,
    environment = process.env.NODE_ENV || 'production'
}) {
    const fingerprint = generateErrorFingerprint(category, title, message, apiRoute || module);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check if error already exists
        const existing = await client.query('SELECT id, occurrence_count, status FROM public.system_errors WHERE fingerprint = $1', [fingerprint]);

        let errorId = null;
        if (existing.rows.length > 0) {
            errorId = existing.rows[0].id;
            const prevStatus = existing.rows[0].status;
            const newStatus = prevStatus === 'resolved' ? 'reopened' : prevStatus;

            await client.query(`
                UPDATE public.system_errors 
                SET occurrence_count = occurrence_count + 1,
                    last_seen = NOW(),
                    status = $1,
                    message = $2,
                    severity = CASE WHEN $3 = 'critical' THEN 'critical' ELSE severity END
                WHERE id = $4
            `, [newStatus, message, severity, errorId]);
        } else {
            errorId = `ERR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
            await client.query(`
                INSERT INTO public.system_errors 
                (id, fingerprint, title, message, category, severity, status, affected_module, api_route, http_status, occurrence_count, first_seen, last_seen)
                VALUES ($1, $2, $3, $4, $5, $6, 'new', $7, $8, $9, 1, NOW(), NOW())
            `, [
                errorId,
                fingerprint,
                title.substring(0, 255),
                message,
                category,
                severity,
                module.substring(0, 100),
                apiRoute ? apiRoute.substring(0, 255) : null,
                httpStatus ? parseInt(httpStatus) : null
            ]);
        }

        // Insert occurrence detail
        const sanitizedBody = requestBody ? sanitizeData(requestBody) : null;
        await client.query(`
            INSERT INTO public.system_error_occurrences 
            (error_id, user_id, group_id, stack_trace, request_url, request_method, request_body_sanitized, browser_info, environment, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        `, [
            errorId,
            userId ? parseInt(userId) : null,
            groupId ? parseInt(groupId) : null,
            stackTrace ? stackTrace.substring(0, 5000) : null,
            requestUrl ? requestUrl.substring(0, 1000) : null,
            requestMethod || 'GET',
            sanitizedBody ? JSON.stringify(sanitizedBody) : null,
            browserInfo ? browserInfo.substring(0, 500) : null,
            environment
        ]);

        await client.query('COMMIT');
        return { success: true, errorId, fingerprint };
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[AdminService] Failed to record system error:', err.message);
        return { success: false, error: err.message };
    } finally {
        client.release();
    }
}

async function listSystemErrors({
    category = '',
    severity = '',
    status = '',
    module = '',
    search = '',
    fromDate = '',
    toDate = '',
    page = 1,
    limit = 50
}) {
    const offset = Math.max(0, (page - 1) * limit);
    const conditions = [];
    const params = [];
    let pIdx = 1;

    if (search && search.trim()) {
        const q = `%${search.trim().toLowerCase()}%`;
        conditions.push(`(
            LOWER(id) LIKE $${pIdx} OR 
            LOWER(title) LIKE $${pIdx} OR 
            LOWER(message) LIKE $${pIdx} OR
            LOWER(COALESCE(affected_module, '')) LIKE $${pIdx}
        )`);
        params.push(q);
        pIdx++;
    }

    if (category && category.trim()) {
        conditions.push(`category = $${pIdx}`);
        params.push(category.trim());
        pIdx++;
    }

    if (severity && severity.trim()) {
        conditions.push(`severity = $${pIdx}`);
        params.push(severity.trim());
        pIdx++;
    }

    if (status && status.trim()) {
        conditions.push(`status = $${pIdx}`);
        params.push(status.trim());
        pIdx++;
    }

    if (module && module.trim()) {
        conditions.push(`affected_module = $${pIdx}`);
        params.push(module.trim());
        pIdx++;
    }

    if (fromDate) {
        conditions.push(`last_seen >= $${pIdx}`);
        params.push(fromDate);
        pIdx++;
    }

    if (toDate) {
        conditions.push(`last_seen <= $${pIdx}`);
        params.push(toDate);
        pIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRes, statsRes] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS count FROM public.system_errors ${whereClause}`, params),
        pool.query(`
            SELECT 
                COUNT(*)::int AS total_errors,
                COUNT(CASE WHEN status = 'new' THEN 1 END)::int AS new_errors,
                COUNT(CASE WHEN severity = 'critical' THEN 1 END)::int AS critical_errors,
                COUNT(CASE WHEN last_seen >= NOW() - INTERVAL '24 hours' THEN 1 END)::int AS errors_today,
                COUNT(CASE WHEN last_seen >= NOW() - INTERVAL '7 days' THEN 1 END)::int AS errors_this_week,
                COUNT(CASE WHEN status = 'resolved' THEN 1 END)::int AS resolved_errors,
                COUNT(CASE WHEN occurrence_count > 1 THEN 1 END)::int AS recurring_errors
            FROM public.system_errors
        `)
    ]);

    const total = countRes.rows[0].count;

    params.push(limit, offset);
    const dataRes = await pool.query(`
        SELECT *
        FROM public.system_errors
        ${whereClause}
        ORDER BY last_seen DESC
        LIMIT $${pIdx++} OFFSET $${pIdx++}
    `, params);

    return {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        stats: statsRes.rows[0],
        errors: dataRes.rows
    };
}

async function getErrorDetails(errorId) {
    const errorRes = await pool.query('SELECT * FROM public.system_errors WHERE id = $1', [errorId]);
    if (errorRes.rows.length === 0) return null;

    const occurrencesRes = await pool.query(`
        SELECT * FROM public.system_error_occurrences 
        WHERE error_id = $1 
        ORDER BY created_at DESC 
        LIMIT 25
    `, [errorId]);

    return {
        error: errorRes.rows[0],
        occurrences: occurrencesRes.rows
    };
}

async function updateErrorStatus(errorId, status, resolutionNotes, adminName) {
    const normStatus = (status || '').toLowerCase().trim();
    const validStatuses = ['new', 'investigating', 'resolved', 'ignored', 'reopened'];
    if (!validStatuses.includes(normStatus)) {
        throw new Error(`Invalid error status. Allowed: ${validStatuses.join(', ')}`);
    }

    const isResolved = normStatus === 'resolved';
    const res = await pool.query(`
        UPDATE public.system_errors 
        SET status = $1,
            resolution_notes = COALESCE($2, resolution_notes),
            resolved_by = CASE WHEN $3 = TRUE THEN $4 ELSE resolved_by END,
            resolved_at = CASE WHEN $3 = TRUE THEN NOW() ELSE resolved_at END
        WHERE id = $5
        RETURNING *
    `, [normStatus, resolutionNotes || null, isResolved, adminName || 'Master Admin', errorId]);

    if (res.rows.length === 0) throw new Error('Error not found.');
    return res.rows[0];
}

// -------------------------------------------------------------
// 6. ANTIGRAVITY RESOLUTION PROMPT GENERATOR
// -------------------------------------------------------------
async function generateAntigravityFixPrompt(errorId) {
    const details = await getErrorDetails(errorId);
    if (!details) throw new Error('Error ID not found.');

    const err = details.error;
    const latestOcc = details.occurrences[0] || {};

    const prompt = `# ANTIGRAVITY ERROR RESOLUTION TASK

## 1. INCIDENT OVERVIEW
- **Error ID**: \`${err.id}\`
- **Title**: ${err.title}
- **Category**: ${err.category}
- **Severity**: ${err.severity.toUpperCase()}
- **Status**: ${err.status}
- **Total Occurrences**: ${err.occurrence_count}
- **First Seen**: ${new Date(err.first_seen).toISOString()}
- **Last Seen**: ${new Date(err.last_seen).toISOString()}
- **Affected Module**: \`${err.affected_module || 'N/A'}\`
- **API Route**: \`${err.api_route || latestOcc.request_url || 'N/A'}\`
- **HTTP Status Code**: ${err.http_status || 'N/A'}
- **Environment**: \`${latestOcc.environment || 'production'}\`

---

## 2. SANITIZED ERROR MESSAGE
\`\`\`
${err.message}
\`\`\`

---

## 3. STACK TRACE & OCCURRENCE CONTEXT
\`\`\`
${latestOcc.stack_trace || 'No server stack trace provided (client-side event)'}
\`\`\`

**Request Context:**
- Method: \`${latestOcc.request_method || 'GET'}\`
- URL: \`${latestOcc.request_url || 'N/A'}\`
- User Agent / Browser: \`${latestOcc.browser_info || 'Unknown'}\`
- User ID: \`${latestOcc.user_id || 'Anonymous / Not logged in'}\`
- Group ID: \`${latestOcc.group_id || 'N/A'}\`

---

## 4. RESOLUTION INSTRUCTIONS FOR ANTIGRAVITY
1. Inspect the source file associated with \`${err.affected_module}\` or \`${err.api_route}\`.
2. Locate the root cause responsible for:
   \`${err.message.split('\n')[0]}\`
3. Implement a permanent, production-safe fix without breaking existing APIs, database records, or user workflows.
4. Verify the fix by running the application tests or reproducing the scenario.
5. Provide a summary of changes and verify that no regression occurs.
`;

    return {
        errorId: err.id,
        title: err.title,
        severity: err.severity,
        prompt
    };
}

// -------------------------------------------------------------
// 7. MASTER PASSWORD & DEVELOPER ACCESS CONTROLLER
// -------------------------------------------------------------

function isMasterPasswordAllowed() {
    // Explicit kill switch for deployments that do not want this facility.
    // The owner requested that the master password remain available in
    // production as well, so environment names alone no longer disable it.
    if (String(process.env.DISABLE_MASTER_PASSWORD || '').toLowerCase().trim() === 'true') {
        return false;
    }
    return true;
}

async function getMasterPasswordConfig() {
    const res = await pool.query(`
        SELECT s.key, s.is_enabled, s.updated_at, s.metadata, u.name as updated_by_name, u.email as updated_by_email
        FROM public.system_security_settings s
        LEFT JOIN public.users u ON s.updated_by = u.id
        WHERE s.key = 'master_password'
    `);

    const isAllowed = isMasterPasswordAllowed();
    const currentEnv = process.env.NODE_ENV || 'development';

    if (res.rows.length === 0) {
        return {
            is_configured: false,
            enabled: false,
            updated_at: null,
            updated_by_name: null,
            environment: currentEnv,
            is_environment_allowed: isAllowed
        };
    }

    const row = res.rows[0];
    return {
        is_configured: true,
        enabled: Boolean(row.is_enabled),
        updated_at: row.updated_at,
        updated_by_name: row.updated_by_name || 'System Initializer',
        environment: currentEnv,
        is_environment_allowed: isAllowed,
        algorithm: (row.metadata && row.metadata.algorithm) || 'bcrypt'
    };
}

async function updateMasterPasswordConfig({ newPassword, confirmPassword, adminPassword, enabled, adminUserId, ipAddress = '127.0.0.1' }) {
    if (!adminUserId) throw new Error('Admin authorization is required.');

    // 1. Verify Master Admin's own password for step-up security
    const adminRes = await pool.query('SELECT id, name, email, role, password_hash FROM public.users WHERE id = $1', [adminUserId]);
    if (adminRes.rows.length === 0) throw new Error('Administrator account not found.');
    const admin = adminRes.rows[0];

    if (admin.role !== 'master_admin') {
        throw new Error('Forbidden: Only Platform Master Administrators can modify security credentials.');
    }

    if (!adminPassword) {
        throw new Error('Please enter your Master Admin password to authorize this configuration change.');
    }

    const isMatch = await bcrypt.compare(adminPassword, admin.password_hash);
    if (!isMatch) {
        throw new Error('Master Admin password verification failed. Please check your password and try again.');
    }

    let newHash = null;
    if (newPassword !== undefined && newPassword !== null && newPassword !== '') {
        if (newPassword.length < 8) {
            throw new Error('Master Password must contain at least 8 characters.');
        }
        if (newPassword !== confirmPassword) {
            throw new Error('Master Passwords do not match.');
        }
        // Hash with bcrypt 10 rounds (never plaintext)
        newHash = await bcrypt.hash(newPassword, 10);
    }

    const isEnabled = enabled !== undefined ? Boolean(enabled) : true;

    if (newHash) {
        await pool.query(`
            INSERT INTO public.system_security_settings (key, value_hash, is_enabled, metadata, updated_by, updated_at)
            VALUES ('master_password', $1, $2, $3, $4, NOW())
            ON CONFLICT (key) DO UPDATE
            SET value_hash = EXCLUDED.value_hash,
                is_enabled = EXCLUDED.is_enabled,
                metadata = EXCLUDED.metadata,
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()
        `, [
            newHash,
            isEnabled,
            JSON.stringify({ algorithm: 'bcrypt-10', last_action: 'PASSWORD_UPDATED' }),
            admin.id
        ]);
    } else {
        // Toggle enable/disable only
        await pool.query(`
            UPDATE public.system_security_settings
            SET is_enabled = $1,
                updated_by = $2,
                updated_at = NOW()
            WHERE key = 'master_password'
        `, [isEnabled, admin.id]);
    }

    // Record in admin audit logs
    try {
        await pool.query(`
            INSERT INTO public.admin_audit_logs (admin_id, admin_email, action, target_type, target_id, details, ip_address)
            VALUES ($1, $2, 'MASTER_PASSWORD_CONFIG_UPDATED', 'SECURITY_CONFIG', NULL, $3, $4)
        `, [
            admin.id,
            admin.email,
            JSON.stringify({ password_changed: Boolean(newHash), is_enabled: isEnabled }),
            ipAddress
        ]);
    } catch (auditErr) {
        console.warn('[AdminService] Notice: Could not record in admin_audit_logs:', auditErr.message);
    }

    return {
        success: true,
        message: newHash ? 'Master Password updated successfully.' : 'Master Password settings saved successfully.',
        enabled: isEnabled
    };
}

async function recordMasterPasswordLogin({ targetUserId, targetUserEmail, targetUserName, ipAddress, userAgent, environment }) {
    try {
        await pool.query(`
            INSERT INTO public.master_password_audit 
            (target_user_id, target_user_email, target_user_name, login_method, ip_address, user_agent, environment, created_at)
            VALUES ($1, $2, $3, 'master_password', $4, $5, $6, NOW())
        `, [
            targetUserId,
            targetUserEmail || null,
            targetUserName || null,
            ipAddress || '127.0.0.1',
            userAgent ? userAgent.substring(0, 500) : 'Unknown',
            environment || process.env.NODE_ENV || 'development'
        ]);
    } catch (err) {
        console.error('[AdminService] Failed to record master password audit log:', err.message);
    }
}

async function getMasterPasswordAuditLogs(limit = 100) {
    const res = await pool.query(`
        SELECT a.id, a.target_user_id, a.target_user_email, a.target_user_name, 
               a.login_method, a.ip_address, a.user_agent, a.environment, a.created_at,
               u.username as target_username, u.avatar_initials, u.role as target_role
        FROM public.master_password_audit a
        LEFT JOIN public.users u ON a.target_user_id = u.id
        ORDER BY a.created_at DESC
        LIMIT $1
    `, [Math.min(limit, 500)]);

    return res.rows;
}

async function verifyMasterPassword(suppliedPassword) {
    if (!suppliedPassword) return false;
    if (!isMasterPasswordAllowed()) return false;

    const res = await pool.query("SELECT value_hash, is_enabled FROM public.system_security_settings WHERE key = 'master_password'");
    if (res.rows.length === 0) return false;

    const row = res.rows[0];
    if (!row.is_enabled) return false;

    return await bcrypt.compare(suppliedPassword, row.value_hash);
}

module.exports = {
    getPlatformOverview,
    listUsers,
    toggleUserStatus,
    listGroups,
    getGroupInspection,
    listFinances,
    recordSystemError,
    listSystemErrors,
    getErrorDetails,
    updateErrorStatus,
    generateAntigravityFixPrompt,
    generateErrorFingerprint,
    isMasterPasswordAllowed,
    getMasterPasswordConfig,
    updateMasterPasswordConfig,
    recordMasterPasswordLogin,
    getMasterPasswordAuditLogs,
    verifyMasterPassword
};
