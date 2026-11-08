/**
 * ==============================================================================
 * CENTRALIZED RESILIENT POSTGRESQL POOL (SplitWise / Supabase)
 * ==============================================================================
 * Features:
 *  - Shared single connection pool across all backend services
 *  - Automatic IPv6-to-IPv4 Supabase Pooler translation for Render / cloud hosts
 *  - DNS prioritization of IPv4 to eliminate ENETUNREACH socket errors
 *  - TCP keepalive enabled to prevent cloud firewalls from dropping idle connections
 *  - Transparent 1-time retry on socket disconnects / connection timeouts
 *  - Global error resilience against ECONNRESET / EPIPE / 57P01 / ENETUNREACH
 * ==============================================================================
 */

const { Pool } = require('pg');
const dns = require('dns');
require('dotenv').config();

// Ensure Node.js prioritizes IPv4 resolution for all outgoing sockets
if (dns && typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
}

/**
 * Direct Supabase hostnames (db.<ref>.supabase.co:5432) resolve exclusively to IPv6 addresses.
 * Cloud hosts like Render.com, AWS EC2, and Vercel without IPv6 routing fail with:
 *   "connect ENETUNREACH 2406:...:5432 - Local (:::0)"
 * This helper automatically rewrites direct Supabase connections to the official IPv4
 * Supabase Connection Pooler (Supavisor) so the app works reliably everywhere.
 */
function resolveResilientDatabaseUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
    try {
        const parsed = new URL(rawUrl);
        const match = (parsed.hostname || '').match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
        if (match) {
            const projectRef = match[1];
            const poolerHost = process.env.SUPABASE_POOLER_HOST || 'aws-0-ap-northeast-2.pooler.supabase.com';
            parsed.hostname = poolerHost;
            parsed.port = '6543'; // Supabase Transaction Mode Pooler (IPv4)
            if (parsed.username === 'postgres' || !parsed.username.includes('.')) {
                parsed.username = `postgres.${projectRef}`;
            }
            console.log(`[Database Pool] Auto-converted IPv6 direct connection to IPv4 Supabase Pooler: ${parsed.hostname}:6543`);
            return parsed.toString();
        }
    } catch (e) {
        // Fall back to original URL if parsing fails
    }
    return rawUrl;
}

const resolvedDatabaseUrl = resolveResilientDatabaseUrl(process.env.DATABASE_URL);

const isSupabaseOrSSL = process.env.NODE_ENV === 'production' || 
    (resolvedDatabaseUrl && (resolvedDatabaseUrl.includes('supabase') || resolvedDatabaseUrl.includes('sslmode=require')));

const poolConfig = resolvedDatabaseUrl
    ? {
        connectionString: resolvedDatabaseUrl,
        ssl: isSupabaseOrSSL ? { rejectUnauthorized: false } : false,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 30000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000
      }
    : {
        user: process.env.DB_USER || 'postgres',
        host: process.env.DB_HOST || 'localhost',
        database: process.env.DB_NAME || 'splitwise_db',
        password: process.env.DB_PASSWORD || 'postgres123',
        port: parseInt(process.env.DB_PORT || '5432'),
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 30000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000
      };

const pool = new Pool(poolConfig);

pool.on('error', (err, client) => {
    console.warn('[PostgreSQL Pool] Idle client socket drop recovered:', err.message);
});

function isRetryable(err) {
    if (!err) return false;
    const msg = (err.message || '').toLowerCase();
    const code = err.code || '';
    return (
        msg.includes('connection terminated') ||
        msg.includes('connection timeout') ||
        msg.includes('socket drop') ||
        msg.includes('econnreset') ||
        msg.includes('enetunreach') ||
        msg.includes('broken pipe') ||
        code === 'ECONNRESET' ||
        code === 'ENETUNREACH' ||
        code === '57P01' || // admin shutdown / terminated
        code === '08006' || // connection failure
        code === '08001'    // unable to connect
    );
}

// Enhance pool.query with transparent retry for transient socket drops
const originalQuery = pool.query.bind(pool);
pool.query = async function (text, params, callback) {
    if (typeof params === 'function') {
        callback = params;
        params = undefined;
    }
    if (typeof callback === 'function') {
        return originalQuery(text, params, callback);
    }
    try {
        return await originalQuery(text, params);
    } catch (err) {
        if (isRetryable(err)) {
            console.warn('[PostgreSQL Pool] Transparently retrying query after socket drop:', err.message);
            await new Promise(r => setTimeout(r, 200));
            return await originalQuery(text, params);
        }
        throw err;
    }
};

module.exports = {
    pool,
    query: pool.query.bind(pool),
    resolveResilientDatabaseUrl
};
