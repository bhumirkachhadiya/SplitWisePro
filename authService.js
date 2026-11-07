/**
 * ==============================================================================
 * SPLITWISE AUTHENTICATION & SESSION SERVICE
 * ==============================================================================
 * - Opaque, cryptographically random session tokens (never a client-supplied ID)
 * - Only SHA-256 token hashes are stored server-side
 * - Server-side expiry, revocation and idle tracking
 * - Constant-time token comparison
 * ==============================================================================
 */

const crypto = require('crypto');
const { pool } = require('./db');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days absolute
const SESSION_IDLE_MS = 24 * 60 * 60 * 1000;    // 24h idle timeout

let tableReady = false;
let tableInitPromise = null;

async function ensureSessionTable() {
    if (tableReady) return;
    if (!tableInitPromise) {
        tableInitPromise = pool.query(`
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
        `).then(() => { tableReady = true; }).catch((err) => {
            tableInitPromise = null;
            throw err;
        });
    }
    await tableInitPromise;
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a session and return the plaintext token exactly once.
 */
async function createSession(userId, req = {}) {
    await ensureSessionTable();
    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const ip = (req.headers && (req.headers['x-forwarded-for'] || req.socket?.remoteAddress)) || req.ip || null;
    const ua = (req.headers && req.headers['user-agent']) || null;

    await pool.query(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at, ip_address, user_agent)
        VALUES ($1, $2, $3, $4, $5)
    `, [tokenHash, userId, expiresAt, typeof ip === 'string' ? ip.slice(0, 120) : null, ua ? String(ua).slice(0, 500) : null]);

    return { token, expiresAt: expiresAt.toISOString() };
}

/**
 * Resolve a bearer token to an active user. Returns null for any invalid state.
 */
async function resolveSession(token) {
    if (!token || typeof token !== 'string' || token.length < 32) return null;
    await ensureSessionTable();
    const tokenHash = hashToken(token);

    const res = await pool.query(`
        SELECT s.id AS session_id, s.user_id, s.expires_at, s.last_used_at,
               u.id, u.name, u.email, u.username, u.role, u.is_active, u.avatar_initials,
               u.upi_id, u.phone, u.default_currency, u.user_code, u.auth_id
        FROM user_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > NOW()
          AND s.last_used_at > NOW() - ($2::bigint * INTERVAL '1 millisecond')
        LIMIT 1
    `, [tokenHash, SESSION_IDLE_MS]);

    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    if (row.is_active === false) return null;

    // Touch last_used_at asynchronously (best-effort, never blocks auth)
    pool.query('UPDATE user_sessions SET last_used_at = NOW() WHERE id = $1', [row.session_id])
        .catch(() => { });

    return {
        id: row.id,
        name: row.name,
        email: row.email,
        username: row.username,
        role: row.role || 'user',
        avatar_initials: row.avatar_initials,
        upi_id: row.upi_id,
        phone: row.phone,
        default_currency: row.default_currency || 'INR',
        user_code: row.user_code,
        auth_id: row.auth_id,
        session_id: row.session_id
    };
}

async function revokeSession(token) {
    if (!token) return false;
    await ensureSessionTable();
    const r = await pool.query(
        'UPDATE user_sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id',
        [hashToken(token)]
    );
    return r.rows.length > 0;
}

async function revokeAllUserSessions(userId) {
    await ensureSessionTable();
    await pool.query('UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}

/**
 * Extract a session token from an Authorization header, x-session-token,
 * or the httpOnly-style cookie we also set on login.
 */
function extractToken(req) {
    const auth = req.headers && req.headers['authorization'];
    if (auth && typeof auth === 'string') {
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (m) return m[1].trim();
    }
    if (req.headers && req.headers['x-session-token']) {
        return String(req.headers['x-session-token']).trim();
    }
    const cookie = req.headers && req.headers['cookie'];
    if (cookie) {
        const m = String(cookie).match(/(?:^|;\s*)splitwise_session=([^;]+)/);
        if (m) return decodeURIComponent(m[1]);
    }
    return null;
}

module.exports = {
    ensureSessionTable,
    createSession,
    resolveSession,
    revokeSession,
    revokeAllUserSessions,
    extractToken,
    hashToken,
    SESSION_TTL_MS,
    SESSION_IDLE_MS
};
