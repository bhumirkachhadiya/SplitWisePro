/**
 * ==============================================================================
 * CENTRALIZED RESILIENT POSTGRESQL POOL (SplitWise / Supabase)
 * ==============================================================================
 * Features:
 *  - Shared single connection pool across all backend services
 *  - TCP keepalive enabled to prevent cloud firewalls & Supabase from dropping idle connections
 *  - Transparent 1-time retry on socket disconnects / connection timeouts
 *  - Global error resilience against ECONNRESET / EPIPE / 57P01
 * ==============================================================================
 */

const { Pool } = require('pg');
require('dotenv').config();

const isSupabaseOrSSL = process.env.NODE_ENV === 'production' || 
    (process.env.DATABASE_URL && (process.env.DATABASE_URL.includes('supabase') || process.env.DATABASE_URL.includes('sslmode=require')));

const poolConfig = process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
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
        msg.includes('broken pipe') ||
        code === 'ECONNRESET' ||
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
    query: pool.query.bind(pool)
};
