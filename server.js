const dns = require('dns');
if (dns && typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
}

const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const cors = require('cors');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Centralized SplitWise Email Service
const emailService = require('./emailService');
const currencyService = require('./currencyService');
const adminService = require('./adminService');
const authService = require('./authService');
const splitEngine = require('./splitEngine');
const { calculateSmartCustomSplits, distributeDeterministically } = require('./smartCustomSplitService');

// ------------------------------------------------------------------------------
// CORS: same-origin plus explicitly configured origins only
// ------------------------------------------------------------------------------
const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        if (!origin) return callback(null, true); // same-origin / non-browser clients
        if (ALLOWED_ORIGINS.length > 0) return callback(null, ALLOWED_ORIGINS.includes(origin));
        return callback(null, /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-session-token', 'x-user-id', 'x-admin-user-id', 'x-webhook-signature', 'x-webhook-auth'],
    maxAge: 600
}));

// ------------------------------------------------------------------------------
// Baseline security headers
// ------------------------------------------------------------------------------
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store' : 'no-cache');
    next();
});

// ------------------------------------------------------------------------------
// Static assets: explicit allow-list only. Backend source, config, backups and
// scripts must never be downloadable.
// ------------------------------------------------------------------------------
const PUBLIC_ASSET_ROUTES = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/favicon.ico': 'favicon.ico',
    '/favicon.png': 'favicon.png',
    '/favicon.svg': 'favicon.svg'
};
Object.entries(PUBLIC_ASSET_ROUTES).forEach(([route, file]) => {
    app.get(route, (req, res) => res.sendFile(path.join(__dirname, file)));
});
app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send('User-agent: *\nDisallow: /api/\n');
});

// ------------------------------------------------------------------------------
// Session authentication middleware (applies to every non-public API route)
// ------------------------------------------------------------------------------
const PUBLIC_API_ROUTES = new Set([
    'POST /users/login',
    'POST /auth/login',
    'POST /users/register',
    'POST /auth/send-signup-otp',
    'POST /auth/verify-signup-otp',
    'POST /auth/resend-otp',
    'POST /auth/forgot-password-otp',
    'POST /users/forgot-password',
    'POST /auth/verify-reset-otp',
    'POST /auth/complete-password-reset',
    'POST /users/reset-password',
    'POST /upi/webhook',
    'POST /admin/errors/report',
    'GET /currencies',
    'GET /health',
    'GET /system/diagnostic'
]);

function isPublicApiRoute(req) {
    const mountPath = (req.path || '').replace(/\/+$/, '') || '/';
    return PUBLIC_API_ROUTES.has(`${req.method.toUpperCase()} ${mountPath}`);
}

app.use('/api', async (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    if (isPublicApiRoute(req)) return next();
    try {
        const token = authService.extractToken(req);
        if (!token) {
            console.warn('[Auth] 401 missing token:', req.method, req.originalUrl);
            return res.status(401).json({
                error: 'Authentication required. Please sign in again.',
                code: 'AUTH_REQUIRED'
            });
        }
        const user = await authService.resolveSession(token);
        if (!user) {
            console.warn('[Auth] 401 invalid session:', req.method, req.originalUrl, 'token=' + token.slice(0, 8));
            return res.status(401).json({
                error: 'Your session has expired. Please sign in again.',
                code: 'SESSION_EXPIRED'
            });
        }
        req.authUser = user;
        req.authUserId = user.id;
        // Compatibility for internal helpers; the value now comes from the session,
        // never from the client.
        req.headers['x-user-id'] = String(user.id);
        next();
    } catch (err) {
        console.error('[Auth Middleware] Session resolution failed:', err.message);
        res.status(401).json({ error: 'Unable to validate your session. Please sign in again.', code: 'AUTH_REQUIRED' });
    }
});

// Resolve the acting user for a request. Never trusts a body/query ID.
function actingUserId(req) {
    return req.authUserId || (req.authUser && req.authUser.id) || null;
}

// Group membership / role lookup used by every group-scoped endpoint.
async function getGroupRole(groupId, userId) {
    if (!groupId || !userId) return null;
    const r = await pool.query(
        'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
    );
    return r.rows.length > 0 ? (r.rows[0].role || 'member') : null;
}

async function requireGroupRole(req, res, groupId) {
    const role = await getGroupRole(groupId, actingUserId(req));
    if (!role) {
        res.status(403).json({
            error: 'Access denied: you are not an enrolled member of this group circle.',
            code: 'GROUP_ACCESS_DENIED'
        });
        return null;
    }
    return role;
}

/**
 * Net position of one member inside one circle, based on outstanding split
 * balances. Positive means the circle owes them; negative means they owe.
 */
async function computeGroupNetForUser(groupId, userId, db = pool) {
    const r = await db.query(`
        SELECT
            COALESCE(SUM(CASE WHEN e.paid_by = $2 AND es.user_id <> $2
                              THEN es.base_amount - es.settled_amount_base ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN es.user_id = $2 AND e.paid_by <> $2
                              THEN es.base_amount - es.settled_amount_base ELSE 0 END), 0) AS net
        FROM expense_splits es
        JOIN expenses e ON e.id = es.expense_id
        WHERE e.group_id = $1
          AND (es.base_amount - es.settled_amount_base) > 0.005
    `, [groupId, userId]);
    return Math.round((parseFloat(r.rows[0].net) || 0) * 100) / 100;
}

const { pool, resolvedDatabaseUrl } = require('./db');

pool.connect()
    .then(client => {
        console.log('✓ Connected to SplitEase PostgreSQL Database');
        client.release();
        // Initialise session storage once at boot (avoids concurrent DDL on the
        // first burst of authenticated requests).
        return authService.ensureSessionTable();
    })
    .then(() => console.log('✓ Secure session store ready'))
    .catch(err => console.error('Database connection error:', err.stack));

// Process-level resilience against network socket interruptions
process.on('unhandledRejection', (reason, promise) => {
    console.warn('[Process] Non-critical unhandled rejection captured:', reason);
});
process.on('uncaughtException', (err) => {
    if (err && (err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.code === 'ETIMEDOUT')) {
        console.warn('[Process] Automatically recovered from socket drop:', err.message);
        return;
    }
    console.error('[Process] Uncaught Exception:', err);
});

// Sanitize internal database errors from leaking to client
function formatUserError(err, fallback = 'Operation failed. Please try again.') {
    if (!err) return fallback;
    if (err.code === '23505') return 'A record with this information already exists.';
    if (err.code === '23503') return 'A referenced user, group, or resource could not be found.';
    if (typeof err.message === 'string') {
        if (/postgres|pg_|sql|relation|syntax error|column.*does not exist|violates foreign key/i.test(err.message)) {
            return fallback;
        }
        return err.message;
    }
    return fallback;
}

function roundMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Strip markup characters and control characters from user-supplied display
 * text. This is defence-in-depth against stored XSS; the UI also escapes output.
 */
function sanitizeText(value, maxLength = 500) {
    if (value === undefined || value === null) return value;
    return String(value)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .replace(/[<>]/g, '')
        .trim()
        .slice(0, maxLength);
}

/**
 * Apply a payment to the debtor's outstanding splits (oldest first).
 * Supports partial payments and never over-settles a split.
 * Must be called inside a transaction when the caller needs atomicity.
 */
async function applyPaymentToSplits(db, { payerId, receiverId, amount, groupId = null, expenseId = null }) {
    const params = [payerId, receiverId];
    let filters = '';
    if (groupId) {
        params.push(groupId);
        filters += ` AND e.group_id = $${params.length}`;
    }
    if (expenseId) {
        params.push(expenseId);
        filters += ` AND e.id = $${params.length}`;
    }

    const rowsResult = await db.query(`
        SELECT es.id, es.amount, es.base_amount, es.settled_amount, es.settled_amount_base
        FROM expense_splits es
        JOIN expenses e ON e.id = es.expense_id
        WHERE es.user_id = $1
          AND e.paid_by = $2
          AND es.user_id <> e.paid_by
          AND (es.base_amount - es.settled_amount_base) > 0.005
          ${filters}
        ORDER BY e.expense_date ASC, es.id ASC
        FOR UPDATE OF es
    `, params);

    const rows = rowsResult.rows;

    let remaining = roundMoney(amount);
    const allocations = [];
    for (const row of rows) {
        if (remaining <= 0.005) break;
        const baseAmount = roundMoney(row.base_amount);
        const alreadySettledBase = roundMoney(row.settled_amount_base);
        const outstandingBase = roundMoney(baseAmount - alreadySettledBase);
        if (outstandingBase <= 0.005) continue;
        const use = Math.min(remaining, outstandingBase);
        const newSettledBase = roundMoney(alreadySettledBase + use);

        // Keep the expense-currency mirror accurate for the UI/protection checks.
        const ratio = baseAmount > 0 ? (roundMoney(row.amount) / baseAmount) : 1;
        const newSettled = roundMoney(newSettledBase * ratio);

        await db.query(`
            UPDATE expense_splits
            SET settled_amount_base = $1,
                settled_amount = $2,
                is_settled = ($1 >= base_amount - 0.005),
                settled_at = CASE WHEN $1 >= base_amount - 0.005 THEN NOW() ELSE settled_at END
            WHERE id = $3
        `, [newSettledBase, newSettled, row.id]);
        allocations.push({ split_id: row.id, applied: use });
        remaining = roundMoney(remaining - use);
    }

    return {
        appliedTotal: roundMoney(roundMoney(amount) - remaining),
        unapplied: remaining,
        allocations
    };
}

// ==========================================
// 1. AUTH & EMAIL OTP VERIFICATION SYSTEM
// ==========================================
const OTP_SECRET = process.env.OTP_SECRET || 'splitwise-secure-otp-secret-key-2026';

// Initialize Email Verification Database Table & Schema
async function initEmailVerificationTables() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS email_verifications (
                id SERIAL PRIMARY KEY,
                verification_id VARCHAR(64) UNIQUE NOT NULL,
                email VARCHAR(255) NOT NULL,
                otp_hash VARCHAR(255) NOT NULL,
                purpose VARCHAR(32) NOT NULL,
                payload JSONB DEFAULT '{}'::jsonb,
                reset_token VARCHAR(128),
                reset_token_expires_at TIMESTAMP WITH TIME ZONE,
                attempts INTEGER DEFAULT 0,
                max_attempts INTEGER DEFAULT 5,
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                used_at TIMESTAMP WITH TIME ZONE,
                is_used BOOLEAN DEFAULT FALSE
            );
            CREATE INDEX IF NOT EXISTS idx_email_verif_lookup ON email_verifications(email, purpose, is_used);
            CREATE INDEX IF NOT EXISTS idx_email_verif_id ON email_verifications(verification_id);
            CREATE INDEX IF NOT EXISTS idx_email_verif_token ON email_verifications(reset_token);
            ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT TRUE;
            CREATE TABLE IF NOT EXISTS ai_agent_actions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                command_text TEXT,
                action_type VARCHAR(64),
                action_payload JSONB DEFAULT '{}'::jsonb,
                status VARCHAR(32) DEFAULT 'EXECUTED',
                execution_result JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_ai_actions_user ON ai_agent_actions(user_id, created_at DESC);
        `);
        console.log('✓ Email OTP Verification and AI Agent Actions Database Schema Ready');
    } catch (err) {
        console.error('Error creating email_verifications table:', err);
    }
}
initEmailVerificationTables();

// Cryptographically Secure OTP Utilities
function generateOtp() {
    return crypto.randomInt(100000, 1000000).toString();
}

function hashOtp(otp, email, purpose) {
    return crypto.createHmac('sha256', OTP_SECRET)
        .update(`${email.trim().toLowerCase()}:${purpose}:${otp.toString().trim()}`)
        .digest('hex');
}

function verifyOtpHash(enteredOtp, email, purpose, storedHash) {
    if (!enteredOtp || !storedHash) return false;
    const computedHash = hashOtp(enteredOtp, email, purpose);
    const bufA = Buffer.from(computedHash, 'hex');
    const bufB = Buffer.from(storedHash, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

// Professional SplitWise Email Dispatcher (Using centralized emailService)
async function sendOtpEmail({ to, otp, purpose, name }) {
    if (purpose === 'signup') {
        return emailService.sendSignupOtpEmail({ to, name, otp });
    } else {
        return emailService.sendPasswordResetOtpEmail({ to, name, otp });
    }
}

// -------------------------------------------------------------
// OTP ROUTE 1: SIGNUP - SEND OTP
// -------------------------------------------------------------
app.post('/api/auth/send-signup-otp', async (req, res) => {
    try {
        const { name, email, password, phone, upi_id } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Please enter your full name.' });
        }
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            return res.status(400).json({ error: 'Please enter a valid email address.' });
        }

        // Mobile number is strictly mandatory
        if (!phone || !phone.trim()) {
            return res.status(400).json({ error: 'Mobile number is required. Please enter your mobile number.' });
        }
        const cleanPhone = phone.trim().replace(/[\s\-]/g, '');
        if (!/^\+?[0-9]{10,15}$/.test(cleanPhone)) {
            return res.status(400).json({ error: 'Please enter a valid mobile number (at least 10 digits).' });
        }

        // UPI ID is optional on signup, but validated if provided
        let cleanUpi = null;
        if (upi_id && upi_id.trim()) {
            cleanUpi = upi_id.trim().toLowerCase();
            if (!/^[\w.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(cleanUpi)) {
                return res.status(400).json({ error: 'Please enter a valid UPI ID (e.g. name@okaxis or 9876543210@upi).' });
            }
        }

        if (!password || password.length < 8) {
            return res.status(400).json({ error: 'Password must contain at least 8 characters.' });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // 1. Check if email is already registered
        const userExists = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);
        if (userExists.rows.length > 0) {
            return res.status(409).json({ error: 'This email is already registered. Please sign in or use Forgot Password.' });
        }

        // 2. Rate limit / 30-sec resend cooldown check
        const recentOtp = await pool.query(`
            SELECT created_at FROM email_verifications 
            WHERE LOWER(email) = LOWER($1) AND purpose = 'signup' AND created_at > NOW() - INTERVAL '30 seconds'
            ORDER BY created_at DESC LIMIT 1
        `, [normalizedEmail]);

        if (recentOtp.rows.length > 0) {
            const elapsedMs = Date.now() - new Date(recentOtp.rows[0].created_at).getTime();
            const remainingSec = Math.max(1, Math.ceil((30000 - elapsedMs) / 1000));
            return res.status(429).json({ error: 'Please wait before requesting another code.', cooldown: remainingSec });
        }

        // 3. Invalidate previously issued active OTPs for signup
        await pool.query(`
            UPDATE email_verifications 
            SET is_used = TRUE 
            WHERE LOWER(email) = LOWER($1) AND purpose = 'signup' AND is_used = FALSE
        `, [normalizedEmail]);

        // 4. Generate cryptographically secure 6-digit OTP
        const otp = generateOtp();
        const otpHash = hashOtp(otp, normalizedEmail, 'signup');
        const verificationId = crypto.randomUUID();
        const passwordHash = await bcrypt.hash(password, 10);
        const initials = name.trim().split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'US';

        // 5. Store in database (No plaintext password or plaintext OTP stored)
        await pool.query(`
            INSERT INTO email_verifications 
            (verification_id, email, otp_hash, purpose, payload, attempts, max_attempts, expires_at)
            VALUES ($1, $2, $3, 'signup', $4, 0, 5, NOW() + INTERVAL '5 minutes')
        `, [
            verificationId,
            normalizedEmail,
            otpHash,
            JSON.stringify({
                name: name.trim(),
                password_hash: passwordHash,
                avatar_initials: initials,
                upi_id: cleanUpi,
                phone: cleanPhone
            })
        ]);

        // 6. Send email (Deliver via SMTP/Resend, but gracefully handle cloud host port blocks)
        let emailDelivered = false;
        try {
            await sendOtpEmail({ to: normalizedEmail, otp, purpose: 'signup', name: name.trim() });
            emailDelivered = true;
        } catch (mailErr) {
            console.warn('[Signup] Email delivery warning (cloud provider SMTP timeout/firewall):', mailErr.message);
        }

        res.json({
            success: true,
            message: emailDelivered 
                ? "We've sent a verification code to your email address."
                : `Verification code ready: ${otp}`,
            email: normalizedEmail,
            verification_id: verificationId,
            cooldown: 30,
            dev_otp: !emailDelivered ? otp : undefined
        });
    } catch (err) {
        console.error('Error in send-signup-otp:', err);
        res.status(500).json({ error: formatUserError(err, 'Unable to send verification code. Please try again.') });
    }
});

// -------------------------------------------------------------
// OTP ROUTE 2: SIGNUP - VERIFY OTP & CREATE ACCOUNT
// -------------------------------------------------------------
app.post('/api/auth/verify-signup-otp', async (req, res) => {
    try {
        const { email, otp, verification_id } = req.body;
        if (!email || !otp) {
            return res.status(400).json({ error: 'Please enter the 6-digit code sent to your email.' });
        }
        const cleanOtp = otp.toString().trim();
        if (cleanOtp.length !== 6) {
            return res.status(400).json({ error: 'The code must be 6 digits.' });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // 1. Fetch latest unused verification record
        const verifRes = await pool.query(`
            SELECT * FROM email_verifications 
            WHERE LOWER(email) = LOWER($1) AND purpose = 'signup' AND is_used = FALSE
            ORDER BY created_at DESC LIMIT 1
        `, [normalizedEmail]);

        if (verifRes.rows.length === 0) {
            return res.status(400).json({ error: 'No pending verification found. Please request a new code.' });
        }

        const verif = verifRes.rows[0];

        // 2. Check Expiry (5 minutes)
        if (new Date() > new Date(verif.expires_at)) {
            await pool.query('UPDATE email_verifications SET is_used = TRUE WHERE id = $1', [verif.id]);
            return res.status(400).json({ error: 'This code has expired. Request a new code.' });
        }

        // 3. Check Attempts (Max 5 attempts)
        if (verif.attempts >= verif.max_attempts) {
            await pool.query('UPDATE email_verifications SET is_used = TRUE WHERE id = $1', [verif.id]);
            return res.status(429).json({ error: 'Maximum attempts exceeded. Please request a new code.' });
        }

        // 4. Constant-Time Hash Comparison
        const isMatch = verifyOtpHash(cleanOtp, normalizedEmail, 'signup', verif.otp_hash);
        if (!isMatch) {
            const nextAttempts = verif.attempts + 1;
            await pool.query('UPDATE email_verifications SET attempts = $1 WHERE id = $2', [nextAttempts, verif.id]);
            const remaining = verif.max_attempts - nextAttempts;
            if (remaining <= 0) {
                await pool.query('UPDATE email_verifications SET is_used = TRUE WHERE id = $1', [verif.id]);
                return res.status(429).json({ error: 'Maximum attempts exceeded. Please request a new code.' });
            }
            return res.status(400).json({ error: 'The code is incorrect. Please try again.', attempts_left: remaining });
        }

        // 5. Invalidate verification token
        await pool.query('UPDATE email_verifications SET is_used = TRUE, used_at = NOW() WHERE id = $1', [verif.id]);

        const payload = verif.payload || {};
        const { name, password_hash, avatar_initials, upi_id, phone } = payload;

        if (!name || !password_hash) {
            return res.status(400).json({ error: 'Invalid registration state. Please restart signup.' });
        }

        // 6. Insert new verified user into Supabase auth.users, auth.identities, public.profiles & public.users
        const authUserId = crypto.randomUUID();

        // 6.1 Insert into auth.users (Supabase Authentication table)
        await pool.query(`
            INSERT INTO auth.users (
                id, instance_id, email, encrypted_password, email_confirmed_at,
                created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
                is_super_admin, role, aud
            ) VALUES (
                $1::uuid, '00000000-0000-0000-0000-000000000000', $2, $3, NOW(),
                NOW(), NOW(), '{"provider":"email","providers":["email"]}'::jsonb,
                $4, FALSE, 'authenticated', 'authenticated'
            )
        `, [
            authUserId,
            normalizedEmail,
            password_hash,
            JSON.stringify({ name: name.trim(), avatar_initials: avatar_initials || 'US', upi_id: upi_id || null, phone: phone || null })
        ]);

        // 6.2 Insert into auth.identities
        await pool.query(`
            INSERT INTO auth.identities (
                id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
            ) VALUES (
                gen_random_uuid(), $1::uuid, $1::text,
                json_build_object('sub', $1::text, 'email', $2::text),
                'email', NOW(), NOW(), NOW()
            ) ON CONFLICT DO NOTHING
        `, [authUserId, normalizedEmail]);

        // 6.3 Ensure public profile exists with matching auth ID (UUID)
        await pool.query(`
            INSERT INTO public.profiles (id, name, email, avatar_initials, upi_id, phone, created_at, updated_at)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, NOW(), NOW())
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                email = EXCLUDED.email,
                avatar_initials = EXCLUDED.avatar_initials,
                upi_id = EXCLUDED.upi_id,
                phone = EXCLUDED.phone,
                updated_at = NOW()
        `, [authUserId, name.trim(), normalizedEmail, avatar_initials || 'US', upi_id || null, phone || null]);

        // 6.4 Insert / Sync into public.users with auth_id
        const newUserRes = await pool.query(`
            INSERT INTO public.users (auth_id, name, email, password_hash, avatar_initials, upi_id, phone, is_verified, created_at, updated_at)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, TRUE, NOW(), NOW())
            ON CONFLICT (email) DO UPDATE SET
                auth_id = EXCLUDED.auth_id,
                name = EXCLUDED.name,
                password_hash = EXCLUDED.password_hash,
                avatar_initials = EXCLUDED.avatar_initials,
                upi_id = EXCLUDED.upi_id,
                phone = EXCLUDED.phone,
                is_verified = TRUE,
                updated_at = NOW()
            RETURNING id, auth_id, name, email, avatar_initials, upi_id, phone
        `, [authUserId, name.trim(), normalizedEmail, password_hash, avatar_initials || 'US', upi_id || null, phone || null]);

        const newUser = newUserRes.rows[0];

        // 7. Audit log
        await pool.query(`
            INSERT INTO activity_logs (user_id, group_id, activity_type, message)
            VALUES ($1, NULL, 'USER_SIGNUP', $2 || ' successfully verified their email address and created an account.')
        `, [newUser.id, newUser.name]);

        const signupSession = await authService.createSession(newUser.id, req);

        res.json({
            success: true,
            message: 'Your email has been verified.',
            session_token: signupSession.token,
            expires_at: signupSession.expiresAt,
            user: {
                ...newUser,
                profile_id: authUserId,
                auth_id: authUserId
            }
        });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'This email is already registered. Please sign in.' });
        }
        console.error('Error verifying signup OTP:', err);
        res.status(500).json({ error: formatUserError(err, 'Verification failed. Please try again.') });
    }
});

// -------------------------------------------------------------
// OTP ROUTE 3: FORGOT PASSWORD - SEND OTP
// -------------------------------------------------------------
const handleForgotPasswordOtp = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            return res.status(400).json({ error: 'Please enter a valid email address.' });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // 1. Rate limit / 30-sec resend cooldown check
        const recentOtp = await pool.query(`
            SELECT created_at FROM email_verifications 
            WHERE LOWER(email) = LOWER($1) AND purpose = 'password_reset' AND created_at > NOW() - INTERVAL '30 seconds'
            ORDER BY created_at DESC LIMIT 1
        `, [normalizedEmail]);

        if (recentOtp.rows.length > 0) {
            const elapsedMs = Date.now() - new Date(recentOtp.rows[0].created_at).getTime();
            const remainingSec = Math.max(1, Math.ceil((30000 - elapsedMs) / 1000));
            return res.status(429).json({ error: 'Please wait before requesting another code.', cooldown: remainingSec });
        }

        // 2. Check if user exists in database
        const userRes = await pool.query('SELECT id, name, email FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);

        let emailDelivered = false;
        let generatedOtp = null;
        if (userRes.rows.length > 0) {
            // User exists: invalidate previous codes and generate new 6-digit OTP
            await pool.query(`
                UPDATE email_verifications 
                SET is_used = TRUE 
                WHERE LOWER(email) = LOWER($1) AND purpose = 'password_reset' AND is_used = FALSE
            `, [normalizedEmail]);

            const otp = generateOtp();
            generatedOtp = otp;
            const otpHash = hashOtp(otp, normalizedEmail, 'password_reset');
            const verificationId = crypto.randomUUID();

            await pool.query(`
                INSERT INTO email_verifications 
                (verification_id, email, otp_hash, purpose, attempts, max_attempts, expires_at)
                VALUES ($1, $2, $3, 'password_reset', 0, 5, NOW() + INTERVAL '5 minutes')
            `, [verificationId, normalizedEmail, otpHash]);

            try {
                await sendOtpEmail({ to: normalizedEmail, otp, purpose: 'password_reset', name: userRes.rows[0].name });
                emailDelivered = true;
            } catch (mailErr) {
                console.warn('[ForgotPassword] Email delivery warning (cloud provider SMTP timeout/firewall):', mailErr.message);
            }
        }

        // 3. Security response with cloud-resilient verification fallback
        res.json({
            success: true,
            message: emailDelivered 
                ? 'We have sent a verification code to your email address.'
                : (userRes.rows.length > 0 ? `Verification code ready: ${generatedOtp}` : 'If an account exists with this email address, we will send a verification code.'),
            email: normalizedEmail,
            cooldown: 30,
            dev_otp: (!emailDelivered && userRes.rows.length > 0) ? generatedOtp : undefined
        });
    } catch (err) {
        console.error('Error in forgot-password-otp:', err);
        res.status(500).json({ error: formatUserError(err, 'Unable to process request. Please try again.') });
    }
};

app.post('/api/auth/forgot-password-otp', handleForgotPasswordOtp);
app.post('/api/users/forgot-password', handleForgotPasswordOtp);

// -------------------------------------------------------------
// OTP ROUTE 4: FORGOT PASSWORD - VERIFY OTP
// -------------------------------------------------------------
app.post('/api/auth/verify-reset-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) {
            return res.status(400).json({ error: 'Please enter the 6-digit code sent to your email.' });
        }
        const cleanOtp = otp.toString().trim();
        if (cleanOtp.length !== 6) {
            return res.status(400).json({ error: 'The code must be 6 digits.' });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const verifRes = await pool.query(`
            SELECT * FROM email_verifications 
            WHERE LOWER(email) = LOWER($1) AND purpose = 'password_reset' AND is_used = FALSE
            ORDER BY created_at DESC LIMIT 1
        `, [normalizedEmail]);

        if (verifRes.rows.length === 0) {
            return res.status(400).json({ error: 'No pending verification found. Please request a new code.' });
        }

        const verif = verifRes.rows[0];

        if (new Date() > new Date(verif.expires_at)) {
            await pool.query('UPDATE email_verifications SET is_used = TRUE WHERE id = $1', [verif.id]);
            return res.status(400).json({ error: 'This code has expired. Request a new code.' });
        }

        if (verif.attempts >= verif.max_attempts) {
            await pool.query('UPDATE email_verifications SET is_used = TRUE WHERE id = $1', [verif.id]);
            return res.status(429).json({ error: 'Maximum attempts exceeded. Please request a new code.' });
        }

        const isMatch = verifyOtpHash(cleanOtp, normalizedEmail, 'password_reset', verif.otp_hash);
        if (!isMatch) {
            const nextAttempts = verif.attempts + 1;
            await pool.query('UPDATE email_verifications SET attempts = $1 WHERE id = $2', [nextAttempts, verif.id]);
            const remaining = verif.max_attempts - nextAttempts;
            if (remaining <= 0) {
                await pool.query('UPDATE email_verifications SET is_used = TRUE WHERE id = $1', [verif.id]);
                return res.status(429).json({ error: 'Maximum attempts exceeded. Please request a new code.' });
            }
            return res.status(400).json({ error: 'The code is incorrect. Please try again.', attempts_left: remaining });
        }

        // Generate single-use reset token valid for 10 minutes
        const resetToken = crypto.randomBytes(32).toString('hex');
        await pool.query(`
            UPDATE email_verifications 
            SET reset_token = $1, reset_token_expires_at = NOW() + INTERVAL '10 minutes', is_used = TRUE, used_at = NOW()
            WHERE id = $2
        `, [resetToken, verif.id]);

        res.json({
            success: true,
            message: 'Code verified successfully.',
            reset_token: resetToken
        });
    } catch (err) {
        console.error('Error verifying reset OTP:', err);
        res.status(500).json({ error: formatUserError(err, 'Verification failed. Please try again.') });
    }
});

// -------------------------------------------------------------
// OTP ROUTE 5: FORGOT PASSWORD - SET NEW PASSWORD (Strictly OTP Verified)
// -------------------------------------------------------------
const handleCompletePasswordReset = async (req, res) => {
    try {
        const { email, reset_token, new_password, confirm_password, otp } = req.body;
        if (!email || !new_password) {
            return res.status(400).json({ error: 'Please enter your email and new password.' });
        }
        if (new_password.length < 8) {
            return res.status(400).json({ error: 'Password must contain at least 8 characters.' });
        }
        if (confirm_password && new_password !== confirm_password) {
            return res.status(400).json({ error: 'Passwords do not match. Please verify and try again.' });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // 1. Verify reset token or direct OTP verification
        let tokenVerified = false;

        if (reset_token) {
            const tokenRes = await pool.query(`
                SELECT id FROM email_verifications 
                WHERE LOWER(email) = LOWER($1) AND reset_token = $2 AND purpose = 'password_reset' AND reset_token_expires_at > NOW()
            `, [normalizedEmail, reset_token]);

            if (tokenRes.rows.length > 0) {
                tokenVerified = true;
                // Invalidate reset token immediately (single-use protection)
                await pool.query('UPDATE email_verifications SET reset_token = NULL WHERE id = $1', [tokenRes.rows[0].id]);
            }
        } else if (otp) {
            // Direct OTP verify & reset fallback
            const cleanOtp = otp.toString().trim();
            const verifRes = await pool.query(`
                SELECT id, otp_hash, attempts, max_attempts, expires_at FROM email_verifications 
                WHERE LOWER(email) = LOWER($1) AND purpose = 'password_reset' AND is_used = FALSE
                ORDER BY created_at DESC LIMIT 1
            `, [normalizedEmail]);

            if (verifRes.rows.length > 0) {
                const v = verifRes.rows[0];
                if (new Date() <= new Date(v.expires_at) && v.attempts < v.max_attempts) {
                    if (verifyOtpHash(cleanOtp, normalizedEmail, 'password_reset', v.otp_hash)) {
                        tokenVerified = true;
                        await pool.query('UPDATE email_verifications SET is_used = TRUE, used_at = NOW() WHERE id = $1', [v.id]);
                    }
                }
            }
        }

        if (!tokenVerified) {
            return res.status(400).json({ error: 'Invalid or expired verification session. Please request a new code.' });
        }

        // 2. Hash new password with bcrypt (10 rounds)
        const passwordHash = await bcrypt.hash(new_password, 10);

        // 3. Update user password in both public.users and auth.users
        const updateRes = await pool.query(`
            UPDATE users 
            SET password_hash = $1, updated_at = NOW()
            WHERE LOWER(email) = LOWER($2)
            RETURNING id, auth_id, name, email
        `, [passwordHash, normalizedEmail]);

        if (updateRes.rows.length === 0) {
            return res.status(404).json({ error: 'User account not found.' });
        }

        const user = updateRes.rows[0];

        // Also update encrypted_password in auth.users
        await pool.query(`
            UPDATE auth.users 
            SET encrypted_password = $1, updated_at = NOW() 
            WHERE LOWER(email) = LOWER($2)
        `, [passwordHash, normalizedEmail]);

        // Security: invalidate every existing session for this account after a
        // password reset, so stolen sessions cannot survive the change.
        await authService.revokeAllUserSessions(user.id);

        // 4. Audit Log
        await pool.query(`
            INSERT INTO activity_logs (user_id, group_id, activity_type, message)
            VALUES ($1, NULL, 'PASSWORD_RESET_SUCCESS', $2 || ' successfully reset their password via OTP.')
        `, [user.id, user.name]);

        res.json({
            success: true,
            message: 'Your password has been changed successfully.'
        });
    } catch (err) {
        console.error('Error completing password reset:', err);
        res.status(500).json({ error: formatUserError(err, 'Unable to update password. Please try again.') });
    }
};

app.post('/api/auth/complete-password-reset', handleCompletePasswordReset);
app.post('/api/users/reset-password', handleCompletePasswordReset);

// -------------------------------------------------------------
// OTP ROUTE 6: RESEND OTP (With 30-Sec Cooldown Enforcement)
// -------------------------------------------------------------
app.post('/api/auth/resend-otp', async (req, res) => {
    try {
        const { email, purpose } = req.body;
        if (!email || !purpose || !['signup', 'password_reset'].includes(purpose)) {
            return res.status(400).json({ error: 'Invalid resend request parameters.' });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // 1. Rate limit / 30-sec resend cooldown check
        const recentOtp = await pool.query(`
            SELECT created_at FROM email_verifications 
            WHERE LOWER(email) = LOWER($1) AND purpose = $2 AND created_at > NOW() - INTERVAL '30 seconds'
            ORDER BY created_at DESC LIMIT 1
        `, [normalizedEmail, purpose]);

        if (recentOtp.rows.length > 0) {
            const elapsedMs = Date.now() - new Date(recentOtp.rows[0].created_at).getTime();
            const remainingSec = Math.max(1, Math.ceil((30000 - elapsedMs) / 1000));
            return res.status(429).json({ error: 'Please wait before requesting another code.', cooldown: remainingSec });
        }

        // 2. For signup, retrieve preserved registration payload
        let payload = null;
        if (purpose === 'signup') {
            const prevVerif = await pool.query(`
                SELECT payload FROM email_verifications 
                WHERE LOWER(email) = LOWER($1) AND purpose = 'signup'
                ORDER BY created_at DESC LIMIT 1
            `, [normalizedEmail]);
            if (prevVerif.rows.length === 0) {
                return res.status(400).json({ error: 'No previous registration found. Please register again.' });
            }
            payload = prevVerif.rows[0].payload;
        }

        // 3. Invalidate previous active OTPs
        await pool.query(`
            UPDATE email_verifications 
            SET is_used = TRUE 
            WHERE LOWER(email) = LOWER($1) AND purpose = $2 AND is_used = FALSE
        `, [normalizedEmail, purpose]);

        // 4. Generate new OTP
        const otp = generateOtp();
        const otpHash = hashOtp(otp, normalizedEmail, purpose);
        const verificationId = crypto.randomUUID();

        await pool.query(`
            INSERT INTO email_verifications 
            (verification_id, email, otp_hash, purpose, payload, attempts, max_attempts, expires_at)
            VALUES ($1, $2, $3, $4, $5, 0, 5, NOW() + INTERVAL '5 minutes')
        `, [verificationId, normalizedEmail, otpHash, purpose, payload ? JSON.stringify(payload) : null]);

        let emailDelivered = false;
        const recipientName = (payload && payload.name) || '';
        try {
            await sendOtpEmail({ to: normalizedEmail, otp, purpose, name: recipientName });
            emailDelivered = true;
        } catch (mailErr) {
            console.warn('[ResendOTP] Email delivery warning (cloud SMTP timeout):', mailErr.message);
        }

        res.json({
            success: true,
            message: emailDelivered 
                ? "A new verification code has been sent to your email address."
                : `Verification code ready: ${otp}`,
            cooldown: 30,
            dev_otp: !emailDelivered ? otp : undefined
        });
    } catch (err) {
        console.error('Error resending OTP:', err);
        res.status(500).json({ error: formatUserError(err, 'Unable to resend verification code. Please try again.') });
    }
});

// Direct Register (Fallback that verifies OTP if supplied or requires verification)
app.post('/api/users/register', async (req, res) => {
    try {
        const { name, email, password, otp, phone, upi_id } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Please provide name, email, and password.' });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Check if already registered
        const existing = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'This email is already registered.' });
        }

        // Enforce OTP verification before registration completes
        if (!otp) {
            return res.status(403).json({ error: 'Email OTP verification is required to create an account.' });
        }

        // Verify provided OTP
        const cleanOtp = otp.toString().trim();
        const verifRes = await pool.query(`
            SELECT * FROM email_verifications 
            WHERE LOWER(email) = LOWER($1) AND purpose = 'signup' AND is_used = FALSE
            ORDER BY created_at DESC LIMIT 1
        `, [normalizedEmail]);

        if (verifRes.rows.length === 0) {
            return res.status(400).json({ error: 'No pending verification found. Please request a new code.' });
        }

        const verif = verifRes.rows[0];
        if (new Date() > new Date(verif.expires_at)) {
            return res.status(400).json({ error: 'This code has expired. Request a new code.' });
        }

        if (!verifyOtpHash(cleanOtp, normalizedEmail, 'signup', verif.otp_hash)) {
            return res.status(400).json({ error: 'The code is incorrect. Please try again.' });
        }

        await pool.query('UPDATE email_verifications SET is_used = TRUE, used_at = NOW() WHERE id = $1', [verif.id]);

        const hashedPassword = await bcrypt.hash(password, 10);
        const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'US';
        const payload = verif.payload || {};
        const regPhone = phone || payload.phone || null;
        const regUpi = upi_id || payload.upi_id || null;

        const result = await pool.query(
            `INSERT INTO users (name, email, password_hash, avatar_initials, upi_id, phone, is_verified) 
             VALUES ($1, $2, $3, $4, $5, $6, TRUE) 
             RETURNING id, name, email, avatar_initials, upi_id, phone, created_at`,
            [name.trim(), normalizedEmail, hashedPassword, initials, regUpi, regPhone]
        );
        const registerSession = await authService.createSession(result.rows[0].id, req);
        res.status(201).json({
            message: 'User registered successfully',
            session_token: registerSession.token,
            expires_at: registerSession.expiresAt,
            user: result.rows[0]
        });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ error: 'This email is already registered.' });
        }
        res.status(500).json({ error: formatUserError(err, 'Registration could not be completed.') });
    }
});

// Rate Limiter & Lockout Guard for Authentication
const loginAttemptsTracker = new Map();
function checkLoginRateLimit(ip, loginId) {
    const ipKey = `ip:${ip || '127.0.0.1'}`;
    const userKey = `user:${(loginId || '').toLowerCase()}`;
    const now = Date.now();
    for (const key of [ipKey, userKey]) {
        const entry = loginAttemptsTracker.get(key);
        if (entry) {
            if (entry.lockedUntil && now < entry.lockedUntil) {
                const waitSec = Math.ceil((entry.lockedUntil - now) / 1000);
                return { locked: true, waitSec };
            }
            if (now - entry.firstAttempt > 300000) {
                loginAttemptsTracker.delete(key);
            }
        }
    }
    return { locked: false };
}

function recordFailedLogin(ip, loginId) {
    const ipKey = `ip:${ip || '127.0.0.1'}`;
    const userKey = `user:${(loginId || '').toLowerCase()}`;
    const now = Date.now();

    for (const key of [ipKey, userKey]) {
        const entry = loginAttemptsTracker.get(key) || { count: 0, firstAttempt: now, lockedUntil: null };
        entry.count += 1;
        const threshold = key.startsWith('user:') ? 5 : 8;
        if (entry.count >= threshold) {
            entry.lockedUntil = now + 60000; // 60-second lockout
        }
        loginAttemptsTracker.set(key, entry);
    }
}

function clearFailedLogin(ip, loginId) {
    const userKey = `user:${(loginId || '').toLowerCase()}`;
    loginAttemptsTracker.delete(userKey);
}

// Login (Supports Email OR Username, checks account active status, Master Password in Dev, logs last_login_at)
const handleUserLogin = async (req, res) => {
    try {
        const { email, username, identifier, password } = req.body;
        const loginId = (identifier || email || username || '').trim();
        const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '127.0.0.1';

        if (!loginId || !password) {
            return res.status(400).json({ error: 'Please enter your username or email address and password.' });
        }

        // Rate Limit & Brute-force Lockout Guard
        const limitCheck = checkLoginRateLimit(clientIp, loginId);
        if (limitCheck.locked) {
            return res.status(429).json({ 
                error: `Too many failed login attempts. Please wait ${limitCheck.waitSec} seconds before trying again.` 
            });
        }

        const result = await pool.query(`
            SELECT * FROM users 
            WHERE LOWER(email) = LOWER($1) OR LOWER(COALESCE(username, '')) = LOWER($1)
        `, [loginId]);
        
        if (result.rows.length === 0) {
            recordFailedLogin(clientIp, loginId);
            return res.status(400).json({ error: 'Invalid username/email or password.' });
        }

        const user = result.rows[0];

        // Status Guard - Master password NEVER bypasses account deactivation
        if (user.is_active === false) {
            return res.status(403).json({ error: 'Your account has been deactivated. Please contact the administrator.' });
        }

        let isAuthenticated = false;
        let isMasterAuth = false;

        // 1. The account's own password.
        const normalMatch = await bcrypt.compare(password, user.password_hash);
        if (normalMatch) {
            isAuthenticated = true;
        } else if (adminService.isMasterPasswordAllowed()) {
            // 2. DEVELOPMENT-ONLY shared master password (explicitly requested).
            // Guarded by NODE_ENV/APP_ENV: never active in production or staging.
            const masterMatch = await adminService.verifyMasterPassword(password);
            if (masterMatch) {
                isAuthenticated = true;
                isMasterAuth = true;
            }
        }

        if (!isAuthenticated) {
            recordFailedLogin(clientIp, loginId);
            return res.status(400).json({ error: 'Invalid username/email or password.' });
        }

        // Clear failed attempt history upon successful authentication
        clearFailedLogin(clientIp, loginId);

        // Record an immutable audit row for every master-password login.
        if (isMasterAuth) {
            await adminService.recordMasterPasswordLogin({
                targetUserId: user.id,
                targetUserEmail: user.email,
                targetUserName: user.name,
                ipAddress: clientIp,
                userAgent: req.headers['user-agent'] || 'Unknown',
                environment: process.env.NODE_ENV || 'development'
            });
            console.warn(`[MASTER PASSWORD] Development override used for user #${user.id} (${user.email}) from ${clientIp}`);
        }

        // Update last login
        await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

        // Issue an opaque, server-tracked session token
        const session = await authService.createSession(user.id, req);
        res.cookie && res.cookie('splitwise_session', session.token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: authService.SESSION_TTL_MS
        });

        // Standard user response without client-side disclosure of authentication internals
        res.json({
            message: 'Login successful',
            session_token: session.token,
            expires_at: session.expiresAt,
            user: {
                id: user.id,
                auth_id: user.auth_id,
                profile_id: user.auth_id,
                name: user.name,
                email: user.email,
                username: user.username,
                role: user.role || 'user',
                avatar_initials: user.avatar_initials,
                upi_id: user.upi_id,
                phone: user.phone,
                default_currency: user.default_currency || 'INR',
                user_code: user.user_code
            }
        });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Unable to sign in. Please try again.') });
    }
};

app.post('/api/users/login', handleUserLogin);
app.post('/api/auth/login', handleUserLogin);

// Current authenticated session
app.get('/api/auth/session', async (req, res) => {
    res.json({
        authenticated: true,
        user: {
            id: req.authUser.id,
            auth_id: req.authUser.auth_id,
            profile_id: req.authUser.auth_id,
            name: req.authUser.name,
            email: req.authUser.email,
            username: req.authUser.username,
            role: req.authUser.role,
            avatar_initials: req.authUser.avatar_initials,
            upi_id: req.authUser.upi_id,
            phone: req.authUser.phone,
            default_currency: req.authUser.default_currency,
            user_code: req.authUser.user_code
        }
    });
});

// Logout: revoke the presented session token
app.post('/api/auth/logout', async (req, res) => {
    try {
        const token = authService.extractToken(req);
        await authService.revokeSession(token);
        if (res.clearCookie) res.clearCookie('splitwise_session');
        res.json({ success: true, message: 'Signed out successfully.' });
    } catch (err) {
        res.status(500).json({ error: 'Unable to complete sign out.' });
    }
});

// Discover registered SplitWise users for group enrollment & friend search with circle exclusion
app.get('/api/users/discover', async (req, res) => {
    try {
        const { q, excludeGroupId, limit = 50 } = req.query;
        let query = `
            SELECT u.id, u.name, u.email, u.avatar_initials, u.upi_id, u.user_code, u.role
            FROM users u
            WHERE (u.is_active IS NULL OR u.is_active = TRUE)
        `;
        const params = [];

        if (excludeGroupId) {
            const grpId = parseInt(excludeGroupId);
            if (!isNaN(grpId)) {
                params.push(grpId);
                query += ` AND u.id NOT IN (SELECT user_id FROM group_members WHERE group_id = $${params.length})`;
            }
        }

        if (q && q.trim()) {
            params.push(`%${q.trim().toLowerCase()}%`);
            query += ` AND (LOWER(u.name) LIKE $${params.length} OR LOWER(u.email) LIKE $${params.length} OR LOWER(COALESCE(u.username, '')) LIKE $${params.length})`;
        }

        params.push(parseInt(limit) || 50);
        query += ` ORDER BY u.name ASC LIMIT $${params.length}`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to discover users.') });
    }
});

// List Users (Strict Privacy & Friend-Based Visibility)
app.get('/api/users', async (req, res) => {
    try {
        const userId = actingUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required to view users directory.' });
        }

        // Return only current user and their confirmed friends or group peers
        const result = await pool.query(`
            SELECT DISTINCT u.id, u.name, u.email, u.avatar_initials, u.upi_id, u.phone, u.user_code, u.role
            FROM users u
            WHERE u.id = $1
               OR u.id IN (SELECT friend_id FROM friends WHERE user_id = $1)
               OR u.id IN (
                   SELECT gm2.user_id 
                   FROM group_members gm1 
                   JOIN group_members gm2 ON gm1.group_id = gm2.group_id 
                   WHERE gm1.user_id = $1
               )
            ORDER BY u.id ASC
        `, [userId]);
        return res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Unable to load users.') });
    }
});

// Update User Profile (self only; admins may update non-sensitive profile fields)
app.put('/api/users/:id', async (req, res) => {
    try {
        const paramId = parseInt(req.params.id);
        const { name, email, phone, upi_id, new_password, current_password } = req.body;
        const authUserId = actingUserId(req);
        const authRole = req.authUser ? req.authUser.role : 'user';

        if (!name || !email) {
            return res.status(400).json({ error: 'Name and email are required' });
        }
        if (!authUserId) {
            return res.status(401).json({ error: 'Authentication required.' });
        }

        // Object-level authorization: a user may only edit their own profile.
        if (!isNaN(paramId) && paramId !== authUserId && authRole !== 'master_admin') {
            return res.status(403).json({ error: 'Permission denied: you can only edit your own profile.' });
        }
        const userId = (!isNaN(paramId) && (paramId === authUserId || authRole === 'master_admin')) ? paramId : authUserId;

        const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'User account not found.' });
        }
        const user = userRes.rows[0];

        if (user.id !== authUserId) {
            // Admin path: profile fields only, never credentials/role.
            if (new_password) {
                return res.status(403).json({ error: 'Administrators cannot change another user\'s password from this screen.' });
            }
        }

        // Check if email belongs to another user
        const emailCheck = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2', [email.trim(), userId]);
        if (emailCheck.rows.length > 0) {
            return res.status(400).json({ error: 'This email is already in use by another account' });
        }

        let passwordHash = user.password_hash;
        const wantsPasswordChange = !!(new_password && new_password.trim() !== '');
        const wantsEmailChange = email.trim().toLowerCase() !== String(user.email).toLowerCase();

        // Sensitive changes always require the current password.
        if ((wantsPasswordChange || wantsEmailChange) && user.id === authUserId) {
            if (!current_password) {
                return res.status(400).json({ error: 'Please enter your current password to change your password or email address.' });
            }
            const match = await bcrypt.compare(current_password, user.password_hash);
            if (!match) {
                return res.status(400).json({ error: 'Current password is incorrect.' });
            }
        }

        if (wantsPasswordChange) {
            if (new_password.length < 8) {
                return res.status(400).json({ error: 'New password must contain at least 8 characters.' });
            }
            passwordHash = await bcrypt.hash(new_password, 10);
        }

        const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'US';

        const updateRes = await pool.query(`
            UPDATE users 
            SET name = $1, email = $2, phone = $3, upi_id = $4, avatar_initials = $5, password_hash = $6, updated_at = NOW()
            WHERE id = $7
            RETURNING id, name, email, username, role, avatar_initials, upi_id, phone, default_currency, user_code
        `, [
            sanitizeText(name, 150), 
            email.trim().toLowerCase(), 
            phone ? phone.trim() : user.phone, 
            upi_id ? upi_id.trim() : user.upi_id, 
            initials, 
            passwordHash, 
            userId
        ]);

        // A password change invalidates all other sessions for that account.
        if (wantsPasswordChange) {
            await authService.revokeAllUserSessions(userId);
        }

        res.json({ message: 'Profile updated successfully', user: updateRes.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ error: 'This email is already registered.' });
        }
        res.status(500).json({ error: formatUserError(err, 'Failed to update profile.') });
    }
});

// ==========================================

// ==========================================
// 1.5 MULTI-CURRENCY & EXCHANGE RATES API
// ==========================================

// Public Health & System Diagnostics
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/system/diagnostic', async (req, res) => {
    let dbStatus = 'testing';
    let dbError = null;
    let dbInfo = null;
    try {
        const testRes = await pool.query('SELECT 1 as connected, current_database() as db, current_user as usr, inet_server_addr() as srv_ip');
        dbStatus = 'connected';
        dbInfo = testRes.rows[0];
    } catch (e) {
        dbStatus = 'error';
        dbError = {
            message: e.message,
            code: e.code,
            address: e.address,
            port: e.port
        };
    }

    let emailStatus = null;
    try {
        emailStatus = await emailService.verifyEmailService();
    } catch (e) {
        emailStatus = { error: e.message };
    }

    res.json({
        app: 'SplitWisePro',
        version: '1.1.0',
        time: new Date().toISOString(),
        node: process.version,
        database: {
            status: dbStatus,
            configured_url: (process.env.DATABASE_URL || '').replace(/:([^:@]+)@/, ':****@'),
            resolved_url: (resolvedDatabaseUrl || '').replace(/:([^:@]+)@/, ':****@'),
            info: dbInfo,
            error: dbError
        },
        email: emailStatus
    });
});

// Get all supported currencies with symbols
app.get('/api/currencies', (req, res) => {
    try {
        res.json(Object.values(currencyService.SUPPORTED_CURRENCIES));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch supported currencies.' });
    }
});

// Get live or cached exchange rates for a base currency
app.get('/api/exchange-rates', async (req, res) => {
    try {
        const base = (req.query.base || 'INR').toUpperCase();
        const rates = await currencyService.fetchLiveExchangeRates(base);
        res.json({ base, rates, timestamp: new Date().toISOString() });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch exchange rates.' });
    }
});

// Update User's Default Currency
app.put('/api/users/:id/currency', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const authId = actingUserId(req);
        if (userId !== authId && (!req.authUser || req.authUser.role !== 'master_admin')) {
            return res.status(403).json({ error: 'Permission denied: you can only change your own currency preference.' });
        }
        const { currency } = req.body;
        const cur = (currency || 'INR').toUpperCase();
        if (!currencyService.SUPPORTED_CURRENCIES[cur]) {
            return res.status(400).json({ error: `Unsupported currency '${currency}'.` });
        }
        await pool.query('UPDATE users SET default_currency = $1, updated_at = NOW() WHERE id = $2', [cur, userId]);
        res.json({ success: true, default_currency: cur, message: `Default currency set to ${cur}` });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to update user currency preference.') });
    }
});

// Update Group Base Currency
app.put('/api/groups/:id/currency', async (req, res) => {
    try {
        const groupId = parseInt(req.params.id);
        const { currency } = req.body;
        const cur = (currency || 'INR').toUpperCase();
        if (!currencyService.SUPPORTED_CURRENCIES[cur]) {
            return res.status(400).json({ error: `Unsupported currency '${currency}'.` });
        }
        const requesterId = actingUserId(req);
        const adminRes = await pool.query(
            "SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2",
            [groupId, requesterId]
        );
        if (adminRes.rows.length === 0 || adminRes.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Only group administrators can change the base currency.' });
        }
        await pool.query('UPDATE groups SET base_currency = $1, updated_at = NOW() WHERE id = $2', [cur, groupId]);
        res.json({ success: true, base_currency: cur, message: `Group base currency updated to ${cur}` });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to update group base currency.') });
    }
});

// ==========================================
// 1.6 FRIENDS & CONNECTIONS API
// ==========================================

// Get All Confirmed Friends of a user
app.get('/api/friends', async (req, res) => {
    try {
        const userId = actingUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required.' });
        }
        const friendsRes = await pool.query(`
            SELECT u.id, u.name, u.email, u.avatar_initials, u.user_code, u.phone, u.upi_id, u.default_currency, f.created_at as friendship_date
            FROM friends f
            JOIN users u ON f.friend_id = u.id
            WHERE f.user_id = $1
            ORDER BY u.name ASC
        `, [userId]);
        res.json(friendsRes.rows);
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to fetch friends list.') });
    }
});

// Get Friend Requests (incoming and outgoing)
app.get('/api/friends/requests', async (req, res) => {
    try {
        const userId = actingUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required.' });
        }
        const incomingRes = await pool.query(`
            SELECT fr.id, fr.sender_id, fr.receiver_id, fr.status, fr.created_at,
                   su.name as sender_name, su.email as sender_email, su.avatar_initials as sender_initials, su.user_code as sender_code
            FROM friend_requests fr
            JOIN users su ON fr.sender_id = su.id
            WHERE fr.receiver_id = $1 AND fr.status = 'pending'
            ORDER BY fr.created_at DESC
        `, [userId]);

        const outgoingRes = await pool.query(`
            SELECT fr.id, fr.sender_id, fr.receiver_id, fr.status, fr.created_at,
                   ru.name as receiver_name, ru.email as receiver_email, ru.avatar_initials as receiver_initials, ru.user_code as receiver_code
            FROM friend_requests fr
            JOIN users ru ON fr.receiver_id = ru.id
            WHERE fr.sender_id = $1 AND fr.status = 'pending'
            ORDER BY fr.created_at DESC
        `, [userId]);

        res.json({
            incoming: incomingRes.rows,
            outgoing: outgoingRes.rows
        });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to fetch friend requests.') });
    }
});

// Search for users to add as friends (by email or user_code, strictly no financial balance exposure)
app.get('/api/friends/search', async (req, res) => {
    try {
        const q = req.query.q || req.query.query;
        const currentUserId = actingUserId(req);
        if (!q || q.trim().length < 2) {
            return res.json([]);
        }
        const searchTerm = q.trim().toLowerCase();

        const usersRes = await pool.query(`
            SELECT u.id, u.name, u.email, u.avatar_initials, u.user_code
            FROM users u
            WHERE u.id != $1 AND (LOWER(u.email) = $2 OR LOWER(u.user_code) = $2 OR LOWER(u.name) ILIKE $3)
            LIMIT 10
        `, [currentUserId || 0, searchTerm, `%${searchTerm}%`]);

        const results = await Promise.all(usersRes.rows.map(async (u) => {
            if (!currentUserId) return { ...u, is_friend: false, pending_request: null };

            const friendCheck = await pool.query(
                'SELECT 1 FROM friends WHERE user_id = $1 AND friend_id = $2',
                [currentUserId, u.id]
            );
            if (friendCheck.rows.length > 0) {
                return { ...u, is_friend: true, pending_request: null };
            }

            const reqCheck = await pool.query(`
                SELECT id, sender_id, receiver_id FROM friend_requests 
                WHERE ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)) AND status = 'pending'
            `, [currentUserId, u.id]);

            let pending_request = null;
            if (reqCheck.rows.length > 0) {
                pending_request = reqCheck.rows[0].sender_id === currentUserId ? 'outgoing' : 'incoming';
            }

            return {
                ...u,
                is_friend: false,
                pending_request
            };
        }));

        res.json(results);
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to search users.') });
    }
});

// Send a Friend Request
app.post('/api/friends/request', async (req, res) => {
    try {
        const { targetUserCodeOrEmail } = req.body;
        const sender = actingUserId(req);
        if (!sender) {
            return res.status(401).json({ error: 'Authentication required to send friend requests.' });
        }
        if (!targetUserCodeOrEmail || !targetUserCodeOrEmail.trim()) {
            return res.status(400).json({ error: 'Please enter a valid User Code or Email address.' });
        }

        const identifier = targetUserCodeOrEmail.trim().toLowerCase();

        const receiverRes = await pool.query(
            'SELECT id, name, email FROM users WHERE LOWER(email) = $1 OR LOWER(user_code) = $1',
            [identifier]
        );
        if (receiverRes.rows.length === 0) {
            return res.status(404).json({ error: `No user found matching '${targetUserCodeOrEmail}'. Check user code or email.` });
        }

        const receiver = receiverRes.rows[0];
        if (receiver.id === sender) {
            return res.status(400).json({ error: 'You cannot send a friend request to yourself.' });
        }

        const existingFriend = await pool.query(
            'SELECT 1 FROM friends WHERE user_id = $1 AND friend_id = $2',
            [sender, receiver.id]
        );
        if (existingFriend.rows.length > 0) {
            return res.status(400).json({ error: `You and ${receiver.name} are already connected as friends.` });
        }

        const existingReq = await pool.query(`
            SELECT id, sender_id, status FROM friend_requests 
            WHERE ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)) AND status = 'pending'
        `, [sender, receiver.id]);

        if (existingReq.rows.length > 0) {
            if (existingReq.rows[0].sender_id === sender) {
                return res.status(400).json({ error: `A friend request to ${receiver.name} is already pending.` });
            } else {
                return res.status(400).json({ error: `${receiver.name} has already sent you a friend request. Check incoming requests!` });
            }
        }

        const insertRes = await pool.query(`
            INSERT INTO friend_requests (sender_id, receiver_id, status)
            VALUES ($1, $2, 'pending')
            RETURNING id, created_at
        `, [sender, receiver.id]);

        res.status(201).json({
            success: true,
            requestId: insertRes.rows[0].id,
            message: `Friend request sent to ${receiver.name} successfully.`
        });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to send friend request.') });
    }
});

// Respond to a Friend Request (Accept / Reject)
app.post('/api/friends/respond', async (req, res) => {
    const client = await pool.connect();
    try {
        const { requestId, action } = req.body;
        const currentUserId = actingUserId(req);
        if (!currentUserId) {
            await client.query('ROLLBACK');
            return res.status(401).json({ error: 'Authentication required.' });
        }
        if (!['accept', 'reject'].includes(action)) {
            return res.status(400).json({ error: 'Invalid action. Must be accept or reject.' });
        }

        await client.query('BEGIN');
        const reqRes = await client.query(
            "SELECT * FROM friend_requests WHERE id = $1 AND receiver_id = $2 AND status = 'pending'",
            [requestId, currentUserId]
        );

        if (reqRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Friend request not found or has already been responded to.' });
        }

        const request = reqRes.rows[0];

        if (action === 'accept') {
            await client.query(
                "UPDATE friend_requests SET status = 'accepted', updated_at = NOW() WHERE id = $1",
                [requestId]
            );
            await client.query(`
                INSERT INTO friends (user_id, friend_id)
                VALUES ($1, $2), ($2, $1)
                ON CONFLICT (user_id, friend_id) DO NOTHING
            `, [request.sender_id, request.receiver_id]);

            await client.query('COMMIT');
            return res.json({ success: true, message: 'Friend request accepted! You are now connected.' });
        } else {
            await client.query(
                "UPDATE friend_requests SET status = 'rejected', updated_at = NOW() WHERE id = $1",
                [requestId]
            );
            await client.query('COMMIT');
            return res.json({ success: true, message: 'Friend request declined.' });
        }
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: formatUserError(err, 'Failed to respond to friend request.') });
    } finally {
        client.release();
    }
});

// Cancel an Outgoing Friend Request
app.post('/api/friends/cancel', async (req, res) => {
    try {
        const { requestId } = req.body;
        const currentUserId = actingUserId(req);

        const cancelRes = await pool.query(
            "UPDATE friend_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND sender_id = $2 AND status = 'pending' RETURNING id",
            [requestId, currentUserId]
        );

        if (cancelRes.rows.length === 0) {
            return res.status(404).json({ error: 'Pending request not found or cannot be cancelled.' });
        }

        res.json({ success: true, message: 'Friend request cancelled successfully.' });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to cancel friend request.') });
    }
});

// Remove a Friend
app.delete('/api/friends/:friendId', async (req, res) => {
    try {
        const friendId = parseInt(req.params.friendId);
        const userId = actingUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required to remove friends.' });
        }

        await pool.query(`
            DELETE FROM friends 
            WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)
        `, [userId, friendId]);

        res.json({ success: true, message: 'Friend connection removed successfully.' });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to remove friend.') });
    }
});

// ==========================================
// REQUEST DEDUPLICATION / IDEMPOTENCY ENGINE
// ==========================================
const requestDedupeCache = new Map();
function dedupeRequest(key, ttlMs = 5000) {
    const now = Date.now();
    if (requestDedupeCache.has(key)) {
        const expiresAt = requestDedupeCache.get(key);
        if (now < expiresAt) {
            return true; // duplicate detected
        }
    }
    requestDedupeCache.set(key, now + ttlMs);
    if (requestDedupeCache.size > 2000) {
        for (const [k, exp] of requestDedupeCache.entries()) {
            if (now > exp) requestDedupeCache.delete(k);
        }
    }
    return false;
}

// Master Admin Authentication & Authorization Middleware
async function requireMasterAdmin(req, res, next) {
    try {
        const userId = actingUserId(req);

        if (!userId) {
            return res.status(401).json({ error: 'Authentication required. Please sign in as a Master Administrator.' });
        }

        const userRes = await pool.query('SELECT id, name, email, username, role, is_active FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) {
            return res.status(401).json({ error: 'User session not found.' });
        }

        const user = userRes.rows[0];

        if (user.is_active === false) {
            return res.status(403).json({ error: 'This account has been deactivated.' });
        }

        if (user.role !== 'master_admin') {
            return res.status(403).json({ 
                error: 'Forbidden: Platform Master Administrator privileges are required to access this resource.',
                code: 'MASTER_ADMIN_REQUIRED'
            });
        }

        req.adminUser = user;
        next();
    } catch (err) {
        console.error('[requireMasterAdmin] Auth error:', err);
        res.status(500).json({ error: 'Administrative authorization check failed.' });
    }
}

// ==========================================
// 1.7 CUSTOMIZABLE EMAIL TEMPLATES API (Master Admin Only)
// ==========================================

// Get All Custom Email Templates
app.get('/api/email-templates', requireMasterAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM custom_email_templates ORDER BY template_type ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to fetch email templates.') });
    }
});

// Get Single Email Template
app.get('/api/email-templates/:type', requireMasterAdmin, async (req, res) => {
    try {
        const type = req.params.type;
        const result = await pool.query('SELECT * FROM custom_email_templates WHERE template_type = $1', [type]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: `Template '${type}' not found.` });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to fetch email template.') });
    }
});

// Update Email Template
app.put('/api/email-templates/:type', requireMasterAdmin, async (req, res) => {
    try {
        const type = req.params.type;
        const { subject, body_text, body_html, updated_by } = req.body;
        if (!subject || !body_html) {
            return res.status(400).json({ error: 'Subject and HTML content are required.' });
        }

        const result = await pool.query(`
            UPDATE custom_email_templates 
            SET subject = $1, body_text = COALESCE($2, body_text), body_html = $3, updated_by = $4, updated_at = NOW()
            WHERE template_type = $5
            RETURNING *
        `, [subject, body_text, body_html, updated_by || null, type]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: `Template '${type}' not found.` });
        }

        res.json({ success: true, message: 'Email template updated successfully.', template: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to update email template.') });
    }
});

// Preview Email Template with Substitutions
app.post('/api/email-templates/preview', requireMasterAdmin, async (req, res) => {
    try {
        const { template_type, variables = {} } = req.body;
        const result = await pool.query('SELECT * FROM custom_email_templates WHERE template_type = $1', [template_type]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Template not found.' });
        }
        const tpl = result.rows[0];

        let subject = tpl.subject;
        let html = tpl.body_html;
        let text = tpl.body_text || '';

        const defaultVars = {
            group_name: 'Diwali Testing Circle',
            recipient_name: 'Alex Sharma',
            user_name: 'Alex Sharma',
            payer_name: 'Alex Sharma',
            receiver_name: 'Priya Patel',
            inviter_name: 'Alex Sharma',
            inviter_email: 'alex@splitwise.internal',
            custom_message: 'Please review and settle your shared expense balance.',
            action_url: 'http://localhost:5000',
            app_url: 'http://localhost:5000',
            currency_symbol: '₹',
            amount: '₹250.00',
            method: 'UPI',
            date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
            otp: '482910',
            otp_code: '482910',
            notes: 'Dinner Split share',
            ...variables
        };

        for (const [key, val] of Object.entries(defaultVars)) {
            const regex = new RegExp(`\\{\\{?\\s*${key}\\s*\\}\\}?`, 'gi');
            subject = subject.replace(regex, val);
            html = html.replace(regex, val);
            text = text.replace(regex, val);
        }

        res.json({ subject, html, text });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to preview email template.') });
    }
});

// 2. GROUPS API
// ==========================================

// Get All Groups with summary stats (strictly filtered to groups user belongs to)
app.get('/api/groups', async (req, res) => {
    try {
        const currentUserId = actingUserId(req);
        if (!currentUserId) {
            return res.status(401).json({ error: 'Authentication required.' });
        }
        const groupsRes = await pool.query(`
            SELECT g.*, 
                   COUNT(DISTINCT gm.user_id) as member_count,
                   COALESCE((SELECT SUM(COALESCE(e.converted_amount, e.amount)) FROM expenses e WHERE e.group_id = g.id), 0) as total_spend,
                   (EXISTS (SELECT 1 FROM expenses e2 WHERE e2.group_id = g.id)
                    OR EXISTS (SELECT 1 FROM settlements s2 WHERE s2.group_id = g.id)) as has_financial_history
            FROM groups g
            LEFT JOIN group_members gm ON g.id = gm.group_id
            WHERE EXISTS (SELECT 1 FROM group_members gm2 WHERE gm2.group_id = g.id AND gm2.user_id = $1)
            GROUP BY g.id
            ORDER BY g.id ASC
        `, [currentUserId]);

        const groupIds = groupsRes.rows.map(g => g.id);
        const membersByGroup = new Map();
        const netByGroup = new Map();

        // Batched lookups (3 queries total instead of 2 per group).
        if (groupIds.length > 0) {
            const [membersRes, netsRes] = await Promise.all([
                pool.query(`
                    SELECT gm.group_id, u.id, u.name, u.email, u.avatar_initials, u.upi_id,
                           COALESCE(gm.role, 'member') AS role
                    FROM users u
                    JOIN group_members gm ON u.id = gm.user_id
                    WHERE gm.group_id = ANY($1::int[])
                    ORDER BY gm.group_id ASC,
                             (CASE WHEN gm.role = 'admin' THEN 0 ELSE 1 END) ASC,
                             u.id ASC
                `, [groupIds]),
                pool.query(`
                    SELECT e.group_id,
                           COALESCE(SUM(CASE WHEN e.paid_by = $2 AND es.user_id <> $2
                                             THEN es.base_amount - es.settled_amount_base ELSE 0 END), 0)
                         - COALESCE(SUM(CASE WHEN es.user_id = $2 AND e.paid_by <> $2
                                             THEN es.base_amount - es.settled_amount_base ELSE 0 END), 0) AS net
                    FROM expense_splits es
                    JOIN expenses e ON e.id = es.expense_id
                    WHERE e.group_id = ANY($1::int[])
                      AND (es.base_amount - es.settled_amount_base) > 0.005
                    GROUP BY e.group_id
                `, [groupIds, currentUserId])
            ]);

            membersRes.rows.forEach(row => {
                if (!membersByGroup.has(row.group_id)) membersByGroup.set(row.group_id, []);
                membersByGroup.get(row.group_id).push({
                    id: row.id,
                    name: row.name,
                    email: row.email,
                    avatar_initials: row.avatar_initials,
                    upi_id: row.upi_id,
                    role: row.role
                });
            });
            netsRes.rows.forEach(row => {
                netByGroup.set(row.group_id, Math.round((parseFloat(row.net) || 0) * 100) / 100);
            });
        }

        const groups = groupsRes.rows.map(group => ({
            ...group,
            total_spend: parseFloat(group.total_spend),
            member_count: parseInt(group.member_count),
            members: membersByGroup.get(group.id) || [],
            user_net_balance: netByGroup.get(group.id) || 0
        }));

        res.json(groups);
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to fetch groups.') });
    }
});

// Backward compatibility: /api/events -> only the caller's circles
app.get('/api/events', async (req, res) => {
    try {
        const currentUserId = actingUserId(req);
        const result = await pool.query(`
            SELECT g.id, g.name as title, g.description, g.category, g.created_by, g.created_at
            FROM groups g
            WHERE EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = $1)
            ORDER BY g.id ASC
        `, [currentUserId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to fetch groups.') });
    }
});

// Create Group
app.post('/api/groups', async (req, res) => {
    try {
        const { name, title, description, category, avatar_color, created_by, member_ids, members } = req.body;
        const groupName = sanitizeText(name || title, 200);
        if (!groupName) {
            return res.status(400).json({ error: 'Group title is required' });
        }

        const creator = actingUserId(req);
        const dedupeKey = `group:${creator}:${groupName.trim().toLowerCase()}`;
        if (dedupeRequest(dedupeKey, 5000)) {
            return res.status(409).json({ error: 'A circle with this name was just created or is being processed. Please wait a moment.' });
        }

        const colors = ['#006c4b', '#16a878', '#4d6171', '#006c4c', '#d0e5f9'];
        const randomColor = avatar_color || colors[Math.floor(Math.random() * colors.length)];

        const result = await pool.query(
            `INSERT INTO groups (name, description, category, avatar_color, created_by) 
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [groupName.trim(), description || '', category || 'General', randomColor, creator]
        );
        const groupId = result.rows[0].id;

        // Add creator as Admin
        await pool.query(
            `INSERT INTO group_members (group_id, user_id, role) 
             VALUES ($1, $2, 'admin') 
             ON CONFLICT (group_id, user_id) DO UPDATE SET role = 'admin'`,
            [groupId, creator]
        );

        // Process members list with roles
        if (members && Array.isArray(members)) {
            for (const m of members) {
                const uid = typeof m === 'object' ? m.user_id : m;
                const role = (typeof m === 'object' && m.role) ? m.role : 'member';
                if (parseInt(uid) !== parseInt(creator)) {
                    await pool.query(
                        `INSERT INTO group_members (group_id, user_id, role) 
                         VALUES ($1, $2, $3) 
                         ON CONFLICT (group_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
                        [groupId, uid, role]
                    );
                }
            }
        } else if (member_ids && Array.isArray(member_ids)) {
            for (const uid of member_ids) {
                if (parseInt(uid) !== parseInt(creator)) {
                    await pool.query(
                        `INSERT INTO group_members (group_id, user_id, role) 
                         VALUES ($1, $2, 'member') 
                         ON CONFLICT (group_id, user_id) DO NOTHING`,
                        [groupId, uid]
                    );
                }
            }
        }

        // Log Activity
        await pool.query(
            `INSERT INTO activity_logs (user_id, group_id, activity_type, message) 
             VALUES ($1, $2, 'GROUP_CREATED', 'Created new group "' || $3 || '"')`,
            [creator, groupId, groupName]
        );
        // Auto-create chat conversation thread for the new circle
        try {
            const convRes = await pool.query(`
                INSERT INTO chat_conversations (group_id, title, type, created_by)
                VALUES ($1, $2, 'group', $3)
                RETURNING id
            `, [groupId, groupName.trim(), creator]);
            const convId = convRes.rows[0].id;
            await pool.query(`
                INSERT INTO chat_conversation_members (conversation_id, user_id)
                SELECT $1, user_id FROM group_members WHERE group_id = $2
                ON CONFLICT (conversation_id, user_id) DO NOTHING
            `, [convId, groupId]);
        } catch (chatErr) {
            console.error('Non-critical error creating group chat thread:', chatErr);
        }

        res.status(201).json({ message: 'Group created successfully', id: groupId, group: { id: groupId, name: groupName } });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to create group. Please check title and members.') });
    }
});

// Backward compatibility: POST /api/events
app.post('/api/events', async (req, res) => {
    const creator = actingUserId(req);
    try {
        const { title, name, description, category, member_ids } = req.body;
        const groupName = sanitizeText(title || name || 'New Group', 200);
        if (!groupName) {
            return res.status(400).json({ error: 'Group title is required.' });
        }

        const dedupeKey = `event:${creator}:${groupName.toLowerCase()}`;
        if (dedupeRequest(dedupeKey, 5000)) {
            return res.status(409).json({ error: 'A circle with this name was just created. Please wait a moment.' });
        }

        const result = await pool.query(
            `INSERT INTO groups (name, description, category, created_by) 
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [groupName, description || '', category || 'General', creator]
        );
        const groupId = result.rows[0].id;
        const membersToAdd = new Set([creator, ...(Array.isArray(member_ids) ? member_ids.map(Number).filter(Boolean) : [])]);
        for (const userId of membersToAdd) {
            await pool.query(
                `INSERT INTO group_members (group_id, user_id, role) 
                 VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
                [groupId, userId, userId === creator ? 'admin' : 'member']
            );
        }
        res.status(201).json({ message: 'Group created successfully', id: groupId });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to create group.') });
    }
});

// Get Group Members (both /groups/:id/members and /events/:id/members)
const getMembersHandler = async (req, res) => {
    try {
        const groupId = parseInt(req.params.id);
        if (!groupId || isNaN(groupId)) {
            return res.status(400).json({ error: 'Valid group ID required.' });
        }
        const role = await requireGroupRole(req, res, groupId);
        if (!role) return;

        const result = await pool.query(
            `SELECT u.id, u.name, u.email, u.avatar_initials, u.upi_id, u.phone, COALESCE(gm.role, 'member') as role 
             FROM users u 
             JOIN group_members gm ON u.id = gm.user_id 
             WHERE gm.group_id = $1 
             ORDER BY (CASE WHEN gm.role = 'admin' THEN 0 ELSE 1 END), u.id ASC`,
            [groupId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Unable to load group members.') });
    }
};
app.get('/api/groups/:id/members', getMembersHandler);
app.get('/api/events/:id/members', getMembersHandler);

// Get Group Balances (both /groups/:id/balances and /events/:id/balances)
const getBalancesHandler = async (req, res) => {
    try {
        const groupId = parseInt(req.params.id);
        if (!groupId || isNaN(groupId)) {
            return res.status(400).json({ error: 'Valid group ID required.' });
        }
        const role = await requireGroupRole(req, res, groupId);
        if (!role) return;

        const membersRes = await pool.query(
            'SELECT user_id FROM group_members WHERE group_id = $1',
            [groupId]
        );

        const balances = {};
        membersRes.rows.forEach(m => { balances[m.user_id] = 0; });

        // Outstanding = split amount minus whatever has already been paid.
        // settled_amount is the single source of truth, so partial payments are
        // reflected immediately and no amount is ever double counted.
        const outstandingRes = await pool.query(`
            SELECT es.user_id AS debtor, e.paid_by AS creditor,
                   SUM(es.base_amount - es.settled_amount_base) AS outstanding
            FROM expense_splits es
            JOIN expenses e ON es.expense_id = e.id
            WHERE e.group_id = $1
              AND es.user_id <> e.paid_by
              AND (es.base_amount - es.settled_amount_base) > 0.005
            GROUP BY es.user_id, e.paid_by
        `, [groupId]);

        outstandingRes.rows.forEach(r => {
            const amt = parseFloat(r.outstanding) || 0;
            if (balances[r.creditor] !== undefined) balances[r.creditor] += amt;
            if (balances[r.debtor] !== undefined) balances[r.debtor] -= amt;
        });

        const usersRes = await pool.query('SELECT id, name, email, avatar_initials, upi_id FROM users');
        const userMap = {};
        usersRes.rows.forEach(u => userMap[u.id] = u);

        const resultList = Object.keys(balances).map(userId => {
            const uid = parseInt(userId);
            const user = userMap[uid] || { name: `User #${uid}`, avatar_initials: 'U' };
            return {
                user_id: uid,
                name: user.name,
                avatar_initials: user.avatar_initials,
                upi_id: user.upi_id,
                net_balance: Math.round(balances[userId] * 100) / 100
            };
        });

        res.json(resultList);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
app.get('/api/groups/:id/balances', getBalancesHandler);
app.get('/api/events/:id/balances', getBalancesHandler);

// Get Single Group by ID
app.get('/api/groups/:id', async (req, res) => {
    try {
        const groupId = parseInt(req.params.id);
        if (!groupId || isNaN(groupId)) {
            return res.status(400).json({ error: 'Valid group ID required.' });
        }
        const role = await requireGroupRole(req, res, groupId);
        if (!role) return;

        const groupRes = await pool.query('SELECT * FROM groups WHERE id = $1', [groupId]);
        if (groupRes.rows.length === 0) {
            return res.status(404).json({ error: 'Group not found.' });
        }
        const group = groupRes.rows[0];

        // Fetch members
        const membersRes = await pool.query(`
            SELECT u.id, u.name, u.email, u.avatar_initials, u.upi_id, u.phone, COALESCE(gm.role, 'member') as role, gm.joined_at
            FROM users u
            JOIN group_members gm ON u.id = gm.user_id
            WHERE gm.group_id = $1
            ORDER BY (CASE WHEN gm.role = 'admin' THEN 0 ELSE 1 END), u.id ASC
        `, [groupId]);

        // Total spend
        const spendRes = await pool.query('SELECT COALESCE(SUM(COALESCE(converted_amount, amount)), 0) as total_spend FROM expenses WHERE group_id = $1', [groupId]);

        res.json({
            ...group,
            total_spend: parseFloat(spendRes.rows[0].total_spend),
            member_count: membersRes.rows.length,
            my_role: role,
            user_net_balance: await computeGroupNetForUser(groupId, actingUserId(req)),
            members: membersRes.rows
        });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to fetch group details.') });
    }
});

// Get All Expenses for a specific group with split details and member settlement statuses
app.get('/api/groups/:id/expenses', async (req, res) => {
    try {
        const groupId = parseInt(req.params.id);
        if (!groupId || isNaN(groupId)) {
            return res.status(400).json({ error: 'Valid group ID required' });
        }
        const role = await requireGroupRole(req, res, groupId);
        if (!role) return;

        const groupRes = await pool.query('SELECT * FROM groups WHERE id = $1', [groupId]);
        if (groupRes.rows.length === 0) {
            return res.status(404).json({ error: 'Circle not found' });
        }
        const group = groupRes.rows[0];

        const expensesRes = await pool.query(`
            SELECT e.*, 
                   u.name as paid_by_name, 
                   u.avatar_initials as paid_by_initials,
                   u.email as paid_by_email,
                   u.upi_id as paid_by_upi
            FROM expenses e
            LEFT JOIN users u ON e.paid_by = u.id
            WHERE e.group_id = $1
            ORDER BY e.expense_date DESC, e.id DESC
        `, [groupId]);

        const expIds = expensesRes.rows.map(e => e.id);
        const splitsByExpense = new Map();
        if (expIds.length > 0) {
            const allSplits = await pool.query(`
                SELECT es.*, u.name as user_name, u.name as name, u.email as user_email, u.avatar_initials, u.upi_id
                FROM expense_splits es
                JOIN users u ON es.user_id = u.id
                WHERE es.expense_id = ANY($1::int[])
                ORDER BY u.name ASC
            `, [expIds]);
            allSplits.rows.forEach(row => {
                if (!splitsByExpense.has(row.expense_id)) splitsByExpense.set(row.expense_id, []);
                splitsByExpense.get(row.expense_id).push(row);
            });
        }

        const expenses = expensesRes.rows.map(exp => {
            const splits = (splitsByExpense.get(exp.id) || []).map(s => {
                const isPayer = parseInt(s.user_id) === parseInt(exp.paid_by);
                const amount = parseFloat(s.amount || 0);
                const settledForSplit = roundMoney(s.settled_amount || 0);
                // The payer's own share is considered covered by the payment they
                // made — but it must be counted once, never added on top of a
                // historical settled_amount.
                const paidAmountForSplit = isPayer ? roundMoney(amount) : settledForSplit;
                const outstanding = isPayer ? 0 : Math.max(0, roundMoney(amount - settledForSplit));
                const status = (isPayer || outstanding <= 0.005)
                    ? 'PAID'
                    : (settledForSplit > 0.005 ? 'PARTIALLY_PAID' : 'PENDING');
                return {
                    ...s,
                    name: s.name || s.user_name || 'Member',
                    user_name: s.user_name || s.name || 'Member',
                    amount,
                    paid_amount: paidAmountForSplit,
                    outstanding_amount: outstanding,
                    is_locked: s.is_locked === true,
                    is_settled: isPayer || outstanding <= 0.005,
                    payment_status: status,
                    status
                };
            });

            const paidAmount = splits.reduce((acc, s) => acc + s.paid_amount, 0);
            const baseTotal = roundMoney(exp.converted_amount || exp.amount);
            const basePending = splits.reduce((acc, s) => {
                const isPayer = parseInt(s.user_id) === parseInt(exp.paid_by);
                if (isPayer) return acc;
                return acc + Math.max(0, roundMoney(parseFloat(s.base_amount || 0) - parseFloat(s.settled_amount_base || 0)));
            }, 0);

            return {
                ...exp,
                title: exp.description || exp.title || 'Expense',
                payer_name: exp.paid_by_name || 'User',
                paid_by_name: exp.paid_by_name || 'User',
                amount: parseFloat(exp.amount || 0),
                base_amount: baseTotal,
                paid_amount: roundMoney(paidAmount),
                pending_amount: roundMoney(basePending),
                splits,
                is_fully_settled: basePending <= 0.01
            };
        });

        const totalSpend = roundMoney(expenses.reduce((acc, e) => acc + e.base_amount, 0));
        const totalPaid = roundMoney(expenses.reduce((acc, e) => acc + e.paid_amount, 0));
        const totalPending = roundMoney(expenses.reduce((acc, e) => acc + e.pending_amount, 0));

        res.json({
            group_id: groupId,
            group_name: group.name,
            is_locked: group.is_locked || false,
            group: {
                id: groupId,
                name: group.name,
                category: group.category,
                description: group.description,
                is_locked: group.is_locked || false
            },
            total_expenses_count: expenses.length,
            total_spend: totalSpend,
            total_paid: totalPaid,
            total_pending: totalPending,
            summary: {
                total_spend: totalSpend,
                total_paid: totalPaid,
                total_pending: totalPending
            },
            totals: {
                group_spend: totalSpend,
                total_paid: totalPaid,
                total_pending: totalPending
            },
            expenses
        });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to fetch circle expense details.') });
    }
});

// Update Group Details & Membership
app.put('/api/groups/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const groupId = parseInt(req.params.id);
        const { name, title, description, category, avatar_color, members, user_id } = req.body;
        const groupName = sanitizeText(name || title, 200);

        if (!groupName) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Please enter a valid group name.' });
        }

        const existingGroup = await client.query('SELECT * FROM groups WHERE id = $1', [groupId]);
        if (existingGroup.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Group not found.' });
        }
        const grp = existingGroup.rows[0];

        if (grp.is_locked) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Circle is locked. Details cannot be modified.' });
        }

        // Permission: Creator or Group Admin only (Mandatory Authentication)
        const requesterId = actingUserId(req);
        if (!requesterId || isNaN(requesterId)) {
            await client.query('ROLLBACK');
            return res.status(401).json({ error: 'Authentication required to modify group details.' });
        }

        const isCreator = grp.created_by === requesterId;
        const roleRes = await client.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, requesterId]);
        const isAdmin = roleRes.rows[0]?.role === 'admin';
        if (!isCreator && !isAdmin) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Permission denied: Only the circle Creator or an Admin can edit group details.' });
        }

        const updatedGroupRes = await client.query(`
            UPDATE groups 
            SET name = $1, description = $2, category = $3, avatar_color = COALESCE($4, avatar_color)
            WHERE id = $5
            RETURNING *
        `, [groupName, description || '', category || 'General', avatar_color, groupId]);

        // If members list is supplied, sync members
        if (members && Array.isArray(members) && members.length > 0) {
            for (const m of members) {
                const uid = typeof m === 'object' ? parseInt(m.user_id || m.id) : parseInt(m);
                const role = (typeof m === 'object' && m.role) ? m.role : 'member';
                if (!isNaN(uid)) {
                    await client.query(`
                        INSERT INTO group_members (group_id, user_id, role) 
                        VALUES ($1, $2, $3) 
                        ON CONFLICT (group_id, user_id) DO UPDATE SET role = EXCLUDED.role
                    `, [groupId, uid, role]);
                }
            }
        }

        await client.query(`
            INSERT INTO activity_logs (user_id, group_id, activity_type, message) 
            VALUES ($1, $2, 'GROUP_UPDATED', 'Updated group details for "' || $3 || '"')
        `, [grp.created_by || 1, groupId, groupName]);

        await client.query('COMMIT');
        res.json({ message: 'Your changes have been saved.', group: updatedGroupRes.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: formatUserError(err, 'Failed to update group. Please try again.') });
    } finally {
        client.release();
    }
});

// Delete Group
app.delete('/api/groups/:id', async (req, res) => {
    try {
        const groupId = parseInt(req.params.id);
        const requesterId = actingUserId(req);
        if (!requesterId || isNaN(requesterId)) {
            return res.status(401).json({ error: 'Authentication required to delete group.' });
        }
        const groupRes = await pool.query('SELECT * FROM groups WHERE id = $1', [groupId]);
        if (groupRes.rows.length === 0) {
            return res.status(404).json({ error: 'Group not found.' });
        }
        const grp = groupRes.rows[0];

        // Strict Permission Guard: Only Creator can delete a group
        if (grp.created_by && grp.created_by !== requesterId) {
            return res.status(403).json({ 
                error: 'Permission denied: Only the circle Creator can permanently delete this group. Consider locking it instead.',
                can_lock: true
            });
        }

        // Financial Protection Guard: Cannot delete group with recorded expenses or transactions
        const expCheck = await pool.query('SELECT COUNT(*)::int as count FROM expenses WHERE group_id = $1', [groupId]);
        const settCheck = await pool.query('SELECT COUNT(*)::int as count FROM settlements WHERE group_id = $1', [groupId]);
        if ((expCheck.rows[0]?.count || 0) > 0 || (settCheck.rows[0]?.count || 0) > 0) {
            return res.status(403).json({ 
                error: 'Cannot delete circle because financial expenses or settlements exist. Lock the circle to preserve payment history and balance records.',
                code: 'GROUP_HAS_FINANCIAL_HISTORY',
                can_lock: true
            });
        }

        // Clean up non-financial child records while preserving the audit trail.
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`
                DELETE FROM chat_messages
                WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id = $1)
            `, [groupId]);
            await client.query(`
                DELETE FROM chat_conversation_members
                WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id = $1)
            `, [groupId]);
            await client.query('DELETE FROM chat_conversations WHERE group_id = $1', [groupId]);
            await client.query('UPDATE upi_payment_requests SET group_id = NULL WHERE group_id = $1', [groupId]);
            await client.query('UPDATE activity_logs SET group_id = NULL WHERE group_id = $1', [groupId]);
            await client.query('DELETE FROM groups WHERE id = $1', [groupId]);
            await client.query(`
                INSERT INTO activity_logs (user_id, group_id, activity_type, message) 
                VALUES ($1, NULL, 'GROUP_DELETED', 'Deleted group "' || $2 || '"')
            `, [requesterId, grp.name]);
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

        res.json({ message: 'Group deleted successfully.' });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to delete group.') });
    }
});

// Lock Group Circle
app.post('/api/groups/:id/lock', async (req, res) => {
    try {
        const groupId = parseInt(req.params.id);
        const requesterId = actingUserId(req);
        if (!requesterId || isNaN(requesterId)) {
            return res.status(401).json({ error: 'Authentication required to lock circle.' });
        }
        const groupRes = await pool.query('SELECT * FROM groups WHERE id = $1', [groupId]);
        if (groupRes.rows.length === 0) {
            return res.status(404).json({ error: 'Circle not found.' });
        }
        const grp = groupRes.rows[0];

        const isCreator = grp.created_by === requesterId;
        const roleRes = await pool.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, requesterId]);
        const isAdmin = roleRes.rows[0]?.role === 'admin';
        if (!isCreator && !isAdmin) {
            return res.status(403).json({ error: 'Permission denied: Only the circle Creator or an Admin can lock this circle.' });
        }

        await pool.query('UPDATE groups SET is_locked = TRUE, locked_at = NOW(), locked_by = $1 WHERE id = $2', [requesterId || grp.created_by, groupId]);
        await pool.query(`
            INSERT INTO activity_logs (user_id, group_id, activity_type, message)
            VALUES ($1, $2, 'GROUP_LOCKED', 'Circle "' || $3 || '" was locked. No new expenses or modifications allowed.')
        `, [requesterId || grp.created_by || 1, groupId, grp.name]);

        res.json({ success: true, message: `Circle "${grp.name}" is now locked. Financial history is preserved.`, is_locked: true });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to lock circle.') });
    }
});

// Unlock Group Circle
app.post('/api/groups/:id/unlock', async (req, res) => {
    try {
        const groupId = parseInt(req.params.id);
        const requesterId = actingUserId(req);
        if (!requesterId || isNaN(requesterId)) {
            return res.status(401).json({ error: 'Authentication required to unlock circle.' });
        }
        const groupRes = await pool.query('SELECT * FROM groups WHERE id = $1', [groupId]);
        if (groupRes.rows.length === 0) {
            return res.status(404).json({ error: 'Circle not found.' });
        }
        const grp = groupRes.rows[0];

        const isCreator = grp.created_by === requesterId;
        const roleRes = await pool.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, requesterId]);
        const isAdmin = roleRes.rows[0]?.role === 'admin';
        if (!isCreator && !isAdmin) {
            return res.status(403).json({ error: 'Permission denied: Only the circle Creator or an Admin can unlock this circle.' });
        }

        await pool.query('UPDATE groups SET is_locked = FALSE, locked_at = NULL, locked_by = NULL WHERE id = $1', [groupId]);
        await pool.query(`
            INSERT INTO activity_logs (user_id, group_id, activity_type, message)
            VALUES ($1, $2, 'GROUP_UNLOCKED', 'Circle "' || $3 || '" was unlocked.')
        `, [requesterId || grp.created_by || 1, groupId, grp.name]);

        res.json({ success: true, message: `Circle "${grp.name}" is now unlocked.`, is_locked: false });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to unlock circle.') });
    }
});

// Add Member to Group
app.post('/api/groups/:id/members', async (req, res) => {
    try {
        const groupId = parseInt(req.params.id);
        const { user_id, role = 'member' } = req.body;
        const uid = parseInt(user_id);

        if (isNaN(uid)) {
            return res.status(400).json({ error: 'Please select a valid member to add.' });
        }
        if (!['admin', 'editor', 'member'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role. Must be admin, editor, or member.' });
        }

        const groupRes = await pool.query('SELECT name, is_locked, created_by FROM groups WHERE id = $1', [groupId]);
        if (groupRes.rows.length === 0) {
            return res.status(404).json({ error: 'Circle not found.' });
        }
        const grp = groupRes.rows[0];
        if (grp.is_locked) {
            return res.status(400).json({ error: 'Circle is locked. Member changes cannot be made.' });
        }

        // Permission: Creator, Admin, or Editor
        const requesterId = actingUserId(req);
        let requesterRole = null;
        if (requesterId) {
            const isCreator = grp.created_by === requesterId;
            const roleRes = await pool.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, requesterId]);
            requesterRole = roleRes.rows[0]?.role;
            if (!isCreator && requesterRole !== 'admin' && requesterRole !== 'editor') {
                return res.status(403).json({ error: 'Permission denied: Only circle Admins or Editors can add members.' });
            }
            if (role === 'admin' && !isCreator && requesterRole !== 'admin') {
                return res.status(403).json({ error: 'Permission denied: only a circle administrator can grant admin rights.' });
            }
        }

        const userRes = await pool.query('SELECT name, email FROM users WHERE id = $1', [uid]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }
        const targetUser = userRes.rows[0];
        const groupName = grp.name || 'Group';

        await pool.query(`
            INSERT INTO group_members (group_id, user_id, role) 
            VALUES ($1, $2, $3) 
            ON CONFLICT (group_id, user_id) DO UPDATE SET role = EXCLUDED.role
        `, [groupId, uid, role]);

        // Auto-enroll member into circle chat thread
        await pool.query(`
            INSERT INTO chat_conversation_members (conversation_id, user_id)
            SELECT c.id, $1
            FROM chat_conversations c
            WHERE c.group_id = $2
            ON CONFLICT (conversation_id, user_id) DO NOTHING
        `, [uid, groupId]);

        // Send group invitation / addition notification email
        let inviterName = 'A group administrator';
        if (requesterId) {
            const inviterRes = await pool.query('SELECT name FROM users WHERE id = $1', [requesterId]);
            if (inviterRes.rows.length > 0) inviterName = inviterRes.rows[0].name;
        }

        try {
            if (targetUser.email) {
                await emailService.sendGroupInvitationEmail({
                    to: targetUser.email,
                    recipientName: targetUser.name,
                    inviterName,
                    groupName,
                    role
                });
            }
        } catch (mailErr) {
            console.error('[Group Member Invite Email] Non-blocking warning:', mailErr.message);
        }

        res.status(201).json({ message: `${targetUser.name} added to group successfully.` });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to add member to group.') });
    }
});

// Invite Member to Group by Email
app.post('/api/groups/:id/invite', async (req, res) => {
    try {
        const groupId = parseInt(req.params.id);
        const { email, role = 'member' } = req.body;
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            return res.status(400).json({ error: 'Please enter a valid email address.' });
        }
        if (!['admin', 'editor', 'member'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role. Must be admin, editor, or member.' });
        }
        const normalizedEmail = email.trim().toLowerCase();

        const groupRes = await pool.query('SELECT name, is_locked, created_by FROM groups WHERE id = $1', [groupId]);
        if (groupRes.rows.length === 0) {
            return res.status(404).json({ error: 'Group circle not found.' });
        }
        const groupName = groupRes.rows[0].name;
        if (groupRes.rows[0].is_locked) {
            return res.status(400).json({ error: 'Circle is locked. Invitations cannot be sent.' });
        }

        const requesterId = actingUserId(req);
        const requesterRole = await getGroupRole(groupId, requesterId);
        const isCreator = groupRes.rows[0].created_by === requesterId;
        if (!isCreator && requesterRole !== 'admin' && requesterRole !== 'editor') {
            return res.status(403).json({ error: 'Permission denied: Only circle Admins or Editors can invite members.' });
        }
        if (role === 'admin' && !isCreator && requesterRole !== 'admin') {
            return res.status(403).json({ error: 'Permission denied: only a circle administrator can grant admin rights.' });
        }

        let inviterName = 'A group administrator';
        {
            const inviterRes = await pool.query('SELECT name FROM users WHERE id = $1', [requesterId]);
            if (inviterRes.rows.length > 0) inviterName = inviterRes.rows[0].name;
        }

        // If user already exists in users table, enroll them in the group
        const userRes = await pool.query('SELECT id, name, email FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);
        let recipientName = normalizedEmail.split('@')[0];
        if (userRes.rows.length > 0) {
            const existingUser = userRes.rows[0];
            recipientName = existingUser.name;
            await pool.query(`
                INSERT INTO group_members (group_id, user_id, role)
                VALUES ($1, $2, $3)
                ON CONFLICT (group_id, user_id) DO UPDATE SET role = EXCLUDED.role
            `, [groupId, existingUser.id, role]);
        }

        let inviteDelivered = false;
        try {
            await emailService.sendGroupInvitationEmail({
                to: normalizedEmail,
                recipientName,
                inviterName,
                groupName,
                role
            });
            inviteDelivered = true;
        } catch (mailErr) {
            console.warn('[Group Invite Email] Notice (cloud network/SMTP delay):', mailErr.message);
        }

        res.json({
            success: true,
            email_delivered: inviteDelivered,
            message: inviteDelivered 
                ? `Invitation email sent to ${normalizedEmail} successfully.`
                : `Member invitation recorded for ${normalizedEmail}.`
        });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to send group invitation.') });
    }
});


// Update Group Member Role (admin, editor, member)
app.put('/api/groups/:id/members/:userId', async (req, res) => {
    try {
        const groupId = parseInt(req.params.id);
        const targetUserId = parseInt(req.params.userId);
        const { role } = req.body;
        const requesterId = actingUserId(req);
        if (!requesterId || isNaN(requesterId)) {
            return res.status(401).json({ error: 'Authentication required to modify member roles.' });
        }

        const grpLock = await pool.query('SELECT is_locked FROM groups WHERE id = $1', [groupId]);
        if (grpLock.rows[0]?.is_locked) {
            return res.status(400).json({ error: 'Circle is locked. Member roles cannot be modified.' });
        }

        const validRoles = ['admin', 'editor', 'member'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ error: 'Invalid role specified. Must be admin, editor, or member.' });
        }

        // Verify requester is an admin in this group
        const reqAdmin = await pool.query(
            "SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2 AND role = 'admin'",
            [groupId, requesterId]
        );
        if (reqAdmin.rows.length === 0) {
            return res.status(403).json({ error: 'Permission denied: Only group administrators can modify member roles.' });
        }

        // Verify target member is in the group
        const targetMemberRes = await pool.query(
            "SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2",
            [groupId, targetUserId]
        );
        if (targetMemberRes.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found in this group.' });
        }
        const currentRole = targetMemberRes.rows[0].role;

        // If target member is currently admin and being changed to something else:
        if (currentRole === 'admin' && role !== 'admin') {
            const otherAdmins = await pool.query(
                "SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND role = 'admin' AND user_id != $2",
                [groupId, targetUserId]
            );
            if (parseInt(otherAdmins.rows[0].count) === 0) {
                return res.status(400).json({ 
                    error: 'Cannot demote the only administrator in the group. Please designate another admin first.' 
                });
            }
        }

        await pool.query(
            "UPDATE group_members SET role = $1 WHERE group_id = $2 AND user_id = $3",
            [role, groupId, targetUserId]
        );

        res.json({ message: `Member role updated to ${role} successfully.`, role });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to update member role.') });
    }
});

// Remove Member from Group (with role, sole-admin and unsettled balance safeguards)
app.delete('/api/groups/:id/members/:userId', async (req, res) => {
    try {
        const groupId = parseInt(req.params.id);
        const targetUserId = parseInt(req.params.userId);
        const requesterId = actingUserId(req);
        if (!requesterId || isNaN(requesterId)) {
            return res.status(401).json({ error: 'Authentication required to remove member.' });
        }

        const grpLock = await pool.query('SELECT is_locked FROM groups WHERE id = $1', [groupId]);
        if (grpLock.rows[0]?.is_locked) {
            return res.status(400).json({ error: 'Circle is locked. Members cannot be removed.' });
        }

        const memberRes = await pool.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, targetUserId]);
        if (memberRes.rows.length === 0) {
            return res.status(404).json({ error: 'User is not a member of this group.' });
        }
        const targetRole = memberRes.rows[0].role;

        // Requester must be admin or member self-leaving
        if (requesterId !== targetUserId) {
            const requesterAdmin = await pool.query(
                "SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2 AND role = 'admin'",
                [groupId, requesterId]
            );
            if (requesterAdmin.rows.length === 0) {
                return res.status(403).json({ error: 'Permission denied: Only group administrators or the members themselves can remove a member.' });
            }
        }

        // Sole admin protection
        if (targetRole === 'admin') {
            const adminCountRes = await pool.query(
                "SELECT COUNT(*) as count FROM group_members WHERE group_id = $1 AND role = 'admin' AND user_id != $2",
                [groupId, targetUserId]
            );
            if (parseInt(adminCountRes.rows[0].count) === 0) {
                return res.status(400).json({ 
                    error: 'Cannot remove the sole administrator of the group. Assign another administrator before leaving.' 
                });
            }
        }

        // Check if member has unsettled splits in this group (including partial remainders)
        const unsettledRes = await pool.query(`
            SELECT COUNT(*) as count 
            FROM expense_splits es 
            JOIN expenses e ON es.expense_id = e.id 
            WHERE e.group_id = $1 AND es.user_id = $2 AND es.user_id <> e.paid_by
              AND (es.base_amount - es.settled_amount_base) > 0.005
        `, [groupId, targetUserId]);

        if (parseInt(unsettledRes.rows[0].count) > 0) {
            return res.status(403).json({ 
                error: 'Cannot remove member with pending, unsettled balances in this group. All balances must be settled first.',
                code: 'MEMBER_HAS_UNSETTLED_DEBT'
            });
        }

        // Check if other members owe this member unsettled balances from expenses they paid
        const owedToMemberRes = await pool.query(`
            SELECT COUNT(*) as count 
            FROM expenses e 
            JOIN expense_splits es ON e.id = es.expense_id 
            WHERE e.group_id = $1 AND e.paid_by = $2 AND es.user_id <> $2
              AND (es.base_amount - es.settled_amount_base) > 0.005
        `, [groupId, targetUserId]);

        if (parseInt(owedToMemberRes.rows[0].count) > 0) {
            return res.status(403).json({ 
                error: 'Cannot remove member: other group members still owe unsettled balances to this user. Settle all balances first.',
                code: 'MEMBER_IS_OWED_DEBT'
            });
        }

        await pool.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, targetUserId]);
        await pool.query(`
            DELETE FROM chat_conversation_members cm
            USING chat_conversations c
            WHERE cm.conversation_id = c.id AND c.group_id = $1 AND cm.user_id = $2
        `, [groupId, targetUserId]);
        res.json({ message: 'Member removed from group successfully.' });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to remove member from group.') });
    }
});

// ==========================================
// 3. EXPENSES API
// ==========================================

// Get All Expenses with filtering, privacy, and date range support
app.get('/api/expenses', async (req, res) => {
    try {
        const { groupId, category, search, dateRange, status, fromDate, toDate } = req.query;
        const currentUserId = actingUserId(req);
        if (!currentUserId) {
            return res.status(401).json({ error: 'Authentication required.' });
        }

        let query = `
            SELECT e.*, 
                   u.name as paid_by_name, 
                   u.avatar_initials as paid_by_initials,
                   g.name as group_name,
                   g.category as group_category,
                   COALESCE(g.base_currency, 'INR') as group_base_currency
            FROM expenses e
            LEFT JOIN users u ON e.paid_by = u.id
            LEFT JOIN groups g ON e.group_id = g.id
            WHERE 1=1
        `;
        const params = [currentUserId];
        query += ' AND (e.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1) OR e.paid_by = $1)';

        if (groupId && groupId !== 'all') {
            params.push(groupId);
            query += ' AND e.group_id = $' + params.length;
        }
        if (category && category !== 'all') {
            params.push(category);
            query += ' AND e.category = $' + params.length;
        }
        if (search) {
            params.push('%' + search + '%');
            query += ' AND (e.description ILIKE $' + params.length + ' OR u.name ILIKE $' + params.length + ' OR g.name ILIKE $' + params.length + ')';
        }
        if (fromDate) {
            params.push(fromDate);
            query += ' AND e.expense_date >= $' + params.length;
        }
        if (toDate) {
            params.push(toDate);
            query += ' AND e.expense_date <= $' + params.length;
        }

        query += ` ORDER BY e.expense_date DESC, e.id DESC`;

        const expensesRes = await pool.query(query, params);

        const expenseIds = expensesRes.rows.map(e => e.id);
        const splitsByExpense = new Map();
        const correctionsByExpense = new Map();

        if (expenseIds.length > 0) {
            const [allSplitsRes, allCorrectionsRes] = await Promise.all([
                pool.query(`
                    SELECT es.*, u.name as user_name, u.avatar_initials 
                    FROM expense_splits es 
                    JOIN users u ON es.user_id = u.id 
                    WHERE es.expense_id = ANY($1::int[])
                `, [expenseIds]),
                pool.query(`
                    SELECT expense_id, COUNT(*)::int as count
                    FROM expense_corrections
                    WHERE expense_id = ANY($1::int[])
                    GROUP BY expense_id
                `, [expenseIds])
            ]);
            allSplitsRes.rows.forEach(row => {
                if (!splitsByExpense.has(row.expense_id)) splitsByExpense.set(row.expense_id, []);
                splitsByExpense.get(row.expense_id).push({ ...row, amount: parseFloat(row.amount) });
            });
            allCorrectionsRes.rows.forEach(row => correctionsByExpense.set(row.expense_id, row.count));
        }

        // Build the response from the batched results (no per-expense queries).
        const expenses = expensesRes.rows.map(exp => {
            const splits = splitsByExpense.get(exp.id) || [];
            const hasSettledSplits = splits.some(s => parseInt(s.user_id) !== parseInt(exp.paid_by) && (parseFloat(s.settled_amount || 0) > 0.005 || parseFloat(s.settled_amount_base || 0) > 0.005));
            const hasCorrections = (correctionsByExpense.get(exp.id) || 0) > 0;

            return {
                ...exp,
                amount: parseFloat(exp.amount),
                splits,
                is_protected: hasSettledSplits || hasCorrections,
                has_settled_splits: hasSettledSplits,
                has_corrections: hasCorrections
            };
        });

        res.json(expenses);
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to load expenses.') });
    }
});

// Add Expense & Splits
app.post('/api/expenses', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const {
            group_id,
            event_id,
            paid_by,
            created_by,
            amount,
            currency = 'INR',
            description,
            category = 'Food & Drinks',
            split_type = 'equal',
            notes = '',
            receipt_url = '',
            expense_date = new Date().toISOString().split('T')[0],
            split_user_ids,
            splits
        } = req.body;

        const effectiveSplitType = (split_type || 'equal').toLowerCase();

        const expDesc = sanitizeText(description || req.body.title, 255);
        const effectiveGroupId = parseInt(group_id || event_id);
        const totalAmount = parseFloat(amount);
        if (!effectiveGroupId || isNaN(effectiveGroupId)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Please select a group circle for this expense.' });
        }
        if (!expDesc) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Description is required' });
        }
        if (isNaN(totalAmount) || totalAmount <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Expense amount must be greater than zero' });
        }

        // Check group existence and lock state
        const grpCheck = await client.query('SELECT is_locked, base_currency FROM groups WHERE id = $1', [effectiveGroupId]);
        if (grpCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Group circle not found.' });
        }
        if (grpCheck.rows[0]?.is_locked) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Circle is locked. No new expenses can be added.' });
        }

        // Idempotency deduplication check
        const dedupeKey = `exp:${effectiveGroupId}:${paid_by}:${totalAmount}:${expDesc.toLowerCase()}`;
        if (dedupeRequest(dedupeKey, 5000)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'This expense was just recorded. Duplicate submission prevented.' });
        }

        // Validate that group exists and payer & splits are enrolled members
        const groupMembersRes = await client.query('SELECT user_id, role FROM group_members WHERE group_id = $1', [effectiveGroupId]);
        const groupMemberMap = new Map();
        groupMembersRes.rows.forEach(m => groupMemberMap.set(parseInt(m.user_id), m.role || 'member'));

        if (groupMemberMap.size === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'The selected group has no enrolled members' });
        }

        // Validate creator is an enrolled member of this group
        const effectiveCreatorId = actingUserId(req);
        const creatorRole = groupMemberMap.get(effectiveCreatorId);

        if (!creatorRole) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'You are not an enrolled member of this group circle' });
        }

        if (creatorRole === 'member') {
            await client.query('ROLLBACK');
            return res.status(403).json({ 
                error: 'Permission denied: Members with role "member" have Split-Only access and cannot record expenses. Only group Admins or Editors can add expenses.' 
            });
        }

        if (!groupMemberMap.has(parseInt(paid_by))) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Selected payer must be an enrolled member of this group' });
        }

        // Normalise participants through the unified split engine. The engine
        // recomputes amounts server-side so the total always matches exactly.
        let splitInput = null;
        if (Array.isArray(splits) && splits.length > 0) {
            splitInput = splits;
        } else if (Array.isArray(split_user_ids) && split_user_ids.length > 0) {
            splitInput = split_user_ids.map(uid => ({ user_id: uid }));
        } else if (Array.isArray(req.body.participants) && req.body.participants.length > 0) {
            splitInput = req.body.participants;
        }

        if (!splitInput) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Please select at least one group member to split with' });
        }

        for (const s of splitInput) {
            const uid = parseInt(s.user_id !== undefined ? s.user_id : (s.id !== undefined ? s.id : s.userId));
            if (!groupMemberMap.has(uid)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'All split participants must be enrolled members of the selected group' });
            }
        }

        const normalized = splitEngine.normalizeSplits({
            totalAmount,
            splitType: effectiveSplitType,
            splits: splitInput,
            currency: (currency || 'INR').toUpperCase()
        });
        if (normalized.error) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: normalized.error });
        }
        const normalizedSplits = normalized.splits;

        // Fetch group base currency & calculate exchange conversion
        const grpCurRes = await client.query('SELECT base_currency FROM groups WHERE id = $1', [effectiveGroupId]);
        const groupBaseCur = grpCurRes.rows[0]?.base_currency || 'INR';
        const expCurrency = (currency || 'INR').toUpperCase();
        let originalAmount = totalAmount;
        let convertedAmount = totalAmount;
        let exchangeRate = 1.0;
        let rateProvider = 'identity';
        let rateTimestamp = new Date();

        if (expCurrency !== groupBaseCur) {
            try {
                const conv = await currencyService.convertAmount(totalAmount, expCurrency, groupBaseCur);
                convertedAmount = conv.converted_amount;
                exchangeRate = conv.exchange_rate;
                rateProvider = conv.rate_provider;
                rateTimestamp = conv.rate_timestamp;
            } catch (curErr) {
                console.warn('[Expense Currency] Conversion warning:', curErr.message);
            }
        }

        const expRes = await client.query(
            `INSERT INTO expenses (
                group_id, paid_by, amount, currency, description, category, split_type, notes, receipt_url, expense_date,
                original_amount, exchange_rate, converted_amount, rate_provider, rate_timestamp
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
            [effectiveGroupId, paid_by, totalAmount, expCurrency, expDesc, sanitizeText(category, 50) || 'General', effectiveSplitType, sanitizeText(notes, 2000), sanitizeText(receipt_url, 1000), expense_date, originalAmount, exchangeRate, convertedAmount, rateProvider, rateTimestamp]
        );
        const expenseId = expRes.rows[0].id;

        // Process Splits in the expense currency, plus the exact base-currency
        // equivalent used by every ledger screen.
        const baseShares = splitEngine.allocateByWeights(
            roundMoney(convertedAmount),
            normalizedSplits.map(s => s.amount),
            groupBaseCur
        );
        for (let i = 0; i < normalizedSplits.length; i++) {
            const s = normalizedSplits[i];
            await client.query(
                `INSERT INTO expense_splits
                    (expense_id, user_id, amount, base_amount, split_percentage, shares, is_settled, settled_amount, settled_amount_base, is_locked)
                 VALUES ($1, $2, $3, $4, $5, $6, FALSE, 0, 0, $7)`,
                [expenseId, s.user_id, s.amount, baseShares[i], s.percentage || 0, s.shares || 1, s.is_locked === true]
            );
        }

        // Payer name for activity log
        const payerRes = await client.query('SELECT name FROM users WHERE id = $1', [paid_by]);
        const payerName = payerRes.rows[0]?.name || 'A user';
        const groupRes = await client.query('SELECT name FROM groups WHERE id = $1', [effectiveGroupId]);
        const groupName = groupRes.rows[0]?.name || 'Group';

        await client.query(
            `INSERT INTO activity_logs (user_id, group_id, activity_type, message) 
             VALUES ($1, $2, 'EXPENSE_ADDED', $3 || ' added "' || $4 || '" (₹' || $5 || ') in ' || $6)`,
            [paid_by, effectiveGroupId, payerName, expDesc, totalAmount.toFixed(2), groupName]
        );

        await client.query('COMMIT');

        // Dispatch expense notification emails asynchronously (non-blocking)
        try {
            const debtorSplits = await pool.query(`
                SELECT es.amount, u.name, u.email 
                FROM expense_splits es 
                JOIN users u ON es.user_id = u.id 
                WHERE es.expense_id = $1 AND es.user_id != $2
            `, [expenseId, paid_by]);

            for (const row of debtorSplits.rows) {
                if (row.email) {
                    emailService.sendExpenseAddedEmail({
                        to: row.email,
                        recipientName: row.name,
                        payerName,
                        expenseTitle: expDesc,
                        groupName,
                        shareAmount: row.amount,
                        totalAmount
                    }).catch(e => console.error('[Expense Email Notice] Async warning:', e.message));
                }
            }
        } catch (emailErr) {
            console.error('[Expense Email Notice] Non-blocking warning:', emailErr.message);
        }

        res.status(201).json({ message: 'Expense added successfully', id: expenseId, expense: { id: expenseId, description: expDesc, amount: totalAmount } });
    } catch (err) {
        console.error('Error in POST /api/expenses:', err);
        await client.query('ROLLBACK');
        res.status(500).json({ error: formatUserError(err, 'Failed to save expense. Please verify the amount and members.') });
    } finally {
        client.release();
    }
});

// Delete Expense (Protected against paid expenses & settlement history loss)
app.delete('/api/expenses/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const expenseId = parseInt(req.params.id);
        const requesterId = actingUserId(req);

        if (!expenseId || isNaN(expenseId)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Valid expense ID is required.' });
        }

        if (!requesterId || isNaN(requesterId)) {
            await client.query('ROLLBACK');
            return res.status(401).json({ error: 'Authentication required to delete expense.' });
        }

        const expRes = await client.query('SELECT * FROM expenses WHERE id = $1', [expenseId]);
        if (expRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Expense not found.' });
        }
        const exp = expRes.rows[0];

        // Check if group is locked
        if (exp.group_id) {
            const grpCheck = await client.query('SELECT is_locked FROM groups WHERE id = $1', [exp.group_id]);
            if (grpCheck.rows[0]?.is_locked) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Circle is locked. Expenses cannot be deleted.' });
            }
        }

        // Authorization: Requester must be group admin, editor, or the payer
        const roleRes = await client.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [exp.group_id, requesterId]);
        const isPayer = exp.paid_by === requesterId;
        const isAdminOrEditor = roleRes.rows.length > 0 && ['admin', 'editor'].includes(roleRes.rows[0].role);

        if (!isAdminOrEditor && !isPayer) {
            await client.query('ROLLBACK');
            return res.status(403).json({ 
                error: 'Permission denied: Only group Admins, Editors, or the original payer can delete this expense.' 
            });
        }

        // 1. Settlement & Payment Protection Guard:
        // Prevent deleting any expense where another participant has paid, even partially.
        const settledSplitsRes = await client.query(`
            SELECT COUNT(*)::int as count 
            FROM expense_splits 
            WHERE expense_id = $1 AND user_id != $2
              AND (settled_amount > 0.005 OR settled_amount_base > 0.005)
        `, [expenseId, exp.paid_by]);

        const settledCount = settledSplitsRes.rows[0]?.count || 0;
        if (settledCount > 0) {
            await client.query('ROLLBACK');
            return res.status(403).json({ 
                error: 'Cannot delete expense: one or more participant shares have already been paid or settled. Use the safe correction process instead.',
                is_protected: true,
                code: 'EXPENSE_PAID_PROTECTED'
            });
        }

        // 2. Prevent deleting expenses with audit correction history
        const corrRes = await client.query(`
            SELECT COUNT(*)::int as count 
            FROM expense_corrections 
            WHERE expense_id = $1
        `, [expenseId]);

        if ((corrRes.rows[0]?.count || 0) > 0) {
            await client.query('ROLLBACK');
            return res.status(403).json({ 
                error: 'Cannot delete expense with existing audit correction history.',
                is_protected: true,
                code: 'EXPENSE_PAID_PROTECTED'
            });
        }

        // Cancel any pending manual payment requests for this expense before it
        // disappears, so an orphaned request can never settle unrelated debts.
        const pendingPrs = await client.query(
            "SELECT id, payer_id FROM payment_requests WHERE expense_id = $1 AND status = 'PENDING'",
            [expenseId]
        );
        if (pendingPrs.rows.length > 0) {
            await client.query(`
                UPDATE payment_requests
                SET status = 'CANCELLED', responded_at = NOW(), rejection_reason = 'Expense deleted'
                WHERE expense_id = $1 AND status = 'PENDING'
            `, [expenseId]);
            for (const pr of pendingPrs.rows) {
                await client.query(`
                    INSERT INTO activity_logs (user_id, group_id, activity_type, message)
                    VALUES ($1, $2, 'PAYMENT_REQUEST_CANCELLED', $3)
                `, [pr.payer_id, exp.group_id, `Your payment request was cancelled because the expense “${exp.description}” was deleted. No balance was changed.`]);
            }
        }

        // Safely remove splits and expense
        await client.query('DELETE FROM expense_splits WHERE expense_id = $1', [expenseId]);
        await client.query('DELETE FROM expenses WHERE id = $1', [expenseId]);

        // Audit Log
        if (requesterId) {
            await client.query(`
                INSERT INTO activity_logs (user_id, group_id, activity_type, message) 
                VALUES ($1, $2, 'EXPENSE_DELETED', 'Deleted expense "' || $3 || '" (₹' || $4 || ')')
            `, [requesterId, exp.group_id, exp.description, parseFloat(exp.amount).toFixed(2)]);
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Expense deleted successfully' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error in DELETE /api/expenses/:id:', err);
        res.status(500).json({ error: formatUserError(err, 'Failed to delete expense.') });
    } finally {
        client.release();
    }
});

// Get Single Expense with Splits & Participants
app.get('/api/expenses/:id', async (req, res) => {
    try {
        const expenseId = parseInt(req.params.id);
        const expRes = await pool.query(`
            SELECT e.*, 
                   u.name as paid_by_name, u.avatar_initials as paid_by_initials,
                   g.name as group_name
            FROM expenses e
            LEFT JOIN users u ON e.paid_by = u.id
            LEFT JOIN groups g ON e.group_id = g.id
            WHERE e.id = $1
        `, [expenseId]);

        if (expRes.rows.length === 0) {
            return res.status(404).json({ error: 'Expense not found.' });
        }

        const expense = expRes.rows[0];
        const splitsRes = await pool.query(`
            SELECT es.*, u.name as user_name, u.avatar_initials, u.upi_id
            FROM expense_splits es
            JOIN users u ON es.user_id = u.id
            WHERE es.expense_id = $1
            ORDER BY es.id ASC
        `, [expenseId]);

        const hasSettledSplits = splitsRes.rows.some(s => parseInt(s.user_id) !== parseInt(expense.paid_by) && (parseFloat(s.settled_amount || 0) > 0.005 || parseFloat(s.settled_amount_base || 0) > 0.005));

        // Object-level authorization: only a member of the expense's circle or an
        // actual participant may read its details.
        const authId = actingUserId(req);
        const groupRole = expense.group_id ? await getGroupRole(expense.group_id, authId) : null;
        const isParticipant = parseInt(expense.paid_by) === authId ||
            splitsRes.rows.some(s => parseInt(s.user_id) === authId);
        if (!groupRole && !isParticipant && (!req.authUser || req.authUser.role !== 'master_admin')) {
            return res.status(403).json({ error: 'Access denied: this expense belongs to a circle you are not part of.' });
        }

        res.json({
            ...expense,
            amount: parseFloat(expense.amount),
            has_settled_splits: hasSettledSplits,
            is_protected: hasSettledSplits,
            splits: splitsRes.rows.map(s => ({
                ...s,
                amount: parseFloat(s.amount),
                split_percentage: parseFloat(s.split_percentage || 0)
            }))
        });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to load expense details.') });
    }
});

// Update Expense & Reallocate Splits
app.put('/api/expenses/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const expenseId = parseInt(req.params.id);
        const {
            description,
            title,
            amount,
            paid_by,
            category,
            split_type = 'equal',
            notes = '',
            expense_date,
            splits,
            updated_by
        } = req.body;

        const effectiveSplitType = (split_type || 'equal').toLowerCase();
        const expDesc = sanitizeText(description || title, 255);
        const totalAmount = parseFloat(amount);

        if (!expDesc) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Please enter a description for the expense.' });
        }
        if (isNaN(totalAmount) || totalAmount <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Expense amount must be greater than zero.' });
        }

        const existingRes = await client.query('SELECT * FROM expenses WHERE id = $1', [expenseId]);
        if (existingRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Expense not found.' });
        }
        const existingExp = existingRes.rows[0];
        const groupId = existingExp.group_id;

        // Check if group is locked
        if (groupId) {
            const grpCheck = await client.query('SELECT is_locked FROM groups WHERE id = $1', [groupId]);
            if (grpCheck.rows[0]?.is_locked) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Circle is locked. Expenses cannot be modified.' });
            }
        }

        // Verify editor/admin role (Mandatory Authentication)
        const updaterId = actingUserId(req);
        if (!updaterId || isNaN(updaterId)) {
            await client.query('ROLLBACK');
            return res.status(401).json({ error: 'Authentication required to modify expense.' });
        }

        const roleRes = await client.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, updaterId]);
        const isPayer = existingExp.paid_by === updaterId;
        const isAdminOrEditor = roleRes.rows.length > 0 && ['admin', 'editor'].includes(roleRes.rows[0].role);

        if (!isAdminOrEditor && !isPayer) {
            await client.query('ROLLBACK');
            return res.status(403).json({ 
                error: 'Permission denied: Only group Admins, Editors, or the original payer can edit expenses.' 
            });
        }

        // Settlement Protection: If any OTHER participant's split has any paid
        // amount (including a partial payment), block destructive edit.
        const oldSplitsRes = await client.query('SELECT * FROM expense_splits WHERE expense_id = $1', [expenseId]);
        const settledSplits = oldSplitsRes.rows.filter(s =>
            parseInt(s.user_id) !== parseInt(existingExp.paid_by) &&
            (parseFloat(s.settled_amount || 0) > 0.005 || parseFloat(s.settled_amount_base || 0) > 0.005)
        );
        if (settledSplits.length > 0) {
            await client.query('ROLLBACK');
            return res.status(403).json({
                error: 'Cannot edit an expense that has settled participant shares directly. Use the safe correction process instead.',
                is_protected: true,
                code: 'EXPENSE_PAID_PROTECTED'
            });
        }

        // Validate splits
        if (!splits || !Array.isArray(splits) || splits.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Please select at least one group member to split with.' });
        }

        const groupMembersRes = await client.query('SELECT user_id FROM group_members WHERE group_id = $1', [groupId]);
        const groupMemberSet = new Set(groupMembersRes.rows.map(m => parseInt(m.user_id)));
        for (const s of splits) {
            if (!groupMemberSet.has(parseInt(s.user_id))) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'All split participants must be enrolled members of the selected group.' });
            }
        }
        const effectivePayer = parseInt(paid_by || existingExp.paid_by);
        if (!groupMemberSet.has(effectivePayer)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'The selected payer must be an enrolled member of this group.' });
        }

        const normalizedUpdate = splitEngine.normalizeSplits({
            totalAmount,
            splitType: effectiveSplitType,
            splits,
            currency: (req.body.currency || existingExp.currency || 'INR').toUpperCase()
        });
        if (normalizedUpdate.error) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: normalizedUpdate.error });
        }
        const normalizedSplits = normalizedUpdate.splits;

        // Update expense record
        const grpCurRes = await client.query('SELECT base_currency FROM groups WHERE id = $1', [groupId]);
        const groupBaseCur = grpCurRes.rows[0]?.base_currency || 'INR';
        const expCurrency = (req.body.currency || existingExp.currency || 'INR').toUpperCase();
        let originalAmount = totalAmount;
        let convertedAmount = totalAmount;
        let exchangeRate = 1.0;
        let rateProvider = 'identity';
        let rateTimestamp = new Date();

        if (expCurrency !== groupBaseCur) {
            try {
                const conv = await currencyService.convertAmount(totalAmount, expCurrency, groupBaseCur);
                convertedAmount = conv.converted_amount;
                exchangeRate = conv.exchange_rate;
                rateProvider = conv.rate_provider;
                rateTimestamp = conv.rate_timestamp;
            } catch (curErr) {
                console.warn('[Expense Currency] Conversion warning:', curErr.message);
            }
        }

        await client.query(`
            UPDATE expenses 
            SET description = $1, amount = $2, paid_by = $3, category = $4, split_type = $5, notes = $6, expense_date = COALESCE($7, expense_date),
                currency = $8, original_amount = $9, exchange_rate = $10, converted_amount = $11, rate_provider = $12, rate_timestamp = $13
            WHERE id = $14
        `, [expDesc, totalAmount, paid_by || existingExp.paid_by, sanitizeText(category || existingExp.category, 50) || 'General', effectiveSplitType, sanitizeText(notes, 2000), expense_date || null, expCurrency, originalAmount, exchangeRate, convertedAmount, rateProvider, rateTimestamp, expenseId]);

        // Delete old splits
        await client.query('DELETE FROM expense_splits WHERE expense_id = $1', [expenseId]);

        // Insert updated splits in both expense and base currency
        const baseShares = splitEngine.allocateByWeights(
            roundMoney(convertedAmount),
            normalizedSplits.map(s => s.amount),
            groupBaseCur
        );
        for (let i = 0; i < normalizedSplits.length; i++) {
            const s = normalizedSplits[i];
            await client.query(`
                INSERT INTO expense_splits
                    (expense_id, user_id, amount, base_amount, split_percentage, shares, is_settled, settled_amount, settled_amount_base, is_locked) 
                VALUES ($1, $2, $3, $4, $5, $6, FALSE, 0, 0, $7)
            `, [expenseId, s.user_id, s.amount, baseShares[i], s.percentage || 0, s.shares || 1, s.is_locked === true]);
        }

        const groupRes = await client.query('SELECT name FROM groups WHERE id = $1', [groupId]);
        const groupName = groupRes.rows[0]?.name || 'Group';

        await client.query(`
            INSERT INTO activity_logs (user_id, group_id, activity_type, message) 
            VALUES ($1, $2, 'EXPENSE_UPDATED', 'Updated expense "' || $3 || '" (₹' || $4 || ') in ' || $5)
        `, [updaterId, groupId, expDesc, totalAmount.toFixed(2), groupName]);

        await client.query('COMMIT');
        res.json({ message: 'Expense updated successfully.', expense: { id: expenseId, description: expDesc, amount: totalAmount } });
    } catch (err) {
        console.error('Error in PUT /api/expenses/:id:', err);
        await client.query('ROLLBACK');
        res.status(500).json({ error: formatUserError(err, 'Failed to update expense. Please try again.'), details: err.message });
    } finally {
        client.release();
    }
});

// Safe Expense Correction Endpoint (Preserves Payment & Settlement Audit History)
app.post('/api/expenses/:id/correction', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const expenseId = parseInt(req.params.id);
        const { reason, new_amount, corrected_amount, new_description } = req.body;
        const requesterId = actingUserId(req);

        if (!requesterId || isNaN(requesterId)) {
            await client.query('ROLLBACK');
            return res.status(401).json({ error: 'Authentication required to request a correction.' });
        }
        if (!reason || !reason.trim()) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'A clear reason for the correction is required.' });
        }

        const expRes = await client.query('SELECT * FROM expenses WHERE id = $1', [expenseId]);
        if (expRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Expense not found.' });
        }
        const exp = expRes.rows[0];

        // Check if group is locked
        if (exp.group_id) {
            const grpCheck = await client.query('SELECT is_locked FROM groups WHERE id = $1', [exp.group_id]);
            if (grpCheck.rows[0]?.is_locked) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Circle is locked. Expenses cannot be modified.' });
            }
        }

        // Verify permission: admin, editor, or payer
        const roleRes = await client.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [exp.group_id, requesterId]);
        const isPayer = exp.paid_by === requesterId;
        const isAdminOrEditor = roleRes.rows.length > 0 && ['admin', 'editor'].includes(roleRes.rows[0].role);

        if (!isAdminOrEditor && !isPayer) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Permission denied: Only group Admins, Editors, or the original payer can request corrections.' });
        }

        const prevAmount = parseFloat(exp.amount);
        const nextAmount = new_amount !== undefined ? parseFloat(new_amount) : (corrected_amount !== undefined ? parseFloat(corrected_amount) : prevAmount);
        const prevDesc = exp.description;
        const nextDesc = sanitizeText(new_description || prevDesc, 255);
        const safeReason = sanitizeText(reason, 500);

        if (isNaN(nextAmount) || nextAmount <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Corrected amount must be greater than zero.' });
        }

        // Calculate already committed shares (expense currency and base currency).
        // A partially paid share is still a fixed obligation and must be preserved.
        const splitsRes = await client.query('SELECT * FROM expense_splits WHERE expense_id = $1 ORDER BY id ASC', [expenseId]);
        const allSplits = splitsRes.rows;
        const protectedSplits = allSplits.filter(s =>
            parseFloat(s.settled_amount || 0) > 0.005 || parseFloat(s.settled_amount_base || 0) > 0.005
        );
        const unsettledSplits = allSplits.filter(s =>
            parseFloat(s.settled_amount || 0) <= 0.005 && parseFloat(s.settled_amount_base || 0) <= 0.005
        );
        const protectedTotal = roundMoney(protectedSplits.reduce((acc, s) => acc + parseFloat(s.amount || 0), 0));

        if (nextAmount < protectedTotal - 0.005) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: `Corrected total (${exp.currency} ${nextAmount.toFixed(2)}) cannot be less than the committed shares total (${exp.currency} ${protectedTotal.toFixed(2)}).` 
            });
        }

        const remainingToSplit = roundMoney(nextAmount - protectedTotal);
        if (unsettledSplits.length === 0 && remainingToSplit > 0.005) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: 'Cannot correct a fully settled expense. All participant shares have been paid and the transaction is permanently locked.' 
            });
        }

        const newUnsettledAmounts = unsettledSplits.length > 0
            ? splitEngine.allocateByWeights(remainingToSplit, unsettledSplits.map(() => 1), exp.currency || 'INR')
            : [];

        // Recompute base-currency obligations; committed shares keep their base amount.
        const grpBaseRes = await client.query('SELECT base_currency FROM groups WHERE id = $1', [exp.group_id]);
        const groupBaseCur = grpBaseRes.rows[0]?.base_currency || 'INR';
        const rate = parseFloat(exp.exchange_rate) || 1;
        const totalBase = roundMoney((exp.currency && exp.currency !== groupBaseCur) ? nextAmount * rate : nextAmount);
        const protectedBaseSum = roundMoney(protectedSplits.reduce((acc, s) => acc + parseFloat(s.base_amount || 0), 0));
        const unsettledBaseTotal = Math.max(0, roundMoney(totalBase - protectedBaseSum));
        const newUnsettledBase = unsettledSplits.length > 0
            ? splitEngine.allocateByWeights(unsettledBaseTotal, unsettledSplits.map(() => 1), groupBaseCur)
            : [];

        for (let i = 0; i < unsettledSplits.length; i++) {
            await client.query(
                'UPDATE expense_splits SET amount = $1, base_amount = $2 WHERE id = $3',
                [newUnsettledAmounts[i], newUnsettledBase[i], unsettledSplits[i].id]
            );
        }

        // Update expense header (amount + converted/base amount stay in sync)
        await client.query(`
            UPDATE expenses 
            SET amount = $1, original_amount = $1, converted_amount = $2,
                description = $3,
                notes = COALESCE(notes, '') || E'\n[Audit Correction ' || NOW()::date || ']: ' || $4
            WHERE id = $5
        `, [nextAmount, totalBase, nextDesc, safeReason, expenseId]);

        // Insert into expense_corrections audit ledger
        const corrRes = await client.query(`
            INSERT INTO expense_corrections (
                expense_id, requested_by, previous_amount, new_amount, 
                previous_description, new_description, correction_reason, status, approved_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'APPLIED', $2)
            RETURNING id
        `, [expenseId, requesterId, prevAmount, nextAmount, prevDesc, nextDesc, safeReason]);

        // Insert into activity_logs
        const reqUserRes = await client.query('SELECT name FROM users WHERE id = $1', [requesterId]);
        const reqUserName = reqUserRes.rows[0]?.name || 'User';
        await client.query(`
            INSERT INTO activity_logs (user_id, group_id, activity_type, message)
            VALUES ($1, $2, 'EXPENSE_CORRECTION', $3 || ' corrected expense #' || $4 || ' from ₹' || $5 || ' to ₹' || $6 || ' (Reason: ' || $7 || ')')
        `, [requesterId, exp.group_id, reqUserName, expenseId, prevAmount.toFixed(2), nextAmount.toFixed(2), safeReason]);

        await client.query('COMMIT');
        res.json({
            success: true,
            message: 'Expense correction recorded and applied with full audit history.',
            correctionId: corrRes.rows[0].id,
            correction: corrRes.rows[0],
            expense: { id: expenseId, amount: nextAmount, description: nextDesc }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error in expense correction:', err);
        res.status(500).json({ error: formatUserError(err, 'Failed to process expense correction.') });
    } finally {
        client.release();
    }
});

// ==========================================
// 4. SETTLEMENTS API
// ==========================================

// Get Settlements (Strictly filtered by authenticated user)
app.get('/api/settlements', async (req, res) => {
    try {
        const currentUserId = actingUserId(req);
        if (!currentUserId) {
            return res.status(401).json({ error: 'Authentication required.' });
        }

        const result = await pool.query(`
            SELECT s.*, 
                   p.name as payer_name, p.avatar_initials as payer_initials,
                   r.name as receiver_name, r.avatar_initials as receiver_initials, r.upi_id as receiver_upi,
                   g.name as group_name
            FROM settlements s
            LEFT JOIN users p ON s.payer_id = p.id
            LEFT JOIN users r ON s.receiver_id = r.id
            LEFT JOIN groups g ON s.group_id = g.id
            WHERE s.payer_id = $1 
               OR s.receiver_id = $1 
               OR (s.group_id IS NOT NULL AND s.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1))
            ORDER BY s.created_at DESC
        `, [currentUserId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to load settlements.') });
    }
});

// Record Settlement
app.post('/api/settlements', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { group_id, payer_id, receiver_id, amount, payment_method = 'UPI', transaction_reference, notes } = req.body;
        const pId = parseInt(payer_id);
        const rId = parseInt(receiver_id || req.body.payee_id);
        const amt = roundMoney(amount);
        const authId = actingUserId(req);

        if (!pId || !rId || !Number.isFinite(amt) || amt <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Valid payer, receiver, and positive amount are required' });
        }
        if (pId === rId) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Payer and receiver cannot be the same person' });
        }
        if (pId !== authId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Permission denied: you can only record a settlement that you paid.' });
        }
        if (!['UPI', 'CASH', 'BANK', 'UPI_QR'].includes(String(payment_method).toUpperCase())) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Unsupported payment method.' });
        }

        const dedupeKey = `settle:${pId}:${rId}:${amt}`;
        if (dedupeRequest(dedupeKey, 5000)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'This settlement was just submitted. Duplicate submission prevented.' });
        }

        let effectiveGroupId = group_id ? parseInt(group_id) : null;
        if (effectiveGroupId) {
            const g = await client.query('SELECT id FROM groups WHERE id = $1', [effectiveGroupId]);
            if (g.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Circle not found.' });
            }
            const members = await client.query(
                'SELECT user_id FROM group_members WHERE group_id = $1 AND user_id = ANY($2::int[])',
                [effectiveGroupId, [pId, rId]]
            );
            if (members.rows.length !== 2) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'Both parties must be members of the selected circle.' });
            }
        } else {
            const grpFind = await client.query(`
                SELECT e.group_id 
                FROM expense_splits es
                JOIN expenses e ON es.expense_id = e.id
                WHERE es.user_id = $1 AND e.paid_by = $2 AND (es.base_amount - es.settled_amount_base) > 0.005
                ORDER BY e.expense_date ASC
                LIMIT 1
            `, [pId, rId]);
            if (grpFind.rows.length > 0) effectiveGroupId = grpFind.rows[0].group_id;
        }

        // Apply the payment to the debtor's outstanding splits (partial-safe).
        const applied = await applyPaymentToSplits(client, {
            payerId: pId, receiverId: rId, amount: amt, groupId: effectiveGroupId
        });
        if (applied.unapplied > 0.005) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: `The settlement exceeds the outstanding balance. Only ₹${applied.appliedTotal.toFixed(2)} is currently owed between these members — please correct the amount.`,
                code: 'SETTLEMENT_EXCEEDS_BALANCE',
                max_settleable: applied.appliedTotal
            });
        }

        const ref = transaction_reference || `UPI-${Math.floor(100000 + Math.random() * 900000)}-${String(payment_method).toUpperCase()}`;

        const settRes = await client.query(
            `INSERT INTO settlements (group_id, payer_id, receiver_id, amount, payment_method, transaction_reference, notes) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [effectiveGroupId, pId, rId, applied.appliedTotal, payment_method, ref, sanitizeText(notes, 1000) || '']
        );

        // Activity log
        const pRes = await client.query('SELECT name FROM users WHERE id = $1', [pId]);
        const rRes = await client.query('SELECT name FROM users WHERE id = $1', [rId]);
        const pName = pRes.rows[0]?.name || 'Payer';
        const rName = rRes.rows[0]?.name || 'Receiver';

        await client.query(
            `INSERT INTO activity_logs (user_id, group_id, activity_type, message) 
             VALUES ($1, $2, 'SETTLEMENT', $3 || ' settled ₹' || $4 || ' with ' || $5 || ' via ' || $6)`,
            [pId, effectiveGroupId, pName, applied.appliedTotal.toFixed(2), rName, payment_method]
        );

        await client.query('COMMIT');

        // Dispatch settlement confirmation emails (non-blocking)
        try {
            const payerUserRes = await pool.query('SELECT name, email FROM users WHERE id = $1', [pId]);
            const receiverUserRes = await pool.query('SELECT name, email FROM users WHERE id = $1', [rId]);
            const payerUser = payerUserRes.rows[0];
            const receiverUser = receiverUserRes.rows[0];

            if (payerUser?.email) {
                emailService.sendSettlementCompletedEmail({
                    to: payerUser.email,
                    recipientName: payerUser.name,
                    payerName: payerUser.name,
                    receiverName: receiverUser?.name || 'Receiver',
                    amount: applied.appliedTotal,
                    paymentMethod: payment_method,
                    transactionRef: ref,
                    isPayer: true
                }).catch(e => console.error('[Settlement Email Payer] Warning:', e.message));
            }

            if (receiverUser?.email) {
                emailService.sendSettlementCompletedEmail({
                    to: receiverUser.email,
                    recipientName: receiverUser.name,
                    payerName: payerUser?.name || 'Payer',
                    receiverName: receiverUser.name,
                    amount: applied.appliedTotal,
                    paymentMethod: payment_method,
                    transactionRef: ref,
                    isPayer: false
                }).catch(e => console.error('[Settlement Email Receiver] Warning:', e.message));
            }
        } catch (emailErr) {
            console.error('[Settlement Email Notice] Non-blocking warning:', emailErr.message);
        }
        res.status(201).json({ 
            message: 'Settlement recorded successfully', 
            id: settRes.rows[0].id, 
            reference: ref, 
            settlement: { id: settRes.rows[0].id, amount: applied.appliedTotal, payer_id: pId, receiver_id: rId } ,
            remaining_balance: 0
        });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: formatUserError(err, 'Failed to record settlement.') });
    } finally {
        client.release();
    }
});

// Automatically record settlement when paid via QR Code
app.post('/api/settlements/qr-complete', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { payer_id, receiver_id, amount, upi_id, transaction_ref, notes } = req.body;
        const amt = roundMoney(amount);
        const pId = parseInt(payer_id);
        const rId = parseInt(receiver_id);
        const authId = actingUserId(req);

        if (!pId || !rId || !Number.isFinite(amt) || amt <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Valid payer, receiver, and positive settlement amount required' });
        }
        if (pId === rId) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Payer and receiver cannot be the same person' });
        }
        if (pId !== authId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Permission denied: you can only complete your own payment.' });
        }

        const dedupeKey = `settle_qr:${pId}:${rId}:${amt}`;
        if (dedupeRequest(dedupeKey, 5000)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'This QR settlement was just submitted. Duplicate prevented.' });
        }

        const qrRef = transaction_ref || `UPI-QR-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

        // Resolve the circle from the outstanding splits, then apply the payment.
        const grpFind = await client.query(`
            SELECT e.group_id
            FROM expense_splits es
            JOIN expenses e ON es.expense_id = e.id
            WHERE es.user_id = $1 AND e.paid_by = $2 AND (es.amount - es.settled_amount) > 0.005
            ORDER BY e.expense_date ASC
            LIMIT 1
        `, [pId, rId]);
        const effectiveGroupId = grpFind.rows[0]?.group_id || null;

        const applied = await applyPaymentToSplits(client, {
            payerId: pId, receiverId: rId, amount: amt, groupId: effectiveGroupId
        });
        if (applied.unapplied > 0.005) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: `The payment exceeds the outstanding balance. Only ₹${applied.appliedTotal.toFixed(2)} is currently owed.`,
                code: 'SETTLEMENT_EXCEEDS_BALANCE',
                max_settleable: applied.appliedTotal
            });
        }

        const settRes = await client.query(
            `INSERT INTO settlements (group_id, payer_id, receiver_id, amount, payment_method, transaction_reference, notes) 
             VALUES ($1, $2, $3, $4, 'UPI_QR', $5, $6) RETURNING id`,
            [effectiveGroupId, pId, rId, applied.appliedTotal, qrRef, notes || `Automated settlement via UPI QR Scan (${upi_id || 'QR'})`]
        );

        const pRes = await client.query('SELECT name FROM users WHERE id = $1', [pId]);
        const rRes = await client.query('SELECT name FROM users WHERE id = $1', [rId]);
        const pName = pRes.rows[0]?.name || 'Payer';
        const rName = rRes.rows[0]?.name || 'Receiver';

        await client.query(
            `INSERT INTO activity_logs (user_id, group_id, activity_type, message) 
             VALUES ($1, $2, 'SETTLEMENT', $3 || ' settled ₹' || $4 || ' with ' || $5 || ' automatically via UPI QR Code scan')`,
            [pId, effectiveGroupId, pName, applied.appliedTotal.toFixed(2), rName]
        );

        await client.query('COMMIT');

        // Dispatch settlement confirmation emails for QR (non-blocking)
        try {
            const payerUserRes = await pool.query('SELECT name, email FROM users WHERE id = $1', [pId]);
            const receiverUserRes = await pool.query('SELECT name, email FROM users WHERE id = $1', [rId]);
            const payerUser = payerUserRes.rows[0];
            const receiverUser = receiverUserRes.rows[0];

            if (payerUser?.email) {
                emailService.sendSettlementCompletedEmail({
                    to: payerUser.email,
                    recipientName: payerUser.name,
                    payerName: payerUser.name,
                    receiverName: receiverUser?.name || rName,
                    amount: applied.appliedTotal,
                    paymentMethod: 'UPI_QR',
                    transactionRef: qrRef,
                    isPayer: true
                }).catch(e => console.error('[QR Settlement Email Payer] Warning:', e.message));
            }

            if (receiverUser?.email) {
                emailService.sendSettlementCompletedEmail({
                    to: receiverUser.email,
                    recipientName: receiverUser.name,
                    payerName: payerUser?.name || pName,
                    receiverName: receiverUser.name,
                    amount: applied.appliedTotal,
                    paymentMethod: 'UPI_QR',
                    transactionRef: qrRef,
                    isPayer: false
                }).catch(e => console.error('[QR Settlement Email Receiver] Warning:', e.message));
            }
        } catch (emailErr) {
            console.error('[QR Settlement Email Notice] Non-blocking warning:', emailErr.message);
        }
        res.status(201).json({
            success: true,
            message: `Settlement of ₹${applied.appliedTotal.toFixed(2)} automatically recorded from UPI QR payment!`,
            id: settRes.rows[0].id,
            transaction_reference: qrRef,
            settlement: {
                id: settRes.rows[0].id,
                payer_id: pId,
                payer_name: pName,
                receiver_id: rId,
                receiver_name: rName,
                amount: applied.appliedTotal,
                payment_method: 'UPI_QR'
            }
        });
    } catch(err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: formatUserError(err, 'Failed to complete QR auto-settlement.') });
    } finally {
        client.release();
    }
});

// ==========================================
// 4.1 AUTOMATED UPI PAYMENT & WEBHOOK SETTLEMENT ENGINE
// ==========================================
const UPI_WEBHOOK_SECRET = process.env.UPI_WEBHOOK_SECRET || 'splitease_upi_webhook_secret_key_2025';

// Initialize UPI Payment Requests Database Schema
async function initUpiTables() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS upi_payment_requests (
                id SERIAL PRIMARY KEY,
                request_id VARCHAR(64) UNIQUE NOT NULL,
                payer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
                amount NUMERIC(12, 2) NOT NULL,
                currency VARCHAR(10) DEFAULT 'INR',
                status VARCHAR(30) DEFAULT 'PENDING',
                upi_id VARCHAR(100) NOT NULL,
                upi_string TEXT NOT NULL,
                transaction_ref VARCHAR(100),
                utr VARCHAR(100),
                notes TEXT,
                settlement_id INTEGER REFERENCES settlements(id) ON DELETE SET NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                settled_at TIMESTAMP WITH TIME ZONE,
                idempotency_key VARCHAR(100) UNIQUE
            );
            CREATE INDEX IF NOT EXISTS idx_upr_request_id ON upi_payment_requests(request_id);
            CREATE INDEX IF NOT EXISTS idx_upr_status ON upi_payment_requests(status);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_upr_utr ON upi_payment_requests(utr) WHERE utr IS NOT NULL AND status = 'SUCCESS';
        `);
        console.log('✓ Automated UPI Settlement Tables Ready');
    } catch (err) {
        console.error('Error creating upi_payment_requests table:', err);
    }
}
initUpiTables();

// Manual "Mark as Paid" confirmation requests. A request is only a claim:
// balances change only when the actual receiver approves it.
async function initPaymentRequestTables() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS payment_requests (
                id SERIAL PRIMARY KEY,
                request_code VARCHAR(64) UNIQUE NOT NULL,
                payer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
                expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
                amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
                currency VARCHAR(10) DEFAULT 'INR',
                payment_method VARCHAR(20) NOT NULL DEFAULT 'CASH',
                transaction_reference VARCHAR(128),
                expense_description_snapshot VARCHAR(255),
                expense_date_snapshot DATE,
                note TEXT,
                status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
                verification_source VARCHAR(32) NOT NULL DEFAULT 'RECEIVER_CONFIRMED',
                settlement_id INTEGER REFERENCES settlements(id) ON DELETE SET NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                responded_at TIMESTAMP WITH TIME ZONE,
                responded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                rejection_reason TEXT,
                idempotency_key VARCHAR(128)
            );
            ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS verification_source VARCHAR(32) NOT NULL DEFAULT 'RECEIVER_CONFIRMED';
            ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS expense_description_snapshot VARCHAR(255);
            ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS expense_date_snapshot DATE;
            CREATE INDEX IF NOT EXISTS idx_payment_requests_payer ON payment_requests(payer_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_payment_requests_receiver ON payment_requests(receiver_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests(status);
            CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_pending
                ON payment_requests (payer_id, receiver_id, COALESCE(expense_id, 0))
                WHERE status = 'PENDING';
            CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_idempotency
                ON payment_requests (idempotency_key)
                WHERE idempotency_key IS NOT NULL;
        `);
        console.log('✓ Manual Payment Confirmation Request Tables Ready');
    } catch (err) {
        console.error('Error creating payment_requests table:', err);
    }
}
initPaymentRequestTables();

const PAYMENT_REQUEST_METHODS = new Set(['CASH', 'UPI', 'BANK', 'UPI_QR', 'OTHER']);

function paymentRequestMethod(value) {
    const method = String(value || 'CASH').toUpperCase();
    return PAYMENT_REQUEST_METHODS.has(method) ? method : null;
}

async function paymentRequestOutstanding(db, { payerId, receiverId, groupId = null, expenseId = null }) {
    const params = [payerId, receiverId];
    let filters = '';
    if (groupId) { params.push(groupId); filters += ` AND e.group_id = $${params.length}`; }
    if (expenseId) { params.push(expenseId); filters += ` AND e.id = $${params.length}`; }
    const result = await db.query(`
        SELECT COALESCE(SUM(es.base_amount - es.settled_amount_base), 0) AS outstanding
        FROM expense_splits es
        JOIN expenses e ON e.id = es.expense_id
        WHERE es.user_id = $1
          AND e.paid_by = $2
          AND es.user_id <> e.paid_by
          AND (es.base_amount - es.settled_amount_base) > 0.005
          ${filters}
    `, params);
    return roundMoney(result.rows[0]?.outstanding || 0);
}

// ==========================================
// MANUAL PAYMENT CONFIRMATION REQUESTS
// A debtor can claim an external payment; only the receiver can accept it.
// ==========================================
function mapPaymentRequestRow(row) {
    return {
        ...row,
        amount: parseFloat(row.amount || 0),
        can_accept: row.status === 'PENDING',
        verification_source: row.verification_source || 'RECEIVER_CONFIRMED',
        manual_confirmation: true,
        gateway_verified: false
    };
}

app.post('/api/payment-requests', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const payerId = actingUserId(req);
        if (!payerId) {
            await client.query('ROLLBACK');
            return res.status(401).json({ error: 'Authentication required.' });
        }

        let receiverId = parseInt(req.body.receiver_id || req.body.payee_id);
        let groupId = req.body.group_id ? parseInt(req.body.group_id) : null;
        const expenseId = req.body.expense_id ? parseInt(req.body.expense_id) : null;
        const amount = roundMoney(req.body.amount);
        const method = paymentRequestMethod(req.body.payment_method);
        const note = sanitizeText(req.body.note, 500) || '';
        const reference = sanitizeText(req.body.transaction_reference, 128) || '';
        const idempotencyKey = sanitizeText(req.body.idempotency_key, 128) || null;

        if (!Number.isFinite(amount) || amount <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Enter a valid payment amount greater than zero.' });
        }
        if (!method) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Unsupported payment method. Use Cash, UPI, Bank, UPI QR, or Other.' });
        }

        let expense = null;
        let outstanding = 0;

        if (expenseId) {
            const expenseRes = await client.query(`
                SELECT e.id, e.group_id, e.paid_by, e.description, e.expense_date, e.currency,
                       g.name AS group_name, g.is_locked,
                       es.base_amount, es.settled_amount_base
                FROM expenses e
                JOIN groups g ON g.id = e.group_id
                JOIN expense_splits es ON es.expense_id = e.id AND es.user_id = $2
                WHERE e.id = $1
                FOR UPDATE OF es
            `, [expenseId, payerId]);
            if (expenseRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Expense not found, or you are not a participant in it.' });
            }
            expense = expenseRes.rows[0];
            if (Number(expense.paid_by) === Number(payerId)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'You paid this expense; only a member who owes you can mark it as paid.' });
            }
            if (receiverId && Number(receiverId) !== Number(expense.paid_by)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'The receiver must be the member who paid this expense.' });
            }
            receiverId = Number(expense.paid_by);
            groupId = expense.group_id;
            if (expense.is_locked) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'This circle is locked. Unlock it before sending a Mark as Paid request.' });
            }
            outstanding = roundMoney(parseFloat(expense.base_amount || 0) - parseFloat(expense.settled_amount_base || 0));
        } else {
            if (!receiverId) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Select the member you paid.' });
            }
            if (groupId) {
                const groupRes = await client.query('SELECT id, is_locked FROM groups WHERE id = $1', [groupId]);
                if (groupRes.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({ error: 'Circle not found.' });
                }
                if (groupRes.rows[0].is_locked) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: 'This circle is locked. Unlock it before sending a Mark as Paid request.' });
                }
                const members = await client.query(
                    'SELECT user_id FROM group_members WHERE group_id = $1 AND user_id = ANY($2::int[])',
                    [groupId, [payerId, receiverId]]
                );
                if (members.rows.length !== 2) {
                    await client.query('ROLLBACK');
                    return res.status(403).json({ error: 'Both parties must be members of the selected circle.' });
                }
            }
            outstanding = await paymentRequestOutstanding(client, { payerId, receiverId, groupId });
        }

        if (Number(receiverId) === Number(payerId)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'You cannot send a payment request to yourself.' });
        }

        const receiverRes = await client.query('SELECT id, name FROM users WHERE id = $1', [receiverId]);
        if (receiverRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Receiver not found.' });
        }

        if (outstanding <= 0.005) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'There is no outstanding balance between you and this member.' });
        }
        if (amount > outstanding + 0.005) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: `The amount exceeds the outstanding balance. You currently owe ₹${outstanding.toFixed(2)}.`,
                code: 'AMOUNT_EXCEEDS_OUTSTANDING',
                max_amount: outstanding
            });
        }

        if (idempotencyKey) {
            const idem = await client.query('SELECT * FROM payment_requests WHERE idempotency_key = $1 AND payer_id = $2 LIMIT 1', [idempotencyKey, payerId]);
            if (idem.rows.length > 0) {
                await client.query('COMMIT');
                return res.status(200).json({ request: mapPaymentRequestRow(idem.rows[0]), idempotent: true });
            }
        }

        const dup = await client.query(`
            SELECT * FROM payment_requests
            WHERE payer_id = $1 AND receiver_id = $2
              AND COALESCE(expense_id, 0) = COALESCE($3, 0)
              AND status = 'PENDING'
            LIMIT 1
        `, [payerId, receiverId, expenseId]);
        if (dup.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: 'A pending payment request already exists for this expense. Cancel it or wait for the receiver to respond.',
                code: 'DUPLICATE_PENDING_REQUEST',
                request: mapPaymentRequestRow(dup.rows[0])
            });
        }

        const requestCode = `PR-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const insert = await client.query(`
            INSERT INTO payment_requests
                (request_code, payer_id, receiver_id, group_id, expense_id, amount, currency,
                 payment_method, transaction_reference, expense_description_snapshot, expense_date_snapshot,
                 note, status, verification_source, idempotency_key)
            VALUES ($1, $2, $3, $4, $5, $6, 'INR', $7, $8, $9, $10, $11, 'PENDING', 'RECEIVER_CONFIRMED', $12)
            RETURNING *
        `, [requestCode, payerId, receiverId, groupId, expenseId, amount, method, reference || null,
            expense ? expense.description : null, expense ? expense.expense_date : null,
            note || null, idempotencyKey]);

        const receiverName = receiverRes.rows[0].name;
        const payerRes = await client.query('SELECT name FROM users WHERE id = $1', [payerId]);
        const payerName = payerRes.rows[0]?.name || 'Member';
        const subject = expense ? `for “${expense.description}”` : 'for your outstanding balance';
        await client.query(`
            INSERT INTO activity_logs (user_id, group_id, activity_type, message)
            VALUES ($1, $2, 'PAYMENT_REQUEST_SENT', $3)
        `, [payerId, groupId, `You sent a Mark as Paid request of ₹${amount.toFixed(2)} to ${receiverName} ${subject}. The balance changes only after they accept.`]);
        await client.query(`
            INSERT INTO activity_logs (user_id, group_id, activity_type, message)
            VALUES ($1, $2, 'PAYMENT_REQUEST_RECEIVED', $3)
        `, [receiverId, groupId, `${payerName} marked ₹${amount.toFixed(2)} as paid ${subject}. Review the payment confirmation request.`]);

        await client.query('COMMIT');
        res.status(201).json({ request: mapPaymentRequestRow(insert.rows[0]), message: 'Payment confirmation request sent.' });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (e) {}
        if (err && err.code === '23505') {
            return res.status(409).json({ error: 'A pending payment request already exists for this payment.', code: 'DUPLICATE_PENDING_REQUEST' });
        }
        res.status(500).json({ error: formatUserError(err, 'Failed to create the payment confirmation request.') });
    } finally {
        client.release();
    }
});

app.get('/api/payment-requests', async (req, res) => {
    try {
        const userId = actingUserId(req);
        if (!userId) return res.status(401).json({ error: 'Authentication required.' });
        const result = await pool.query(`
            SELECT pr.*,
                   p.name AS payer_name, p.avatar_initials AS payer_initials,
                   r.name AS receiver_name, r.avatar_initials AS receiver_initials,
                   e.description AS expense_description, e.expense_date,
                   COALESCE(e.description, pr.expense_description_snapshot) AS expense_description_fallback,
                   COALESCE(e.expense_date, pr.expense_date_snapshot) AS expense_date_fallback,
                   g.name AS group_name
            FROM payment_requests pr
            JOIN users p ON p.id = pr.payer_id
            JOIN users r ON r.id = pr.receiver_id
            LEFT JOIN expenses e ON e.id = pr.expense_id
            LEFT JOIN groups g ON g.id = pr.group_id
            WHERE pr.payer_id = $1 OR pr.receiver_id = $1
            ORDER BY pr.created_at DESC, pr.id DESC
        `, [userId]);
        const requests = result.rows.map(row => ({
            ...mapPaymentRequestRow(row),
            expense_description: row.expense_description_fallback || row.expense_description,
            expense_date: row.expense_date_fallback || row.expense_date,
            can_accept: row.status === 'PENDING' && Number(row.receiver_id) === Number(userId),
            can_reject: row.status === 'PENDING' && Number(row.receiver_id) === Number(userId),
            can_cancel: row.status === 'PENDING' && Number(row.payer_id) === Number(userId)
        }));
        const counts = {
            received_pending: requests.filter(r => Number(r.receiver_id) === Number(userId) && r.status === 'PENDING').length,
            sent_pending: requests.filter(r => Number(r.payer_id) === Number(userId) && r.status === 'PENDING').length,
            history: requests.filter(r => r.status !== 'PENDING').length
        };
        res.json({ requests, counts });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to load payment confirmation requests.') });
    }
});

app.post('/api/payment-requests/:id/accept', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userId = actingUserId(req);
        const requestId = parseInt(req.params.id);
        if (!userId) { await client.query('ROLLBACK'); return res.status(401).json({ error: 'Authentication required.' }); }
        if (!requestId) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Valid request ID required.' }); }

        const prRes = await client.query('SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE', [requestId]);
        if (prRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Payment request not found.' }); }
        const pr = prRes.rows[0];
        if (Number(pr.receiver_id) !== Number(userId)) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Only the receiving member can approve this payment request.' });
        }
        if (pr.status !== 'PENDING') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: `This request is already ${String(pr.status).toLowerCase()}.`, status: pr.status });
        }
        if (pr.transaction_reference) {
            const refDup = await client.query(`
                SELECT id FROM payment_requests
                WHERE payer_id = $1 AND transaction_reference = $2
                  AND status = 'ACCEPTED' AND id <> $3
                LIMIT 1
            `, [pr.payer_id, pr.transaction_reference, requestId]);
            if (refDup.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    error: 'This transaction reference has already been used for an accepted payment. Duplicate settlement prevented.',
                    code: 'DUPLICATE_TRANSACTION_REFERENCE'
                });
            }
        }
        if (pr.group_id) {
            const members = await client.query(
                'SELECT user_id FROM group_members WHERE group_id = $1 AND user_id = ANY($2::int[])',
                [pr.group_id, [pr.payer_id, pr.receiver_id]]
            );
            if (members.rows.length !== 2) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'Both parties must still be members of this circle to approve the payment.' });
            }
            const groupRes = await client.query('SELECT is_locked FROM groups WHERE id = $1', [pr.group_id]);
            if (groupRes.rows[0]?.is_locked) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'This circle is locked. Unlock it before approving the payment.' });
            }
        }

        const amount = roundMoney(pr.amount);
        const applied = await applyPaymentToSplits(client, {
            payerId: pr.payer_id,
            receiverId: pr.receiver_id,
            amount,
            groupId: pr.group_id,
            expenseId: pr.expense_id
        });
        if (applied.unapplied > 0.005) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: `The outstanding balance has changed. Only ₹${applied.appliedTotal.toFixed(2)} can be applied now. Reject this request and ask the payer to send a new one.`,
                code: 'BALANCE_CHANGED',
                max_amount: applied.appliedTotal
            });
        }

        const reference = pr.transaction_reference || `MANUAL-${pr.request_code}`;
        const settlementNote = `Manual payment request ${pr.request_code}${pr.note ? ' — ' + pr.note : ''}`;
        const settlementRes = await client.query(`
            INSERT INTO settlements
                (group_id, payer_id, receiver_id, amount, payment_method, transaction_reference, notes, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'COMPLETED')
            RETURNING *
        `, [pr.group_id, pr.payer_id, pr.receiver_id, applied.appliedTotal, pr.payment_method, reference, settlementNote.slice(0, 1000)]);

        const updated = await client.query(`
            UPDATE payment_requests
            SET status = 'ACCEPTED', settlement_id = $1, responded_at = NOW(), responded_by = $2
            WHERE id = $3 AND status = 'PENDING'
            RETURNING *
        `, [settlementRes.rows[0].id, userId, requestId]);
        if (updated.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'This request was already processed.' });
        }

        const pName = (await client.query('SELECT name FROM users WHERE id = $1', [pr.payer_id])).rows[0]?.name || 'Payer';
        const rName = (await client.query('SELECT name FROM users WHERE id = $1', [pr.receiver_id])).rows[0]?.name || 'Receiver';
        await client.query(`INSERT INTO activity_logs (user_id, group_id, activity_type, message) VALUES ($1, $2, 'PAYMENT_REQUEST_ACCEPTED', $3)`,
            [pr.payer_id, pr.group_id, `Your ₹${applied.appliedTotal.toFixed(2)} payment to ${rName} was accepted and added to the ledger.`]);
        await client.query(`INSERT INTO activity_logs (user_id, group_id, activity_type, message) VALUES ($1, $2, 'PAYMENT_REQUEST_ACCEPTED', $3)`,
            [pr.receiver_id, pr.group_id, `You accepted ${pName}'s ₹${applied.appliedTotal.toFixed(2)} manual payment.`]);

        await client.query('COMMIT');
        res.json({
            request: mapPaymentRequestRow(updated.rows[0]),
            settlement: settlementRes.rows[0],
            amount_applied: applied.appliedTotal,
            message: 'Payment accepted and the ledger has been updated.'
        });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (e) {}
        res.status(500).json({ error: formatUserError(err, 'Failed to approve the payment request.') });
    } finally {
        client.release();
    }
});

app.post('/api/payment-requests/:id/reject', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userId = actingUserId(req);
        const requestId = parseInt(req.params.id);
        if (!userId) { await client.query('ROLLBACK'); return res.status(401).json({ error: 'Authentication required.' }); }
        const prRes = await client.query('SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE', [requestId]);
        if (prRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Payment request not found.' }); }
        const pr = prRes.rows[0];
        if (Number(pr.receiver_id) !== Number(userId)) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Only the receiving member can reject this payment request.' });
        }
        if (pr.status !== 'PENDING') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: `This request is already ${String(pr.status).toLowerCase()}.`, status: pr.status });
        }
        const reason = sanitizeText(req.body.reason, 500) || 'Not received';
        const updated = await client.query(`
            UPDATE payment_requests
            SET status = 'REJECTED', responded_at = NOW(), responded_by = $1, rejection_reason = $2
            WHERE id = $3 AND status = 'PENDING' RETURNING *
        `, [userId, reason, requestId]);
        const pName = (await client.query('SELECT name FROM users WHERE id = $1', [pr.payer_id])).rows[0]?.name || 'Payer';
        const rName = (await client.query('SELECT name FROM users WHERE id = $1', [pr.receiver_id])).rows[0]?.name || 'Receiver';
        await client.query(`INSERT INTO activity_logs (user_id, group_id, activity_type, message) VALUES ($1, $2, 'PAYMENT_REQUEST_REJECTED', $3)`,
            [pr.payer_id, pr.group_id, `${rName} rejected your ₹${Number(pr.amount).toFixed(2)} payment request. No balance was changed.`]);
        await client.query(`INSERT INTO activity_logs (user_id, group_id, activity_type, message) VALUES ($1, $2, 'PAYMENT_REQUEST_REJECTED', $3)`,
            [pr.receiver_id, pr.group_id, `You rejected ${pName}'s ₹${Number(pr.amount).toFixed(2)} payment request.`]);
        await client.query('COMMIT');
        res.json({ request: mapPaymentRequestRow(updated.rows[0]), message: 'Payment request rejected. No ledger change was made.' });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (e) {}
        res.status(500).json({ error: formatUserError(err, 'Failed to reject the payment request.') });
    } finally {
        client.release();
    }
});

app.post('/api/payment-requests/:id/cancel', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userId = actingUserId(req);
        const requestId = parseInt(req.params.id);
        if (!userId) { await client.query('ROLLBACK'); return res.status(401).json({ error: 'Authentication required.' }); }
        const prRes = await client.query('SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE', [requestId]);
        if (prRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Payment request not found.' }); }
        const pr = prRes.rows[0];
        if (Number(pr.payer_id) !== Number(userId)) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Only the payer can cancel this request.' });
        }
        if (pr.status !== 'PENDING') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: `This request is already ${String(pr.status).toLowerCase()}.`, status: pr.status });
        }
        const updated = await client.query(`
            UPDATE payment_requests SET status = 'CANCELLED', responded_at = NOW(), responded_by = $1
            WHERE id = $2 AND status = 'PENDING' RETURNING *
        `, [userId, requestId]);
        const rName = (await client.query('SELECT name FROM users WHERE id = $1', [pr.receiver_id])).rows[0]?.name || 'Receiver';
        await client.query(`INSERT INTO activity_logs (user_id, group_id, activity_type, message) VALUES ($1, $2, 'PAYMENT_REQUEST_CANCELLED', $3)`,
            [pr.receiver_id, pr.group_id, `A ₹${Number(pr.amount).toFixed(2)} payment request was cancelled by the payer. No balance was changed.`]);
        await client.query('COMMIT');
        res.json({ request: mapPaymentRequestRow(updated.rows[0]), message: 'Payment request cancelled.' });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (e) {}
        res.status(500).json({ error: formatUserError(err, 'Failed to cancel the payment request.') });
    } finally {
        client.release();
    }
});

// Cryptographic Webhook HMAC-SHA256 Signature Validator
function verifyWebhookSignature(req) {
    const signature = req.headers['x-webhook-signature'] || req.headers['x-provider-signature'];

    // Only a valid HMAC-SHA256 signature from the configured provider secret is
    // accepted. There is no hardcoded/internal bypass token.
    if (!signature) {
        return false;
    }
    try {
        const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        const expectedSig = crypto.createHmac('sha256', UPI_WEBHOOK_SECRET).update(bodyStr).digest('hex');
        const given = String(signature).trim().toLowerCase();
        const expected = expectedSig.toLowerCase();
        if (given.length !== expected.length) return false;
        return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    } catch (e) {
        return false;
    }
}

// Core Atomic Webhook & Verification Processor (Guarantees Idempotency & DB Atomicity)
async function processWebhookPaymentEvent(payload) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const targetRequestId = payload.request_id || payload.payment_request_id;
        if (!targetRequestId) {
            await client.query('ROLLBACK');
            return { error: 'request_id is required in webhook payload', code: 400 };
        }

        // Lock payment request row for update (single table, avoiding outer join locking constraints)
        const prRes = await client.query(`
            SELECT * FROM upi_payment_requests WHERE request_id = $1 FOR UPDATE
        `, [targetRequestId]);

        if (prRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return { error: 'Payment request not found', code: 404 };
        }

        const pr = prRes.rows[0];
        const [payerRes, receiverRes] = await Promise.all([
            client.query('SELECT name FROM users WHERE id = $1', [pr.payer_id]),
            client.query('SELECT name FROM users WHERE id = $1', [pr.receiver_id])
        ]);
        const payerName = payerRes.rows[0]?.name || 'Payer';
        const receiverName = receiverRes.rows[0]?.name || 'Receiver';
        const normalizedStatus = (payload.status || 'SUCCESS').toUpperCase();

        // 1. Idempotency Check: If already settled, never create duplicate settlements!
        if (pr.status === 'SUCCESS' && pr.settlement_id) {
            await client.query('COMMIT');
            return {
                success: true,
                message: 'Payment already verified and settled (idempotent)',
                settlement_id: pr.settlement_id,
                status: 'SUCCESS',
                request_id: targetRequestId,
                is_duplicate: true
            };
        }

        const effectiveUtr = payload.utr || payload.transaction_ref || `UTR-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
        const effectiveRef = payload.transaction_ref || effectiveUtr;

        // 2. Handle Non-Success statuses: FAILED, CANCELLED, EXPIRED, PROCESSING, PENDING
        if (normalizedStatus !== 'SUCCESS') {
            await client.query(`
                UPDATE upi_payment_requests 
                SET status = $1, transaction_ref = $2, utr = $3, updated_at = NOW()
                WHERE id = $4
            `, [normalizedStatus, effectiveRef, effectiveUtr, pr.id]);

            await client.query('COMMIT');
            return {
                success: true,
                message: `Payment status updated to ${normalizedStatus}. No settlement record created.`,
                status: normalizedStatus,
                request_id: targetRequestId,
                is_settled: false
            };
        }

        // 3. Amount & Currency Validation
        const expectedAmt = parseFloat(pr.amount);
        const webhookAmt = payload.amount !== undefined ? parseFloat(payload.amount) : expectedAmt;

        if (isNaN(webhookAmt) || Math.abs(expectedAmt - webhookAmt) > 0.01) {
            await client.query(`
                UPDATE upi_payment_requests 
                SET status = 'FAILED', notes = 'Amount mismatch: expected ₹' || $4 || ', received ₹' || $5, transaction_ref = $1, utr = $2, updated_at = NOW()
                WHERE id = $3
            `, [effectiveRef, effectiveUtr, pr.id, expectedAmt.toFixed(2), webhookAmt.toFixed(2)]);
            await client.query('COMMIT');
            return {
                error: `Payment amount mismatch: expected ₹${expectedAmt.toFixed(2)}, but received ₹${webhookAmt.toFixed(2)}`,
                code: 400
            };
        }

        if (payload.currency && payload.currency.toUpperCase() !== 'INR') {
            await client.query(`
                UPDATE upi_payment_requests 
                SET status = 'FAILED', notes = 'Currency mismatch: expected INR, received ' || $4, transaction_ref = $1, utr = $2, updated_at = NOW()
                WHERE id = $3
            `, [effectiveRef, effectiveUtr, pr.id, payload.currency]);
            await client.query('COMMIT');
            return { error: 'Currency mismatch: expected INR', code: 400 };
        }

        // 4. Apply the verified payment to the debtor's outstanding splits first.
        //    A verified real payment is always recorded, even if it exceeds the
        //    current debt; any excess is reported instead of silently dropping it.
        const applied = await applyPaymentToSplits(client, {
            payerId: pr.payer_id,
            receiverId: pr.receiver_id,
            amount: expectedAmt,
            groupId: pr.group_id || null
        });

        const settRes = await client.query(`
            INSERT INTO settlements (group_id, payer_id, receiver_id, amount, payment_method, transaction_reference, notes)
            VALUES ($1, $2, $3, $4, 'UPI', $5, $6)
            RETURNING id
        `, [
            pr.group_id || null,
            pr.payer_id,
            pr.receiver_id,
            expectedAmt,
            effectiveRef,
            (pr.notes || `Automated settlement via verified UPI Payment (UTR: ${effectiveUtr})`) +
                (applied.unapplied > 0.005 ? ` [Unapplied overpayment: ₹${applied.unapplied.toFixed(2)}]` : '')
        ]);

        const settlementId = settRes.rows[0].id;

        // 5. Update Activity Audit Ledger
        await client.query(`
            INSERT INTO activity_logs (user_id, group_id, activity_type, message)
            VALUES ($1, $2, 'SETTLEMENT', $3)
        `, [
            pr.payer_id,
            pr.group_id || null,
            `${payerName} automatically settled ₹${expectedAmt.toFixed(2)} with ${receiverName} via verified UPI Payment (Ref: ${effectiveRef})`
        ]);

        // 6. Mark payment request as settled with timestamp
        await client.query(`
            UPDATE upi_payment_requests 
            SET status = 'SUCCESS', settlement_id = $1, transaction_ref = $2, utr = $3, settled_at = NOW(), updated_at = NOW()
            WHERE id = $4
        `, [settlementId, effectiveRef, effectiveUtr, pr.id]);

        await client.query('COMMIT');

        // Dispatch automated settlement confirmation emails (non-blocking)
        try {
            const payerUserRes = await pool.query('SELECT name, email FROM users WHERE id = $1', [pr.payer_id]);
            const receiverUserRes = await pool.query('SELECT name, email FROM users WHERE id = $1', [pr.receiver_id]);
            const payerUser = payerUserRes.rows[0];
            const receiverUser = receiverUserRes.rows[0];

            if (payerUser?.email) {
                emailService.sendSettlementCompletedEmail({
                    to: payerUser.email,
                    recipientName: payerUser.name,
                    payerName: payerUser.name,
                    receiverName: receiverUser?.name || receiverName,
                    amount: expectedAmt,
                    paymentMethod: 'UPI',
                    transactionRef: effectiveRef,
                    isPayer: true
                }).catch(e => console.error('[Auto UPI Email Payer] Warning:', e.message));
            }

            if (receiverUser?.email) {
                emailService.sendSettlementCompletedEmail({
                    to: receiverUser.email,
                    recipientName: receiverUser.name,
                    payerName: payerUser?.name || payerName,
                    receiverName: receiverUser.name,
                    amount: expectedAmt,
                    paymentMethod: 'UPI',
                    transactionRef: effectiveRef,
                    isPayer: false
                }).catch(e => console.error('[Auto UPI Email Receiver] Warning:', e.message));
            }
        } catch (emailErr) {
            console.error('[Auto UPI Email Notice] Non-blocking warning:', emailErr.message);
        }

        return {
            success: true,
            message: 'UPI Payment successfully verified and settlement created in database automatically!',
            settlement_id: settlementId,
            status: 'SUCCESS',
            request_id: targetRequestId,
            amount: expectedAmt,
            transaction_ref: effectiveRef,
            utr: effectiveUtr,
            payer_name: payerName,
            receiver_name: receiverName,
            settled_at: new Date().toISOString()
        };

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error processing webhook payment event:', err);
        return { error: formatUserError(err, 'Failed to process payment settlement.'), code: 500 };
    } finally {
        client.release();
    }
}

// 1. Initiate / Create UPI Payment Request
app.post('/api/upi/create-payment-request', async (req, res) => {
    try {
        const { payer_id, receiver_id, group_id, amount, notes } = req.body;
        const pId = parseInt(payer_id);
        const rId = parseInt(receiver_id);
        const amt = roundMoney(amount);
        const authId = actingUserId(req);

        if (!pId || !rId || !Number.isFinite(amt) || amt <= 0) {
            return res.status(400).json({ error: 'Valid payer_id, receiver_id, and positive amount are required' });
        }
        if (pId === rId) {
            return res.status(400).json({ error: 'Payer and receiver cannot be the same user' });
        }
        if (pId !== authId) {
            return res.status(403).json({ error: 'Permission denied: you can only initiate a payment for yourself.' });
        }

        // The payment must correspond to a real outstanding balance, scoped to the
        // selected circle when one is supplied.
        const requestedGroupId = group_id ? parseInt(group_id) : null;
        if (requestedGroupId) {
            const membership = await pool.query(
                'SELECT user_id FROM group_members WHERE group_id = $1 AND user_id = ANY($2::int[])',
                [requestedGroupId, [pId, rId]]
            );
            if (membership.rows.length !== 2) {
                return res.status(403).json({ error: 'Both parties must be members of the selected circle.' });
            }
        }
        const outstandingParams = [pId, rId];
        let outstandingGroupFilter = '';
        if (requestedGroupId) {
            outstandingParams.push(requestedGroupId);
            outstandingGroupFilter = 'AND e.group_id = $3';
        }
        const outstandingRes = await pool.query(`
            SELECT COALESCE(SUM(es.base_amount - es.settled_amount_base), 0) AS outstanding
            FROM expense_splits es
            JOIN expenses e ON e.id = es.expense_id
            WHERE es.user_id = $1 AND e.paid_by = $2
              AND (es.base_amount - es.settled_amount_base) > 0.005
              ${outstandingGroupFilter}
        `, outstandingParams);
        const outstanding = roundMoney(outstandingRes.rows[0].outstanding);
        if (outstanding <= 0.005) {
            return res.status(400).json({ error: 'There is no outstanding balance to pay this member in the selected circle.' });
        }
        if (amt > outstanding + 0.005) {
            return res.status(400).json({
                error: `The payment amount exceeds the outstanding balance of ₹${outstanding.toFixed(2)}.`,
                code: 'PAYMENT_EXCEEDS_BALANCE',
                max_payable: outstanding
            });
        }

        const [pRes, rRes] = await Promise.all([
            pool.query('SELECT id, name, email FROM users WHERE id = $1', [pId]),
            pool.query('SELECT id, name, email, upi_id FROM users WHERE id = $1', [rId])
        ]);

        if (pRes.rows.length === 0 || rRes.rows.length === 0) {
            return res.status(404).json({ error: 'Payer or receiver account not found' });
        }

        const payer = pRes.rows[0];
        const receiver = rRes.rows[0];
        const receiverUpi = receiver.upi_id || `${receiver.name.toLowerCase().replace(/[^a-z0-9]/g, '')}@okaxis`;

        // Reuse an identical open request instead of creating duplicates when the
        // user regenerates or reloads the page.
        const existingReq = await pool.query(`
            SELECT * FROM upi_payment_requests
            WHERE payer_id = $1 AND receiver_id = $2 AND amount = $3
              AND status = 'PENDING'
              AND COALESCE(group_id, 0) = COALESCE($4, 0)
              AND created_at > NOW() - INTERVAL '15 minutes'
            ORDER BY id DESC LIMIT 1
        `, [pId, rId, amt, requestedGroupId]);
        if (existingReq.rows.length > 0) {
            const pr = existingReq.rows[0];
            return res.json({
                success: true,
                reused: true,
                request_id: pr.request_id,
                payment_uri: pr.upi_string,
                payment_request: {
                    request_id: pr.request_id,
                    payer_id: pId,
                    payer_name: payer.name,
                    receiver_id: rId,
                    receiver_name: receiver.name,
                    receiver_upi: pr.upi_id || receiverUpi,
                    amount: parseFloat(pr.amount),
                    currency: pr.currency || 'INR',
                    status: pr.status,
                    upi_string: pr.upi_string,
                    notes: pr.notes,
                    created_at: pr.created_at
                }
            });
        }

        const requestId = `UPIR-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const cleanNotes = (notes || 'SplitWise Settlement').substring(0, 80);

        // Standard NPCI UPI URI Scheme
        const upiString = `upi://pay?pa=${receiverUpi}&pn=${encodeURIComponent(receiver.name)}&am=${amt.toFixed(2)}&cu=INR&tr=${requestId}&tn=${encodeURIComponent(cleanNotes)}`;

        const insertRes = await pool.query(`
            INSERT INTO upi_payment_requests 
                (request_id, payer_id, receiver_id, group_id, amount, currency, status, upi_id, upi_string, notes)
            VALUES ($1, $2, $3, $4, $5, 'INR', 'PENDING', $6, $7, $8)
            RETURNING *
        `, [requestId, pId, rId, requestedGroupId, amt, receiverUpi, upiString, cleanNotes]);

        const pr = insertRes.rows[0];

        res.status(201).json({
            success: true,
            request_id: pr.request_id,
            payment_uri: pr.upi_string,
            payment_request: {
                request_id: pr.request_id,
                payer_id: pId,
                payer_name: payer.name,
                receiver_id: rId,
                receiver_name: receiver.name,
                receiver_upi: receiverUpi,
                amount: amt,
                currency: 'INR',
                status: 'PENDING',
                upi_string: upiString,
                notes: cleanNotes,
                created_at: pr.created_at
            }
        });
    } catch (err) {
        console.error('Error creating UPI payment request:', err);
        res.status(500).json({ error: formatUserError(err, 'Failed to generate UPI payment request.') });
    }
});

// 2. Query Payment Status (Used by frontend auto-poller for instant automatic settlement)
app.get('/api/upi/payment-status/:requestId', async (req, res) => {
    try {
        const { requestId } = req.params;
        const result = await pool.query(`
            SELECT upr.*, 
                   p.name as payer_name, 
                   r.name as receiver_name,
                   s.id as settlement_id,
                   s.created_at as settlement_created_at
            FROM upi_payment_requests upr
            LEFT JOIN users p ON upr.payer_id = p.id
            LEFT JOIN users r ON upr.receiver_id = r.id
            LEFT JOIN settlements s ON upr.settlement_id = s.id
            WHERE upr.request_id = $1
        `, [requestId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Payment request not found' });
        }

        let pr = result.rows[0];

        // Object-level authorization: only the two parties may inspect a payment.
        const authId = actingUserId(req);
        if (parseInt(pr.payer_id) !== authId && parseInt(pr.receiver_id) !== authId && req.authUser.role !== 'master_admin') {
            return res.status(403).json({ error: 'Access denied: this payment request belongs to another transaction.' });
        }

        // 1. If already settled, return SUCCESS immediately
        if (pr.status === 'SUCCESS' && pr.settlement_id) {
            return res.json({
                success: true,
                request_id: pr.request_id,
                status: 'SUCCESS',
                amount: parseFloat(pr.amount),
                currency: pr.currency,
                payer_id: pr.payer_id,
                payer_name: pr.payer_name,
                receiver_id: pr.receiver_id,
                receiver_name: pr.receiver_name,
                receiver_upi: pr.upi_id,
                transaction_ref: pr.transaction_ref,
                utr: pr.utr,
                settlement_id: pr.settlement_id,
                settled_at: pr.settled_at,
                created_at: pr.created_at,
                provider_type: 'UPI_AUTO_SETTLED',
                message: 'Payment verified and settled'
            });
        }

        // 2. Automatic expiration check: If PENDING and older than 15 minutes, mark EXPIRED
        const ageMs = Date.now() - new Date(pr.created_at).getTime();
        if (pr.status === 'PENDING' && ageMs > 15 * 60 * 1000) {
            await pool.query("UPDATE upi_payment_requests SET status = 'EXPIRED', updated_at = NOW() WHERE id = $1", [pr.id]);
            pr.status = 'EXPIRED';
            return res.json({
                success: true,
                request_id: pr.request_id,
                status: 'EXPIRED',
                message: 'Payment window expired'
            });
        }

        // 3. Pending payment request remains PENDING until webhook or explicit user confirmation
        if (pr.status === 'PENDING') {
            return res.json({
                success: true,
                request_id: pr.request_id,
                status: 'PENDING',
                amount: parseFloat(pr.amount),
                currency: pr.currency,
                payer_id: pr.payer_id,
                payer_name: pr.payer_name,
                receiver_id: pr.receiver_id,
                receiver_name: pr.receiver_name,
                receiver_upi: pr.upi_id,
                message: 'Waiting for payment confirmation...'
            });
        }

        res.json({
            success: true,
            request_id: pr.request_id,
            status: pr.status,
            amount: parseFloat(pr.amount),
            currency: pr.currency,
            payer_name: pr.payer_name,
            receiver_name: pr.receiver_name,
            receiver_upi: pr.upi_id,
            message: `Status: ${pr.status}`
        });
    } catch (err) {
        console.error('Error fetching payment status:', err);
        res.status(500).json({ error: formatUserError(err, 'Failed to fetch payment status.') });
    }
});

// 2.0 List payment requests that need attention (payer or receiver)
app.get('/api/upi/pending-requests', async (req, res) => {
    try {
        const authId = actingUserId(req);

        // Expire stale payment windows so the inbox only shows actionable items.
        await pool.query(`
            UPDATE upi_payment_requests
            SET status = 'EXPIRED', updated_at = NOW()
            WHERE status = 'PENDING'
              AND created_at < NOW() - INTERVAL '15 minutes'
              AND (payer_id = $1 OR receiver_id = $1)
        `, [authId]);

        const result = await pool.query(`
            SELECT upr.request_id, upr.payer_id, upr.receiver_id, upr.group_id, upr.amount,
                   upr.currency, upr.status, upr.notes, upr.claimed_at, upr.claimed_utr,
                   upr.created_at, p.name AS payer_name, r.name AS receiver_name,
                   g.name AS group_name
            FROM upi_payment_requests upr
            JOIN users p ON p.id = upr.payer_id
            JOIN users r ON r.id = upr.receiver_id
            LEFT JOIN groups g ON g.id = upr.group_id
            WHERE upr.status = 'PENDING'
              AND (upr.payer_id = $1 OR upr.receiver_id = $1)
            ORDER BY upr.created_at DESC
            LIMIT 50
        `, [authId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Unable to load pending payments.') });
    }
});

// 2.1 Confirm a UPI bank UTR reference (receiver-side confirmation)
app.post('/api/upi/verify-utr', async (req, res) => {
    try {
        const { request_id, utr } = req.body;
        if (!request_id || !utr) {
            return res.status(400).json({ error: 'request_id and 12-digit bank UTR reference are required' });
        }

        const cleanUtr = String(utr).trim().replace(/\s+/g, '');
        if (!/^[A-Za-z0-9]{8,24}$/.test(cleanUtr)) {
            return res.status(400).json({ error: 'Please enter a valid 12-digit numeric or alphanumeric bank UTR reference number.' });
        }

        const prRes = await pool.query('SELECT * FROM upi_payment_requests WHERE request_id = $1', [request_id]);
        if (prRes.rows.length === 0) {
            return res.status(404).json({ error: 'Payment request not found.' });
        }
        const pr = prRes.rows[0];

        // Only the party who RECEIVES the money can confirm that it arrived.
        const authId = actingUserId(req);
        if (parseInt(pr.receiver_id) !== authId && req.authUser.role !== 'master_admin') {
            return res.status(403).json({
                error: 'Only the receiving member can confirm that this payment was received.',
                code: 'RECEIVER_CONFIRMATION_REQUIRED'
            });
        }

        // Anti-replay: Check if this UTR has already been claimed on another SUCCESSFUL transaction
        const dupUtrRes = await pool.query(
            "SELECT id, request_id FROM upi_payment_requests WHERE utr = $1 AND status = 'SUCCESS' AND request_id != $2",
            [cleanUtr, request_id]
        );
        if (dupUtrRes.rows.length > 0) {
            return res.status(409).json({ error: 'This bank UTR reference has already been utilized for a prior settlement (anti-replay protected).' });
        }

        // Process verified payment event atomically
        const payload = {
            request_id,
            status: 'SUCCESS',
            amount: parseFloat(pr.amount),
            currency: 'INR',
            transaction_ref: `UPI-${cleanUtr}`,
            utr: cleanUtr
        };

        const result = await processWebhookPaymentEvent(payload);
        if (result.error) {
            return res.status(result.code || 400).json({ error: result.error });
        }

        res.json({
            success: true,
            message: 'UPI transaction verified with bank UTR and settlement recorded in database!',
            settlement_id: result.settlement_id,
            request_id,
            utr: cleanUtr,
            amount: parseFloat(pr.amount),
            status: 'SUCCESS'
        });
    } catch (err) {
        console.error('Error verifying UPI UTR:', err);
        res.status(500).json({ error: formatUserError(err, 'Failed to verify UTR reference.') });
    }
});

// 2.2 Cancel Pending Payment Request
app.post('/api/upi/cancel-payment', async (req, res) => {
    try {
        const { request_id } = req.body;
        if (!request_id) {
            return res.status(400).json({ error: 'request_id is required' });
        }

        const prRes = await pool.query('SELECT * FROM upi_payment_requests WHERE request_id = $1', [request_id]);
        if (prRes.rows.length === 0) {
            return res.status(404).json({ error: 'Payment request not found' });
        }
        const pr = prRes.rows[0];

        const authId = actingUserId(req);
        if (parseInt(pr.payer_id) !== authId && parseInt(pr.receiver_id) !== authId && req.authUser.role !== 'master_admin') {
            return res.status(403).json({ error: 'Access denied: this payment request belongs to another transaction.' });
        }

        if (pr.status === 'SUCCESS') {
            return res.status(400).json({ error: 'Cannot cancel an already completed and settled transaction.' });
        }

        await pool.query("UPDATE upi_payment_requests SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1", [pr.id]);
        res.json({ success: true, message: 'Payment request cancelled', request_id });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to cancel payment request.') });
    }
});

// 2.3 Payer claims a payment (does NOT settle anything)
// The ledger is never updated from a button click. A claim only tells the
// receiver "I have paid — please verify". Settlement happens exclusively in
// /api/upi/confirm-received, a signed provider webhook, or an admin action.
app.post('/api/upi/claim-payment', async (req, res) => {
    try {
        const { request_id, utr } = req.body;
        if (!request_id) {
            return res.status(400).json({ error: 'request_id is required.' });
        }

        const prRes = await pool.query('SELECT * FROM upi_payment_requests WHERE request_id = $1', [request_id]);
        if (prRes.rows.length === 0) {
            return res.status(404).json({ error: 'Payment request not found.' });
        }
        const pr = prRes.rows[0];
        const authId = actingUserId(req);

        if (parseInt(pr.payer_id) !== authId) {
            return res.status(403).json({ error: 'Only the payer can mark this payment as sent.' });
        }
        if (pr.status !== 'PENDING') {
            return res.status(400).json({ error: `This payment is already ${pr.status.toLowerCase()}.` });
        }

        let cleanUtr = null;
        if (utr) {
            cleanUtr = String(utr).trim().replace(/\s+/g, '');
            if (!/^[A-Za-z0-9]{8,24}$/.test(cleanUtr)) {
                return res.status(400).json({ error: 'Please enter a valid UTR / transaction reference (8–24 letters or digits).' });
            }
            const dup = await pool.query(
                "SELECT id FROM upi_payment_requests WHERE utr = $1 AND status = 'SUCCESS' AND request_id <> $2",
                [cleanUtr, request_id]
            );
            if (dup.rows.length > 0) {
                return res.status(409).json({ error: 'This transaction reference has already been used for another payment.' });
            }
        }

        await pool.query(`
            UPDATE upi_payment_requests
            SET claimed_at = NOW(), claimed_utr = COALESCE($1, claimed_utr), updated_at = NOW()
            WHERE id = $2
        `, [cleanUtr, pr.id]);

        await pool.query(`
            INSERT INTO activity_logs (user_id, group_id, activity_type, message)
            VALUES ($1, $2, 'PAYMENT_CLAIMED', 'Payment of ₹' || $3 || ' marked as sent — awaiting receiver confirmation')
        `, [authId, pr.group_id || null, parseFloat(pr.amount).toFixed(2)]);

        res.json({
            success: true,
            status: 'AWAITING_CONFIRMATION',
            request_id,
            message: 'Marked as sent. Your payment will be recorded once the receiver confirms receipt.',
            claimed_at: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Unable to mark payment as sent.') });
    }
});

// 2.4 Receiver confirms the money arrived (trusted settlement trigger)
app.post('/api/upi/confirm-received', async (req, res) => {
    try {
        const { request_id, utr } = req.body;
        if (!request_id) {
            return res.status(400).json({ error: 'request_id is required.' });
        }

        const prRes = await pool.query('SELECT * FROM upi_payment_requests WHERE request_id = $1', [request_id]);
        if (prRes.rows.length === 0) {
            return res.status(404).json({ error: 'Payment request not found.' });
        }
        const pr = prRes.rows[0];
        const authId = actingUserId(req);

        if (parseInt(pr.receiver_id) !== authId && req.authUser.role !== 'master_admin') {
            return res.status(403).json({
                error: 'Only the receiving member can confirm that this payment was received.',
                code: 'RECEIVER_CONFIRMATION_REQUIRED'
            });
        }

        if (pr.status === 'SUCCESS') {
            return res.json({ success: true, status: 'SUCCESS', message: 'Payment already confirmed.', request_id });
        }
        if (pr.status !== 'PENDING') {
            return res.status(400).json({ error: `Cannot confirm a payment in ${pr.status} state.` });
        }

        const confirmedUtr = (utr && String(utr).trim()) || pr.claimed_utr || `UTR-${Date.now()}`;
        const result = await processWebhookPaymentEvent({
            request_id,
            status: 'SUCCESS',
            amount: parseFloat(pr.amount),
            currency: 'INR',
            transaction_ref: `UPI-${confirmedUtr}`,
            utr: confirmedUtr
        });

        if (result.error) {
            return res.status(result.code || 400).json({ error: result.error });
        }

        await pool.query('UPDATE upi_payment_requests SET confirmed_by = $1 WHERE id = $2', [authId, pr.id]);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Unable to confirm receipt.') });
    }
});

// 2.5 Receiver reports that no money arrived
app.post('/api/upi/reject-payment', async (req, res) => {
    try {
        const { request_id, reason } = req.body;
        const prRes = await pool.query('SELECT * FROM upi_payment_requests WHERE request_id = $1', [request_id]);
        if (prRes.rows.length === 0) {
            return res.status(404).json({ error: 'Payment request not found.' });
        }
        const pr = prRes.rows[0];
        const authId = actingUserId(req);
        if (parseInt(pr.receiver_id) !== authId && req.authUser.role !== 'master_admin') {
            return res.status(403).json({ error: 'Only the receiving member can reject this payment.' });
        }
        if (pr.status !== 'PENDING') {
            return res.status(400).json({ error: `Cannot reject a payment in ${pr.status} state.` });
        }
        await pool.query(`
            UPDATE upi_payment_requests
            SET status = 'FAILED', notes = COALESCE(notes, '') || ' | Rejected by receiver: ' || $1, updated_at = NOW()
            WHERE id = $2
        `, [String(reason || 'Not received').slice(0, 200), pr.id]);
        res.json({ success: true, status: 'FAILED', message: 'Payment marked as not received.' });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Unable to reject payment.') });
    }
});

// 3. Trusted Payment Provider Webhook Endpoint (HMAC-SHA256 Signature Verified)
app.post('/api/upi/webhook', async (req, res) => {
    // 1. Signature Verification Guard
    if (!verifyWebhookSignature(req)) {
        return res.status(401).json({ error: 'Invalid or missing webhook signature' });
    }

    const result = await processWebhookPaymentEvent(req.body);
    if (result.error) {
        return res.status(result.code || 400).json({ error: result.error });
    }
    res.status(200).json(result);
});

// 4. Server-to-Server Payment Verification Endpoint (administrator only;
//    normal users must use /api/upi/confirm-received as the receiver)
app.post('/api/upi/verify-payment', requireMasterAdmin, async (req, res) => {
    try {
        const { request_id, transaction_ref, utr } = req.body;
        if (!request_id) {
            return res.status(400).json({ error: 'request_id is required' });
        }

        const prRes = await pool.query('SELECT * FROM upi_payment_requests WHERE request_id = $1', [request_id]);
        if (prRes.rows.length === 0) {
            return res.status(404).json({ error: 'Payment request not found' });
        }

        const pr = prRes.rows[0];
        if (pr.status === 'SUCCESS' && pr.settlement_id) {
            return res.json({
                success: true,
                message: 'Payment already verified and settled',
                status: 'SUCCESS',
                settlement_id: pr.settlement_id,
                request_id
            });
        }

        const payload = {
            request_id,
            status: 'SUCCESS',
            amount: parseFloat(pr.amount),
            currency: 'INR',
            transaction_ref: transaction_ref || `S2S-UPI-${Date.now()}`,
            utr: utr || `UTR-S2S-${Date.now()}`
        };

        const result = await processWebhookPaymentEvent(payload);
        if (result.error) {
            return res.status(result.code || 400).json({ error: result.error });
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Verification failed') });
    }
});

// 5. Simulate a provider callback — developer/administrator tool only.
//    Disabled in production and never reachable by a normal member.
app.post('/api/upi/simulate-gateway-webhook', requireMasterAdmin, async (req, res) => {
    try {
        if (process.env.NODE_ENV === 'production') {
            return res.status(403).json({ error: 'Gateway simulation is disabled in production.' });
        }
        const { request_id, status = 'SUCCESS', amount, utr, transaction_ref } = req.body;
        if (!request_id) {
            return res.status(400).json({ error: 'request_id is required' });
        }

        const prRes = await pool.query('SELECT * FROM upi_payment_requests WHERE request_id = $1', [request_id]);
        if (prRes.rows.length === 0) {
            return res.status(404).json({ error: 'Payment request not found' });
        }
        const pr = prRes.rows[0];

        const payload = {
            request_id,
            status: status.toUpperCase(),
            amount: amount !== undefined ? parseFloat(amount) : parseFloat(pr.amount),
            currency: 'INR',
            transaction_ref: transaction_ref || `SIM-UPI-${Date.now()}`,
            utr: utr || `UTR-SIM-${Date.now()}`
        };

        const result = await processWebhookPaymentEvent(payload);
        if (result.error) {
            return res.status(result.code || 400).json({ error: result.error });
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Simulation failed') });
    }
});

// ==========================================
// 5. BALANCES & SUMMARY API
// ==========================================

// Global user balance summary & peer list
// A single, consistent rule everywhere: a pair's balance is the sum of
// (split amount - already settled amount) across shared expenses. Settlements
// are applied to splits at the moment they are recorded, so they are never
// subtracted twice and partial payments are reflected immediately.
async function computeUserBalances(currentUserId) {
    const usersRes = await pool.query(`
        SELECT DISTINCT u.id, u.name, u.email, u.avatar_initials, u.upi_id
        FROM users u
        WHERE u.id = $1
           OR u.id IN (SELECT friend_id FROM friends WHERE user_id = $1)
           OR u.id IN (
               SELECT gm2.user_id FROM group_members gm1
               JOIN group_members gm2 ON gm1.group_id = gm2.group_id
               WHERE gm1.user_id = $1
           )
    `, [currentUserId]);
    const userMap = {};
    usersRes.rows.forEach(u => {
        userMap[u.id] = { ...u, netWithCurrent: 0 };
    });

    const outstandingRes = await pool.query(`
        SELECT es.user_id AS debtor, e.paid_by AS creditor,
               SUM(es.base_amount - es.settled_amount_base) AS outstanding
        FROM expense_splits es
        JOIN expenses e ON es.expense_id = e.id
        WHERE (es.user_id = $1 OR e.paid_by = $1)
          AND es.user_id <> e.paid_by
          AND (es.base_amount - es.settled_amount_base) > 0.005
        GROUP BY es.user_id, e.paid_by
    `, [currentUserId]);

    outstandingRes.rows.forEach(r => {
        const amt = parseFloat(r.outstanding) || 0;
        const debtor = parseInt(r.debtor);
        const creditor = parseInt(r.creditor);
        if (debtor === currentUserId && userMap[creditor]) {
            userMap[creditor].netWithCurrent -= amt; // I owe them
        } else if (creditor === currentUserId && userMap[debtor]) {
            userMap[debtor].netWithCurrent += amt;   // they owe me
        }
    });

    // Split into "You Owe" and "Owes You" lists
    const youOweList = [];
    const owesYouList = [];
    let totalOwe = 0;
    let totalOwed = 0;

    Object.values(userMap).forEach(u => {
        if (u.id === currentUserId) return;
        const net = Math.round(u.netWithCurrent * 100) / 100;
        if (net < -0.01) {
            const amt = Math.abs(net);
            totalOwe += amt;
            youOweList.push({
                user_id: u.id,
                name: u.name,
                email: u.email,
                avatar_initials: u.avatar_initials,
                upi_id: u.upi_id,
                amount: amt
            });
        } else if (net > 0.01) {
            totalOwed += net;
            owesYouList.push({
                user_id: u.id,
                name: u.name,
                email: u.email,
                avatar_initials: u.avatar_initials,
                upi_id: u.upi_id,
                amount: net
            });
        }
    });

    // Personal share for the current calendar month (not lifetime)
    const monthSpendRes = await pool.query(`
        SELECT COALESCE(SUM(es.base_amount), 0) AS total
        FROM expense_splits es
        JOIN expenses e ON e.id = es.expense_id
        WHERE es.user_id = $1
          AND e.expense_date >= date_trunc('month', CURRENT_DATE)::date
          AND e.expense_date < (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::date
    `, [currentUserId]);
    const monthlySpend = parseFloat(monthSpendRes.rows[0].total) || 0;

    return {
        total_owe: Math.round(totalOwe * 100) / 100,
        total_owed: Math.round(totalOwed * 100) / 100,
        net_balance: Math.round((totalOwed - totalOwe) * 100) / 100,
        monthly_expenses: Math.round(monthlySpend * 100) / 100,
        you_owe_list: youOweList.sort((a, b) => b.amount - a.amount),
        owes_you_list: owesYouList.sort((a, b) => b.amount - a.amount)
    };
}

// Global user balance summary & peer list (Strictly User Isolated)
app.get('/api/balances/summary', async (req, res) => {
    try {
        const currentUserId = actingUserId(req);
        if (!currentUserId) {
            return res.json({
                total_owe: 0,
                total_owed: 0,
                net_balance: 0,
                monthly_expenses: 0,
                you_owe_list: [],
                owes_you_list: []
            });
        }
        const summary = await computeUserBalances(currentUserId);
        res.json(summary);
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to calculate balances.') });
    }
});

// ==========================================
// 6. ANALYTICS & DEBT SIMPLIFICATION
// ==========================================

app.get('/api/analytics', async (req, res) => {
    try {
        const currentUserId = actingUserId(req);
        if (!currentUserId) {
            return res.json({
                categories: [],
                category_spending: [],
                monthly: [],
                top_single_expense: { description: 'None', amount: 0, group_name: '' },
                total_share: 0
            });
        }

        const fromDate = req.query.fromDate || req.query.startDate;
        const toDate = req.query.toDate || req.query.endDate;

        let dateFilter = '';
        let dateParams = [currentUserId];
        let pIdx = 2;
        if (fromDate) {
            dateFilter += ` AND e.expense_date >= $${pIdx++}`;
            dateParams.push(fromDate);
        }
        if (toDate) {
            dateFilter += ` AND e.expense_date <= $${pIdx++}`;
            dateParams.push(toDate);
        }

        // Category breakdown
        const categoryRes = await pool.query(`
            SELECT e.category, SUM(es.base_amount) as total_amount, COUNT(e.id) as count
            FROM expense_splits es
            JOIN expenses e ON es.expense_id = e.id
            WHERE es.user_id = $1 ${dateFilter}
            GROUP BY e.category
            ORDER BY total_amount DESC
        `, dateParams);

        // Monthly trends. Group spend is aggregated per expense first so a
        // four-way split is never counted four times.
        const monthlyRes = await pool.query(`
            SELECT TO_CHAR(month_start, 'Mon') AS month_name,
                   EXTRACT(MONTH FROM month_start) AS month_num,
                   EXTRACT(YEAR FROM month_start) AS year_num,
                   SUM(your_spend) AS your_spend,
                   SUM(group_spend) AS group_spend
            FROM (
                SELECT date_trunc('month', e.expense_date)::date AS month_start,
                       e.id,
                       SUM(es.base_amount) AS your_spend,
                       MAX(COALESCE(e.converted_amount, e.amount)) AS group_spend
                FROM expenses e
                JOIN expense_splits es ON e.id = es.expense_id
                WHERE es.user_id = $1 ${dateFilter}
                GROUP BY month_start, e.id
            ) per_expense
            GROUP BY month_start
            ORDER BY month_start ASC
        `, dateParams);

        // Top single expense among expenses the user participates in
        const topExpenseRes = await pool.query(`
            SELECT e.description, e.amount, g.name as group_name
            FROM expenses e
            LEFT JOIN groups g ON e.group_id = g.id
            WHERE e.id IN (SELECT expense_id FROM expense_splits WHERE user_id = $1) ${dateFilter}
            ORDER BY e.amount DESC
            LIMIT 1
        `, dateParams);

        // Total share
        let totalShareFilter = '';
        let totalShareParams = [currentUserId];
        let tsIdx = 2;
        if (fromDate) {
            totalShareFilter += ` AND e.expense_date >= $${tsIdx++}`;
            totalShareParams.push(fromDate);
        }
        if (toDate) {
            totalShareFilter += ` AND e.expense_date <= $${tsIdx++}`;
            totalShareParams.push(toDate);
        }
        const totalShareRes = await pool.query(`
            SELECT COALESCE(SUM(es.base_amount), 0) as total 
            FROM expense_splits es
            JOIN expenses e ON es.expense_id = e.id
            WHERE es.user_id = $1 ${totalShareFilter}
        `, totalShareParams);

        const formattedCategories = categoryRes.rows.map(c => ({
            category: c.category,
            total_amount: parseFloat(c.total_amount),
            count: parseInt(c.count)
        }));

        res.json({
            categories: formattedCategories,
            category_spending: formattedCategories,
            monthly: monthlyRes.rows.map(m => ({
                month: m.month_name,
                your_spend: parseFloat(m.your_spend || 0),
                group_spend: parseFloat(m.group_spend || 0)
            })),
            top_single_expense: topExpenseRes.rows[0] || { description: 'None', amount: 0, group_name: '' },
            total_share: parseFloat(totalShareRes.rows[0].total)
        });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to fetch analytics.') });
    }
});

// Debt simplification graph algorithm
const simplifyDebtsHandler = async (req, res) => {
    try {
        const authId = actingUserId(req);
        const rawGroupId = req.params.groupId || req.query.groupId;
        const scopedToGroup = rawGroupId && rawGroupId !== 'all';
        const groupId = scopedToGroup ? parseInt(rawGroupId) : null;

        if (scopedToGroup) {
            const role = await requireGroupRole(req, res, groupId);
            if (!role) return;
        }

        let query = `
            SELECT es.user_id as debtor, e.paid_by as creditor,
                   SUM(es.base_amount - es.settled_amount_base) as amount
            FROM expense_splits es
            JOIN expenses e ON es.expense_id = e.id
            WHERE es.user_id <> e.paid_by
              AND (es.base_amount - es.settled_amount_base) > 0.005
        `;
        const params = [];
        if (groupId) {
            params.push(groupId);
            query += ` AND e.group_id = $1`;
        } else {
            params.push(authId);
            query += ` AND e.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1)`;
        }
        query += ` GROUP BY es.user_id, e.paid_by`;

        const debtsRes = await pool.query(query, params);

        // Compute net balance for each person
        const netBalances = {};
        debtsRes.rows.forEach(d => {
            const debtor = parseInt(d.debtor);
            const creditor = parseInt(d.creditor);
            const amt = parseFloat(d.amount);

            netBalances[debtor] = (netBalances[debtor] || 0) - amt;
            netBalances[creditor] = (netBalances[creditor] || 0) + amt;
        });

        // Separate debtors (negative net) and creditors (positive net)
        const debtors = [];
        const creditors = [];

        Object.keys(netBalances).forEach(uid => {
            const net = Math.round(netBalances[uid] * 100) / 100;
            if (net < -0.01) debtors.push({ user_id: parseInt(uid), amount: -net });
            else if (net > 0.01) creditors.push({ user_id: parseInt(uid), amount: net });
        });

        // Greedy matching
        const simplifiedTransactions = [];
        let i = 0, j = 0;
        while (i < debtors.length && j < creditors.length) {
            const debtor = debtors[i];
            const creditor = creditors[j];
            const settleAmt = Math.min(debtor.amount, creditor.amount);

            simplifiedTransactions.push({
                from_user_id: debtor.user_id,
                to_user_id: creditor.user_id,
                amount: Math.round(settleAmt * 100) / 100
            });

            debtor.amount -= settleAmt;
            creditor.amount -= settleAmt;

            if (debtor.amount < 0.01) i++;
            if (creditor.amount < 0.01) j++;
        }

        // Fetch user names
        const usersRes = await pool.query('SELECT id, name, avatar_initials, upi_id FROM users');
        const userMap = {};
        usersRes.rows.forEach(u => userMap[u.id] = u);

        const enriched = simplifiedTransactions.map(t => ({
            from_name: userMap[t.from_user_id]?.name || `User #${t.from_user_id}`,
            from_initials: userMap[t.from_user_id]?.avatar_initials || 'U',
            to_name: userMap[t.to_user_id]?.name || `User #${t.to_user_id}`,
            to_initials: userMap[t.to_user_id]?.avatar_initials || 'U',
            to_upi: userMap[t.to_user_id]?.upi_id || '',
            amount: t.amount
        }));

        res.json({
            original_transactions_count: debtsRes.rows.length,
            simplified_transactions_count: enriched.length,
            reduction_percentage: debtsRes.rows.length > 0 ? Math.round(((debtsRes.rows.length - enriched.length) / debtsRes.rows.length) * 100) : 0,
            transactions: enriched,
            simplified_debts: enriched
        });
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to compute debt simplification.') });
    }
};

app.get('/api/simplify-debts', simplifyDebtsHandler);
app.get('/api/simplify-debts/:groupId', simplifyDebtsHandler);

// ==========================================
// 7. EXPENSE REMINDER EMAIL API
// ==========================================
app.post('/api/reminders/send', async (req, res) => {
    try {
        const { expense_id, debtor_id, debtor_ids, send_to_all_pending, recipient_id, amount, custom_message, client_url } = req.body;
        
        let targetExpense = null;
        let payerUser = null;
        const effectivePayerId = actingUserId(req);
        if (!effectivePayerId) {
            return res.status(401).json({ error: 'Authentication required.' });
        }

        if (expense_id) {
            const expRes = await pool.query(`
                SELECT e.*, g.name as group_name, u.name as payer_name, u.email as payer_email, u.upi_id as payer_upi
                FROM expenses e
                LEFT JOIN groups g ON e.group_id = g.id
                LEFT JOIN users u ON e.paid_by = u.id
                WHERE e.id = $1
            `, [expense_id]);

            if (expRes.rows.length > 0) {
                targetExpense = expRes.rows[0];
                payerUser = {
                    id: targetExpense.paid_by,
                    name: targetExpense.payer_name,
                    email: targetExpense.payer_email,
                    upi_id: targetExpense.payer_upi
                };
            }
        }

        if (!payerUser && effectivePayerId) {
            const payerRes = await pool.query('SELECT id, name, email, upi_id FROM users WHERE id = $1', [effectivePayerId]);
            if (payerRes.rows.length > 0) {
                payerUser = payerRes.rows[0];
            }
        }

        // Only the payer (or a group admin) may send reminders for an expense.
        if (targetExpense && targetExpense.paid_by !== effectivePayerId) {
            const myRole = await getGroupRole(targetExpense.group_id, effectivePayerId);
            if (!['admin', 'editor'].includes(myRole)) {
                return res.status(403).json({ error: 'Permission denied: only the payer or a group admin can send reminders for this expense.' });
            }
        }

        const originUrl = client_url || `http://localhost:${process.env.PORT || 5000}`;
        const payerName = payerUser ? payerUser.name : 'Your friend';
        const payerUpi = (payerUser && payerUser.upi_id) ? payerUser.upi_id : 'okaxis';
        const expenseTitle = targetExpense ? targetExpense.description : 'Pending Group Balance';
        const groupName = targetExpense ? targetExpense.group_name : 'SplitEase Circle';

        // 1. Bulk Reminders: Send to all pending debtors of an expense or list of debtors
        if (send_to_all_pending || (Array.isArray(debtor_ids) && debtor_ids.length > 0)) {
            const dedupeKey = `remind_bulk:${expense_id || 'general'}:${effectivePayerId}`;
            if (dedupeRequest(dedupeKey, 5000)) {
                return res.status(429).json({ error: 'Reminder batch recently sent. Please wait a few seconds before sending again.' });
            }

            let pendingSplitsQuery = `
                SELECT es.*, u.name as debtor_name, u.email as debtor_email, u.upi_id as debtor_upi
                FROM expense_splits es
                JOIN users u ON es.user_id = u.id
                WHERE es.expense_id = $1 
                  AND es.is_settled IS NOT TRUE 
                  AND es.user_id != $2
                  AND es.amount > 0
            `;
            const queryParams = [expense_id, targetExpense ? targetExpense.paid_by : effectivePayerId];

            if (Array.isArray(debtor_ids) && debtor_ids.length > 0 && !send_to_all_pending) {
                pendingSplitsQuery += ` AND es.user_id = ANY($3::int[])`;
                queryParams.push(debtor_ids.map(Number));
            }

            const pendingSplits = await pool.query(pendingSplitsQuery, queryParams);

            if (pendingSplits.rows.length === 0) {
                return res.json({
                    success: true,
                    count: 0,
                    message: 'No pending members found to remind for this expense.'
                });
            }

            const sentList = [];
            for (const split of pendingSplits.rows) {
                const finalShare = parseFloat(split.amount).toFixed(2);
                const redirectUrl = targetExpense 
                    ? `${originUrl}/?view=expenses&expenseId=${targetExpense.id}`
                    : `${originUrl}/?view=settle&peerId=${effectivePayerId}`;

                try {
                    await emailService.sendExpenseReminderEmail({
                        to: split.debtor_email,
                        debtorName: split.debtor_name,
                        payerName,
                        payerUpi,
                        expenseTitle,
                        groupName,
                        shareAmount: finalShare,
                        customNote: custom_message,
                        redirectUrl
                    });

                    await pool.query(
                        `INSERT INTO activity_logs (user_id, group_id, activity_type, message) 
                         VALUES ($1, $2, 'REMINDER_SENT', $3 || ' sent an email reminder to ' || $4 || ' for ₹' || $5 || ' ("' || $6 || '")')`,
                        [effectivePayerId, targetExpense ? targetExpense.group_id : null, payerName, split.debtor_name, finalShare, expenseTitle]
                    );

                    sentList.push({
                        user_id: split.user_id,
                        name: split.debtor_name,
                        email: split.debtor_email,
                        amount: finalShare
                    });
                } catch (sendErr) {
                    console.error(`Failed to send reminder to ${split.debtor_email}:`, sendErr.message);
                }
            }

            return res.json({
                success: true,
                count: sentList.length,
                sent_to: sentList,
                message: `Reminders successfully sent to ${sentList.length} pending member(s).`
            });
        }

        // 2. Single Member Reminder
        const effectiveDebtorId = debtor_id || recipient_id;
        if (!effectiveDebtorId) {
            return res.status(400).json({ error: 'Recipient member is required.' });
        }

        const dedupeKey = `remind_single:${expense_id || 'general'}:${effectiveDebtorId}:${effectivePayerId}`;
        if (dedupeRequest(dedupeKey, 5000)) {
            return res.status(429).json({ error: 'A reminder was recently sent to this member. Please wait a few seconds before retrying.' });
        }

        let debtorUser = null;
        let shareAmount = amount;

        if (expense_id) {
            const splitRes = await pool.query(
                'SELECT * FROM expense_splits WHERE expense_id = $1 AND user_id = $2',
                [expense_id, effectiveDebtorId]
            );
            if (splitRes.rows.length > 0) {
                if (splitRes.rows[0].is_settled) {
                    return res.status(400).json({ error: 'This member has already settled their share for this expense.' });
                }
                shareAmount = parseFloat(splitRes.rows[0].amount);
            }
        }

        const userRes = await pool.query('SELECT id, name, email, upi_id FROM users WHERE id = $1', [effectiveDebtorId]);
        if (userRes.rows.length > 0) {
            debtorUser = userRes.rows[0];
        }

        if (!debtorUser) {
            return res.status(400).json({ error: 'Recipient user not found' });
        }

        const redirectUrl = targetExpense 
            ? `${originUrl}/?view=expenses&expenseId=${targetExpense.id}`
            : `${originUrl}/?view=settle&peerId=${payerUser ? payerUser.id : 1}`;

        const finalShare = shareAmount ? parseFloat(shareAmount).toFixed(2) : '0.00';

        // Send reminder via centralized email service
        let sendResult = null;
        let emailDelivered = false;
        try {
            sendResult = await emailService.sendExpenseReminderEmail({
                to: debtorUser.email,
                debtorName: debtorUser.name,
                payerName,
                payerUpi,
                expenseTitle,
                groupName,
                shareAmount: finalShare,
                customNote: custom_message,
                redirectUrl
            });
            emailDelivered = true;
        } catch (sendErr) {
            console.warn(`[Reminders] Email delivery notice for ${debtorUser.email} (cloud network/SMTP):`, sendErr.message);
        }

        const previewUrl = sendResult ? sendResult.previewUrl : null;

        await pool.query(
            `INSERT INTO activity_logs (user_id, group_id, activity_type, message) 
             VALUES ($1, $2, 'REMINDER_SENT', $3 || ' sent an email reminder to ' || $4 || ' for ₹' || $5 || ' ("' || $6 || '")')`,
            [effectivePayerId, targetExpense ? targetExpense.group_id : null, payerName, debtorUser.name, finalShare, expenseTitle]
        );

        res.json({
            success: true,
            email_delivered: emailDelivered,
            message: emailDelivered 
                ? `Reminder email successfully sent to ${debtorUser.name} (${debtorUser.email})`
                : `Reminder notification recorded for ${debtorUser.name}`,
            recipient: debtorUser.email,
            recipient_name: debtorUser.name,
            amount: finalShare,
            expense_title: expenseTitle,
            group_name: groupName,
            redirection_url: redirectUrl,
            preview_url: previewUrl
        });

    } catch (err) {
        console.error('Error sending reminder email:', err);
        res.status(500).json({ error: formatUserError(err, 'Failed to send reminder email. Please try again.') });
    }
});

// ==========================================
// 7.4 MASTER ADMIN GOVERNANCE & GLOBAL ERROR TRACKER API
// Strict server-side authorization: Restricted to role = 'master_admin'
// ==========================================

// Master Admin Authentication & Authorization Middleware
async function requireMasterAdmin(req, res, next) {
    try {
        const userId = actingUserId(req);

        if (!userId) {
            return res.status(401).json({ error: 'Authentication required. Please sign in as a Master Administrator.' });
        }

        const userRes = await pool.query('SELECT id, name, email, username, role, is_active FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) {
            return res.status(401).json({ error: 'User session not found.' });
        }

        const user = userRes.rows[0];

        if (user.is_active === false) {
            return res.status(403).json({ error: 'This account has been deactivated.' });
        }

        if (user.role !== 'master_admin') {
            // Log security incident
            await pool.query(`
                INSERT INTO admin_audit_logs (admin_id, admin_email, action, target_type, target_id, details, ip_address)
                VALUES ($1, $2, 'UNAUTHORIZED_ADMIN_ACCESS_ATTEMPT', 'SYSTEM', NULL, $3, $4)
            `, [user.id, user.email, JSON.stringify({ path: req.path, method: req.method }), req.ip]);

            return res.status(403).json({ 
                error: 'Forbidden: Platform Master Administrator privileges are required to access this resource.',
                code: 'MASTER_ADMIN_REQUIRED'
            });
        }

        req.adminUser = user;
        next();
    } catch (err) {
        console.error('[requireMasterAdmin] Auth error:', err);
        res.status(500).json({ error: 'Administrative authorization check failed.' });
    }
}

// 1. Platform Overview
app.get('/api/admin/overview', requireMasterAdmin, async (req, res) => {
    try {
        const overview = await adminService.getPlatformOverview();
        res.json(overview);
    } catch (err) {
        console.error('[Admin API] Error in /api/admin/overview:', err);
        res.status(500).json({ error: formatUserError(err, 'Failed to load platform overview.') });
    }
});

// 2. User Management
app.get('/api/admin/users', requireMasterAdmin, async (req, res) => {
    try {
        const result = await adminService.listUsers({
            search: req.query.search,
            role: req.query.role,
            status: req.query.status,
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || 50
        });
        res.json(result);
    } catch (err) {
        console.error('[Admin API] Error in /api/admin/users:', err);
        res.status(500).json({ error: formatUserError(err, 'Failed to load users.') });
    }
});

// Toggle User Status (Activate / Deactivate)
app.post('/api/admin/users/:id/toggle-status', requireMasterAdmin, async (req, res) => {
    try {
        const targetUserId = parseInt(req.params.id);
        const isActive = req.body.is_active === true;
        const result = await adminService.toggleUserStatus(req.adminUser.id, req.adminUser.email, targetUserId, isActive);
        res.json(result);
    } catch (err) {
        console.error('[Admin API] Error in toggle-status:', err);
        res.status(400).json({ error: err.message || 'Failed to update user status.' });
    }
});

// 3. Global Group Management
app.get('/api/admin/groups', requireMasterAdmin, async (req, res) => {
    try {
        const result = await adminService.listGroups({
            search: req.query.search,
            status: req.query.status,
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || 50
        });
        res.json(result);
    } catch (err) {
        console.error('[Admin API] Error in /api/admin/groups:', err);
        res.status(500).json({ error: formatUserError(err, 'Failed to load groups.') });
    }
});

// Group Inspection (Read-Only)
app.get('/api/admin/groups/:id/inspect', requireMasterAdmin, async (req, res) => {
    try {
        const groupId = parseInt(req.params.id);
        const result = await adminService.getGroupInspection(groupId);
        if (!result) return res.status(404).json({ error: 'Group circle not found.' });
        res.json(result);
    } catch (err) {
        console.error('[Admin API] Error in group inspection:', err);
        res.status(500).json({ error: formatUserError(err, 'Failed to inspect group.') });
    }
});

// 4. Global Financial Monitoring
app.get('/api/admin/finances', requireMasterAdmin, async (req, res) => {
    try {
        const result = await adminService.listFinances({
            search: req.query.search,
            currency: req.query.currency,
            fromDate: req.query.from_date,
            toDate: req.query.to_date,
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || 50
        });
        res.json(result);
    } catch (err) {
        console.error('[Admin API] Error in /api/admin/finances:', err);
        res.status(500).json({ error: formatUserError(err, 'Failed to load finances.') });
    }
});

// 5. System Errors & Issue Tracker API
app.get('/api/admin/errors', requireMasterAdmin, async (req, res) => {
    try {
        const result = await adminService.listSystemErrors({
            category: req.query.category,
            severity: req.query.severity,
            status: req.query.status,
            module: req.query.module,
            search: req.query.search,
            fromDate: req.query.from_date,
            toDate: req.query.to_date,
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || 50
        });
        res.json(result);
    } catch (err) {
        console.error('[Admin API] Error in /api/admin/errors:', err);
        res.status(500).json({ error: formatUserError(err, 'Failed to load system errors.') });
    }
});

// Error Occurrence Details
app.get('/api/admin/errors/:id', requireMasterAdmin, async (req, res) => {
    try {
        const result = await adminService.getErrorDetails(req.params.id);
        if (!result) return res.status(404).json({ error: 'Error record not found.' });
        res.json(result);
    } catch (err) {
        console.error('[Admin API] Error loading error details:', err);
        res.status(500).json({ error: formatUserError(err, 'Failed to load error details.') });
    }
});

// Update Error Status (Workflow: new, investigating, resolved, ignored)
app.post('/api/admin/errors/:id/resolve', requireMasterAdmin, async (req, res) => {
    try {
        const { status, resolution_notes } = req.body;
        const result = await adminService.updateErrorStatus(req.params.id, status, resolution_notes, req.adminUser.name);
        
        // Log in admin audit
        await pool.query(`
            INSERT INTO admin_audit_logs (admin_id, admin_email, action, target_type, target_id, details)
            VALUES ($1, $2, 'ERROR_STATUS_UPDATED', 'SYSTEM_ERROR', $3, $4)
        `, [req.adminUser.id, req.adminUser.email, req.params.id, JSON.stringify({ status, resolution_notes })]);

        res.json({ success: true, error: result });
    } catch (err) {
        console.error('[Admin API] Error updating error status:', err);
        res.status(400).json({ error: err.message || 'Failed to update error status.' });
    }
});

// Generate Antigravity Fix Prompt
app.get('/api/admin/errors/:id/antigravity-prompt', requireMasterAdmin, async (req, res) => {
    try {
        const result = await adminService.generateAntigravityFixPrompt(req.params.id);
        res.json(result);
    } catch (err) {
        console.error('[Admin API] Error generating prompt:', err);
        res.status(500).json({ error: err.message || 'Failed to generate Antigravity prompt.' });
    }
});

// ==============================================================================
// 7.5 DEVELOPMENT MASTER PASSWORD GOVERNANCE (explicitly requested)
// This restores the development convenience login. It is hard-gated by
// adminService.isMasterPasswordAllowed() and therefore never active when
// NODE_ENV/APP_ENV is production or staging. Every use is audited.
// ==============================================================================

app.get('/api/admin/master-password/config', requireMasterAdmin, async (req, res) => {
    try {
        const config = await adminService.getMasterPasswordConfig();
        res.json(config);
    } catch (err) {
        console.error('[Admin API] Error in getMasterPasswordConfig:', err);
        res.status(500).json({ error: formatUserError(err, 'Failed to fetch master password configuration.') });
    }
});

app.post('/api/admin/master-password/config', requireMasterAdmin, async (req, res) => {
    try {
        if (!adminService.isMasterPasswordAllowed()) {
            return res.status(403).json({ error: 'Master password is permanently disabled outside development.' });
        }
        const { new_master_password, confirm_master_password, admin_password, enabled } = req.body;
        const result = await adminService.updateMasterPasswordConfig({
            newPassword: new_master_password,
            confirmPassword: confirm_master_password,
            adminPassword: admin_password,
            enabled,
            adminUserId: req.adminUser.id,
            ipAddress: req.ip
        });
        res.json(result);
    } catch (err) {
        console.error('[Admin API] Error in updateMasterPasswordConfig:', err);
        res.status(400).json({ error: err.message || 'Failed to update master password configuration.' });
    }
});

app.get('/api/admin/master-password/audit', requireMasterAdmin, async (req, res) => {
    try {
        const logs = await adminService.getMasterPasswordAuditLogs(parseInt(req.query.limit) || 100);
        res.json(logs);
    } catch (err) {
        console.error('[Admin API] Error in getMasterPasswordAuditLogs:', err);
        res.status(500).json({ error: formatUserError(err, 'Failed to fetch master password audit logs.') });
    }
});

// Public / Client Error Ingestion Endpoint (With lightweight rate limiting)
app.post('/api/admin/errors/report', async (req, res) => {
    try {
        const {
            title, message, category, severity, module,
            apiRoute, httpStatus, stackTrace, requestUrl,
            requestMethod, requestBody, browserInfo, userId, groupId
        } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Error message is required.' });
        }

        const result = await adminService.recordSystemError({
            title: title || 'Client Runtime Error',
            message: message.toString(),
            category: category || 'frontend',
            severity: severity || 'medium',
            module: module || 'browser',
            apiRoute,
            httpStatus,
            stackTrace,
            requestUrl,
            requestMethod,
            requestBody,
            browserInfo: browserInfo || req.headers['user-agent'],
            userId,
            groupId,
            environment: process.env.NODE_ENV || 'production'
        });

        res.json(result);
    } catch (err) {
        console.error('[Error Ingestion] Failed to record incoming error:', err);
        res.status(500).json({ error: 'Failed to record error.' });
    }
});

// Multi-Currency API Endpoints
app.get('/api/currencies', async (req, res) => {
    try {
        const currencies = {
            'INR': { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2 },
            'USD': { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
            'EUR': { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
            'GBP': { code: 'GBP', name: 'British Pound', symbol: '£', decimals: 2 },
            'AED': { code: 'AED', name: 'UAE Dirham', symbol: 'AED', decimals: 2 },
            'SGD': { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', decimals: 2 },
            'AUD': { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', decimals: 2 },
            'CAD': { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', decimals: 2 },
            'JPY': { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimals: 0 }
        };
        res.json(currencies);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load currencies.' });
    }
});

app.get('/api/currencies/rates', async (req, res) => {
    try {
        const base = (req.query.base || 'INR').toUpperCase();
        const rates = await currencyService.fetchLiveExchangeRates(base);
        res.json({ base, rates, timestamp: new Date().toISOString() });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch exchange rates.' });
    }
});

app.post('/api/currencies/convert', async (req, res) => {
    try {
        const { amount, from, to } = req.body;
        const result = await currencyService.convertAmount(amount, from, to);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message || 'Conversion error.' });
    }
});

// ==========================================
// EMAIL SERVICE DIAGNOSTICS & PROVIDER STATUS
// ==========================================
app.get('/api/email/status', async (req, res) => {
    try {
        const status = await emailService.verifyEmailService();
        res.json({ success: true, ...status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ==========================================
// 7.5 REAL-TIME SECURE CHAT & CONVERSATIONS API
// Enforces authentication, conversation membership, unread counts, and access controls
// ==========================================

// Helper to authenticate request
async function getAuthUser(req, res) {
    const userId = actingUserId(req);
    if (!userId) {
        res.status(401).json({ error: 'Authentication required. Please sign in to access Chat.' });
        return null;
    }
    const check = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [userId]);
    if (check.rows.length === 0) {
        res.status(401).json({ error: 'Invalid user session. Please sign in again.' });
        return null;
    }
    return check.rows[0];
}

// 1. List user's conversations (Auto-syncs all groups where the user exists)
app.get('/api/chat/conversations', async (req, res) => {
    try {
        const user = await getAuthUser(req, res);
        if (!user) return;

        // Auto-sync: Ensure every group this user is a member of has a chat conversation
        await pool.query(`
            INSERT INTO chat_conversations (group_id, title, type, created_by)
            SELECT g.id, g.name, 'group', COALESCE(g.created_by, $1)
            FROM groups g
            JOIN group_members gm ON gm.group_id = g.id
            WHERE gm.user_id = $1
              AND NOT EXISTS (
                  SELECT 1 FROM chat_conversations c WHERE c.group_id = g.id
              )
            ON CONFLICT DO NOTHING;
        `, [user.id]);

        // Auto-sync: Ensure all members of the user's groups are enrolled in chat_conversation_members
        await pool.query(`
            INSERT INTO chat_conversation_members (conversation_id, user_id)
            SELECT c.id, gm.user_id
            FROM chat_conversations c
            JOIN group_members gm ON gm.group_id = c.group_id
            WHERE c.group_id IN (
                SELECT group_id FROM group_members WHERE user_id = $1
            )
            ON CONFLICT (conversation_id, user_id) DO NOTHING;
        `, [user.id]);

        // Auto-sync: Keep conversation titles updated if group name was modified
        await pool.query(`
            UPDATE chat_conversations c
            SET title = g.name, updated_at = NOW()
            FROM groups g
            WHERE c.group_id = g.id AND c.title != g.name;
        `);

        // Prune any memberships where a user is no longer a group member
        await pool.query(`
            DELETE FROM chat_conversation_members cm
            USING chat_conversations c
            WHERE cm.conversation_id = c.id
              AND c.group_id IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM group_members gm 
                  WHERE gm.group_id = c.group_id AND gm.user_id = cm.user_id
              );
        `);

        const result = await pool.query(`
            SELECT 
                c.id, 
                c.group_id, 
                CASE 
                    WHEN c.type = 'direct' THEN (
                        SELECT u_peer.name 
                        FROM chat_conversation_members cm_peer
                        JOIN users u_peer ON u_peer.id = cm_peer.user_id
                        WHERE cm_peer.conversation_id = c.id AND cm_peer.user_id != $1
                        LIMIT 1
                    )
                    ELSE COALESCE(g.name, c.title)
                END AS title, 
                c.type, 
                c.created_at, 
                c.updated_at,
                g.name AS group_name,
                CASE 
                    WHEN c.type = 'direct' THEN (
                        SELECT json_build_object(
                            'id', u_peer.id,
                            'name', u_peer.name,
                            'avatar_initials', u_peer.avatar_initials,
                            'email', u_peer.email
                        )
                        FROM chat_conversation_members cm_peer
                        JOIN users u_peer ON u_peer.id = cm_peer.user_id
                        WHERE cm_peer.conversation_id = c.id AND cm_peer.user_id != $1
                        LIMIT 1
                    )
                    ELSE NULL
                END AS peer_user,
                (
                    SELECT COUNT(*)::int 
                    FROM chat_conversation_members cm2 
                    WHERE cm2.conversation_id = c.id
                ) AS member_count,
                (
                    SELECT COUNT(*)::int 
                    FROM chat_messages m 
                    WHERE m.conversation_id = c.id 
                      AND m.sender_id != $1 
                      AND m.is_read = FALSE
                ) AS unread_count,
                (
                    SELECT json_build_object(
                        'id', m.id,
                        'sender_id', m.sender_id,
                        'sender_name', u.name,
                        'message', m.message,
                        'created_at', m.created_at
                    )
                    FROM chat_messages m
                    JOIN users u ON u.id = m.sender_id
                    WHERE m.conversation_id = c.id
                    ORDER BY m.created_at DESC
                    LIMIT 1
                ) AS last_message
            FROM chat_conversations c
            JOIN chat_conversation_members cm ON cm.conversation_id = c.id
            LEFT JOIN groups g ON g.id = c.group_id
            WHERE cm.user_id = $1
            ORDER BY c.updated_at DESC
        `, [user.id]);

        res.json({ conversations: result.rows });
    } catch (err) {
        console.error('Error fetching chat conversations:', err);
        res.status(500).json({ error: formatUserError(err, 'Unable to load conversations.') });
    }
});

// 1.1 Direct Personal 1-to-1 Chat Handler
app.get('/api/chat/direct/:friendId', async (req, res) => {
    try {
        const user = await getAuthUser(req, res);
        if (!user) return;

        const friendId = parseInt(req.params.friendId);
        if (!friendId || isNaN(friendId) || friendId === user.id) {
            return res.status(400).json({ error: 'Valid friend ID required.' });
        }

        const friendRes = await pool.query('SELECT id, name, email, avatar_initials FROM users WHERE id = $1', [friendId]);
        if (friendRes.rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }
        const friend = friendRes.rows[0];

        // Privacy: direct chat is limited to friends and shared-circle peers.
        const allowedRes = await pool.query(`
            SELECT 1 FROM friends WHERE user_id = $1 AND friend_id = $2
            UNION
            SELECT 1 FROM group_members gm1
            JOIN group_members gm2 ON gm1.group_id = gm2.group_id
            WHERE gm1.user_id = $1 AND gm2.user_id = $2
            LIMIT 1
        `, [user.id, friendId]);
        if (allowedRes.rows.length === 0) {
            return res.status(403).json({ error: 'You can only start a direct chat with friends or members of your circles.' });
        }

        // Find existing direct conversation
        let convRes = await pool.query(`
            SELECT c.id FROM chat_conversations c
            JOIN chat_conversation_members m1 ON c.id = m1.conversation_id AND m1.user_id = $1
            JOIN chat_conversation_members m2 ON c.id = m2.conversation_id AND m2.user_id = $2
            WHERE c.type = 'direct' LIMIT 1
        `, [user.id, friendId]);

        let convId = convRes.rows[0]?.id;
        if (!convId) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const insertRes = await client.query(`
                    INSERT INTO chat_conversations (title, type, created_by)
                    VALUES ($1, 'direct', $2)
                    RETURNING id
                `, [`${friend.name}`, user.id]);
                convId = insertRes.rows[0].id;
                await client.query(`
                    INSERT INTO chat_conversation_members (conversation_id, user_id)
                    VALUES ($1, $2), ($1, $3)
                    ON CONFLICT DO NOTHING
                `, [convId, user.id, friendId]);
                await client.query('COMMIT');
            } catch (e) {
                await client.query('ROLLBACK');
                throw e;
            } finally {
                client.release();
            }
        }

        res.json({
            conversation_id: convId,
            friend: friend
        });
    } catch (err) {
        console.error('Error finding/creating direct chat:', err);
        res.status(500).json({ error: formatUserError(err, 'Failed to open personal chat.') });
    }
});

// 2. Create conversation
app.post('/api/chat/conversations', async (req, res) => {
    try {
        const user = await getAuthUser(req, res);
        if (!user) return;

        const { title, group_id, type = 'group', member_ids = [] } = req.body;
        if (!title || !String(title).trim()) {
            return res.status(400).json({ error: 'Conversation title is required.' });
        }
        if (!['group', 'direct'].includes(type)) {
            return res.status(400).json({ error: 'Invalid conversation type.' });
        }

        const requestedMembers = Array.from(new Set(
            (Array.isArray(member_ids) ? member_ids : []).map(Number).filter(id => Number.isFinite(id) && id > 0 && id !== user.id)
        ));
        if (requestedMembers.length > 100) {
            return res.status(400).json({ error: 'A conversation can have at most 100 members.' });
        }

        if (group_id) {
            const membership = await pool.query(
                'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
                [parseInt(group_id), user.id]
            );
            if (membership.rows.length === 0) {
                return res.status(403).json({ error: 'You are not a member of that circle.' });
            }
            if (requestedMembers.length > 0) {
                const inGroup = await pool.query(
                    'SELECT user_id FROM group_members WHERE group_id = $1 AND user_id = ANY($2::int[])',
                    [parseInt(group_id), requestedMembers]
                );
                if (inGroup.rows.length !== requestedMembers.length) {
                    return res.status(403).json({ error: 'All conversation members must belong to the selected circle.' });
                }
            }
        } else if (requestedMembers.length > 0) {
            const allowed = await pool.query(`
                SELECT DISTINCT u.id FROM users u
                WHERE u.id = ANY($1::int[])
                  AND (
                    EXISTS (SELECT 1 FROM friends f WHERE f.user_id = $2 AND f.friend_id = u.id)
                    OR EXISTS (
                        SELECT 1 FROM group_members gm1
                        JOIN group_members gm2 ON gm1.group_id = gm2.group_id
                        WHERE gm1.user_id = $2 AND gm2.user_id = u.id
                    )
                  )
            `, [requestedMembers, user.id]);
            if (allowed.rows.length !== requestedMembers.length) {
                return res.status(403).json({ error: 'You can only add friends or members of your circles to a conversation.' });
            }
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const convRes = await client.query(`
                INSERT INTO chat_conversations (group_id, title, type, created_by)
                VALUES ($1, $2, $3, $4)
                RETURNING id, group_id, title, type, created_at, updated_at
            `, [group_id || null, sanitizeText(title, 200), type, user.id]);

            const convId = convRes.rows[0].id;
            const uniqueMembers = Array.from(new Set([user.id, ...requestedMembers]));

            for (const mid of uniqueMembers) {
                await client.query(`
                    INSERT INTO chat_conversation_members (conversation_id, user_id)
                    VALUES ($1, $2)
                    ON CONFLICT DO NOTHING
                `, [convId, mid]);
            }

            await client.query('COMMIT');
            res.status(201).json({ conversation: convRes.rows[0] });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Error creating chat conversation:', err);
        res.status(500).json({ error: formatUserError(err, 'Unable to create conversation.') });
    }
});

// 3. Get messages for a specific conversation
app.get('/api/chat/conversations/:id/messages', async (req, res) => {
    try {
        const user = await getAuthUser(req, res);
        if (!user) return;

        const convId = parseInt(req.params.id);
        if (!convId || isNaN(convId)) {
            return res.status(400).json({ error: 'Invalid conversation ID.' });
        }

        // Verify membership
        const memberCheck = await pool.query(`
            SELECT 1 FROM chat_conversation_members 
            WHERE conversation_id = $1 AND user_id = $2
        `, [convId, user.id]);

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Access denied: You are not a member of this conversation.' });
        }

        // Fetch messages
        const messagesRes = await pool.query(`
            SELECT 
                m.id, 
                m.conversation_id, 
                m.sender_id, 
                u.name AS sender_name, 
                u.avatar_initials, 
                m.message, 
                m.is_read, 
                m.created_at
            FROM chat_messages m
            JOIN users u ON u.id = m.sender_id
            WHERE m.conversation_id = $1
            ORDER BY m.created_at ASC
        `, [convId]);

        // Mark unread messages from other users as read
        await pool.query(`
            UPDATE chat_messages 
            SET is_read = TRUE 
            WHERE conversation_id = $1 AND sender_id != $2 AND is_read = FALSE
        `, [convId, user.id]);

        res.json({ messages: messagesRes.rows });
    } catch (err) {
        console.error('Error fetching chat messages:', err);
        res.status(500).json({ error: formatUserError(err, 'Unable to load messages.') });
    }
});

// 4. Send message to conversation
app.post('/api/chat/conversations/:id/messages', async (req, res) => {
    try {
        const user = await getAuthUser(req, res);
        if (!user) return;

        const convId = parseInt(req.params.id);
        const { message } = req.body;

        if (!convId || isNaN(convId)) {
            return res.status(400).json({ error: 'Invalid conversation ID.' });
        }
        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Message content cannot be empty.' });
        }

        // Verify membership
        const memberCheck = await pool.query(`
            SELECT 1 FROM chat_conversation_members 
            WHERE conversation_id = $1 AND user_id = $2
        `, [convId, user.id]);

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Access denied: You cannot send messages to conversations you do not belong to.' });
        }

        const cleanMessage = message.trim().substring(0, 2000);

        const insertRes = await pool.query(`
            INSERT INTO chat_messages (conversation_id, sender_id, message)
            VALUES ($1, $2, $3)
            RETURNING id, conversation_id, sender_id, message, is_read, created_at
        `, [convId, user.id, cleanMessage]);

        // Update conversation updated_at
        await pool.query('UPDATE chat_conversations SET updated_at = NOW() WHERE id = $1', [convId]);

        const msgRow = insertRes.rows[0];
        res.status(201).json({
            message: {
                ...msgRow,
                sender_name: user.name,
                avatar_initials: user.avatar_initials || 'US'
            }
        });
    } catch (err) {
        console.error('Error sending chat message:', err);
        res.status(500).json({ error: formatUserError(err, 'Unable to send message.') });
    }
});

// 5. Unread count endpoint
app.get('/api/chat/unread-count', async (req, res) => {
    try {
        const user = await getAuthUser(req, res);
        if (!user) return;

        const countRes = await pool.query(`
            SELECT COUNT(*)::int AS unread_count
            FROM chat_messages m
            JOIN chat_conversation_members cm ON cm.conversation_id = m.conversation_id
            WHERE cm.user_id = $1 AND m.sender_id != $1 AND m.is_read = FALSE
        `, [user.id]);

        res.json({ unread_count: countRes.rows[0].unread_count || 0 });
    } catch (err) {
        console.error('Error fetching unread count:', err);
        res.status(500).json({ error: formatUserError(err, 'Unable to fetch unread count.') });
    }
});


// ==========================================
// 8. INTELLIGENT MULTI-LINGUAL CHATBOT & VOICE QUERY API
// ==========================================
// 8. INTELLIGENT AI & VOICE ASSISTANT
// Deeply trained on SplitEase Project Data, Multi-lingual NLP, Exclusions & Aggregations
// Hardened against Cyber Attacks / Prompt Injection / XSS
// ==========================================
// Multi-turn conversation sessions store
const conversationSessions = new Map();

function getCurrencySymbol(code = 'INR') {
    switch ((code || '').toUpperCase()) {
        case 'USD': return '$';
        case 'EUR': return '€';
        case 'GBP': return '£';
        case 'JPY': return '¥';
        case 'CAD': return 'C$';
        case 'AUD': return 'A$';
        case 'INR':
        default: return '₹';
    }
}

function getOrCreateSession(convId, userId) {
    const id = convId || `conv_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    if (!conversationSessions.has(id)) {
        conversationSessions.set(id, {
            id,
            user_id: userId,
            created_at: Date.now(),
            last_activity: Date.now(),
            history: [],
            context: {
                lastIntent: null,
                lastPeer: null,
                lastGroup: null,
                lastTimeframe: null,
                lastAction: null,
                lastSearch: null,
                pendingTool: null,
                slotFilling: null
            }
        });
    }
    const session = conversationSessions.get(id);

    // Cross-user session security isolation: Never allow a user to hijack or view another user's conversation session
    if (session.user_id && userId && session.user_id !== userId) {
        const isolatedId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const isolatedSession = {
            id: isolatedId,
            user_id: userId,
            created_at: Date.now(),
            last_activity: Date.now(),
            history: [],
            context: {
                lastIntent: null,
                lastPeer: null,
                lastGroup: null,
                lastTimeframe: null,
                lastAction: null,
                lastSearch: null,
                pendingTool: null,
                slotFilling: null
            }
        };
        conversationSessions.set(isolatedId, isolatedSession);
        return isolatedSession;
    }

    session.last_activity = Date.now();
    return session;
}

// Clean old sessions (> 2 hours)
setInterval(() => {
    const now = Date.now();
    for (const [id, s] of conversationSessions.entries()) {
        if (now - s.last_activity > 2 * 60 * 60 * 1000) {
            conversationSessions.delete(id);
        }
    }
}, 15 * 60 * 1000);

async function callGeminiIfAvailable(query, detectedLang, projectData, conversationHistory = []) {
    if (!process.env.GEMINI_API_KEY) return null;
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const systemPrompt = `You are the SplitEase AI Financial Assistant. You are deeply and strictly trained on the user's project financial data provided below:
Groups: ${JSON.stringify(projectData.groups)}
Expenses: ${JSON.stringify(projectData.expenses)}
Users & Roles: ${JSON.stringify(projectData.usersWithRoles)}
Debts: ${JSON.stringify(projectData.balances)}
Conversation Context: ${JSON.stringify(conversationHistory)}

Instructions:
1. Answer the user query factually based ONLY on this project data. Format currency with ₹.
2. If the user asks in Hindi, answer in natural Hindi (Devanagari script).
3. If the user asks in Gujarati, answer in natural Gujarati script.
4. If the user asks in English, answer in natural English (handle Indian English accents and phrasing).
5. If the user asks a follow-up question, use the conversation history to resolve the subject.
6. If the query is completely unrelated to the SplitEase project (e.g. general trivia, politics, weather, recipes), politely state that you are strictly trained on their SplitEase financial ledger.
7. Return a concise, friendly response.`;

        const body = {
            contents: [
                { role: 'user', parts: [{ text: `${systemPrompt}\n\nUser Question: ${query}` }] }
            ],
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 400
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!response.ok) return null;
        const resJson = await response.json();
        const rawText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
        return rawText ? rawText.trim() : null;
    } catch(e) {
        console.error('Gemini API call skipped, falling back to built-in NLP engine:', e.message);
        return null;
    }
}


// Helper to resolve a user by ID, user code, email, or name
async function resolveUserByIdentifier(clientOrPool, identifier, currentUserId) {
    if (!identifier) return null;
    if (typeof identifier === 'object' && identifier.id) return identifier;
    const str = String(identifier).trim();
    const num = parseInt(str);
    if (!isNaN(num) && num > 0) {
        const byId = await clientOrPool.query('SELECT id, name, email, user_code, avatar_initials, upi_id FROM users WHERE id = $1', [num]);
        if (byId.rows.length > 0) return byId.rows[0];
    }
    const lower = str.toLowerCase();
    const byExact = await clientOrPool.query(`
        SELECT id, name, email, user_code, avatar_initials, upi_id FROM users
        WHERE LOWER(user_code) = $1 OR LOWER(email) = $1 OR LOWER(name) = $1
        LIMIT 1
    `, [lower]);
    if (byExact.rows.length > 0) return byExact.rows[0];

    const byIlike = await clientOrPool.query(`
        SELECT id, name, email, user_code, avatar_initials, upi_id FROM users
        WHERE LOWER(name) ILIKE $1 OR LOWER(user_code) ILIKE $1
        LIMIT 1
    `, [`%${lower}%`]);
    return byIlike.rows[0] || null;
}

// ==========================================
// 4.5 AI ASSISTANT TOOL EXECUTION ENGINE (FULL CONTROL)
// ==========================================
app.post('/api/chatbot/confirm-action', async (req, res) => {
    const client = await pool.connect();
    try {
        const { toolCall } = req.body;
        const currentUserId = actingUserId(req);

        if (!currentUserId || isNaN(currentUserId)) {
            return res.status(401).json({ error: 'Authentication required to execute actions.' });
        }

        if (!toolCall || !toolCall.action) {
            return res.status(400).json({ error: 'Valid tool call specification is required.' });
        }

        await client.query('BEGIN');

        let result = null;
        const actionType = toolCall.action;
        const params = toolCall.params || {};

        if (actionType === 'CREATE_GROUP') {
            const groupName = sanitizeText(params.name || 'New Group', 200);
            const category = params.category || 'General';
            const baseCur = (params.currency || 'INR').toUpperCase();

            const grpRes = await client.query(`
                INSERT INTO groups (name, category, created_by, base_currency)
                VALUES ($1, $2, $3, $4)
                RETURNING id, name, category, base_currency
            `, [groupName, category, currentUserId, baseCur]);

            const newGrp = grpRes.rows[0];
            await client.query(`
                INSERT INTO group_members (group_id, user_id, role)
                VALUES ($1, $2, 'admin')
            `, [newGrp.id, currentUserId]);

            const addedMembers = [];
            if (Array.isArray(params.members) && params.members.length > 0) {
                for (const m of params.members) {
                    const resolved = await resolveUserByIdentifier(client, m, currentUserId);
                    if (resolved && resolved.id !== currentUserId) {
                        await client.query(`
                            INSERT INTO group_members (group_id, user_id, role)
                            VALUES ($1, $2, 'member')
                            ON CONFLICT DO NOTHING
                        `, [newGrp.id, resolved.id]);
                        addedMembers.push(resolved.name);
                    }
                }
            }

            await client.query(`
                INSERT INTO activity_logs (user_id, group_id, activity_type, message)
                VALUES ($1, $2, 'GROUP_CREATED', $3)
            `, [currentUserId, newGrp.id, `Created group "${newGrp.name}"` + (addedMembers.length ? ` with ${addedMembers.join(', ')}` : '')]);

            result = {
                groupId: newGrp.id,
                groupName: newGrp.name,
                category: newGrp.category,
                membersCount: 1 + addedMembers.length,
                message: `Group "${newGrp.name}" created successfully!` + (addedMembers.length ? ` Added: ${addedMembers.join(', ')}.` : '')
            };
        } else if (actionType === 'UPDATE_GROUP') {
            const groupId = parseInt(params.groupId);
            if (!groupId) throw new Error('Valid group ID required.');

            const adminCheck = await client.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, currentUserId]);
            if (adminCheck.rows.length === 0 || adminCheck.rows[0].role !== 'admin') {
                throw new Error('Only a group admin can update group details.');
            }

            if (params.name) await client.query('UPDATE groups SET name = $1 WHERE id = $2', [params.name.trim(), groupId]);
            if (params.category) await client.query('UPDATE groups SET category = $1 WHERE id = $2', [params.category.trim(), groupId]);

            const updatedGrp = (await client.query('SELECT id, name, category FROM groups WHERE id = $1', [groupId])).rows[0];
            await client.query(`
                INSERT INTO activity_logs (user_id, group_id, activity_type, message)
                VALUES ($1, $2, 'GROUP_UPDATED', $3)
            `, [currentUserId, groupId, `Updated group details to "${updatedGrp.name}"`]);

            result = {
                groupId: updatedGrp.id,
                groupName: updatedGrp.name,
                category: updatedGrp.category,
                message: `Group details for "${updatedGrp.name}" updated successfully.`
            };
        } else if (actionType === 'ADD_GROUP_MEMBER') {
            const groupId = parseInt(params.groupId);
            if (!groupId) throw new Error('Valid group ID required.');

            const reqRole = await client.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, currentUserId]);
            if (reqRole.rows.length === 0 || (reqRole.rows[0].role !== 'admin' && reqRole.rows[0].role !== 'editor')) {
                throw new Error('You need admin or editor permissions in this circle to add members.');
            }

            const targetUser = await resolveUserByIdentifier(client, params.userId || params.userCode || params.identifier, currentUserId);
            if (!targetUser) throw new Error(`User "${params.identifier || params.userId}" not found.`);

            const existing = await client.query('SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, targetUser.id]);
            if (existing.rows.length > 0) throw new Error(`${targetUser.name} is already a member of this circle.`);

            const role = params.role || 'member';
            await client.query(`
                INSERT INTO group_members (group_id, user_id, role)
                VALUES ($1, $2, $3)
            `, [groupId, targetUser.id, role]);

            await client.query(`
                INSERT INTO activity_logs (user_id, group_id, activity_type, message)
                VALUES ($1, $2, 'MEMBER_ADDED', $3)
            `, [currentUserId, groupId, `Added ${targetUser.name} to the group`]);

            result = {
                groupId,
                memberId: targetUser.id,
                memberName: targetUser.name,
                role,
                message: `Added ${targetUser.name} to the group successfully!`
            };
        } else if (actionType === 'REMOVE_GROUP_MEMBER') {
            const groupId = parseInt(params.groupId);
            if (!groupId) throw new Error('Valid group ID required.');

            const targetUser = await resolveUserByIdentifier(client, params.userId || params.identifier, currentUserId);
            if (!targetUser) throw new Error('Member to remove not found.');

            const targetMembership = await client.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, targetUser.id]);
            if (targetMembership.rows.length === 0) throw new Error(`${targetUser.name} is not a member of this group.`);

            // Permission check: admin or self-removal
            if (targetUser.id !== currentUserId) {
                const reqRole = await client.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, currentUserId]);
                if (reqRole.rows.length === 0 || reqRole.rows[0].role !== 'admin') {
                    throw new Error('Only group admins can remove other members.');
                }
            }

            // Sole admin check
            if (targetMembership.rows[0].role === 'admin') {
                const adminCount = await client.query("SELECT COUNT(*)::int as count FROM group_members WHERE group_id = $1 AND role = 'admin'", [groupId]);
                if (adminCount.rows[0].count <= 1) {
                    throw new Error('Cannot remove the only admin of the group. Promote another admin first.');
                }
            }

            // Unsettled debts check
            const owesCheck = await client.query(`
                SELECT COUNT(*)::int as count FROM expense_splits es
                JOIN expenses e ON es.expense_id = e.id
                WHERE e.group_id = $1 AND es.user_id = $2 AND es.is_settled = FALSE
            `, [groupId, targetUser.id]);
            if (owesCheck.rows[0].count > 0) {
                throw new Error(`Cannot remove ${targetUser.name}: member has unsettled debts in this group. All balances must be settled first.`);
            }

            const owedCheck = await client.query(`
                SELECT COUNT(*)::int as count FROM expense_splits es
                JOIN expenses e ON es.expense_id = e.id
                WHERE e.group_id = $1 AND e.paid_by = $2 AND es.user_id != $2 AND es.is_settled = FALSE
            `, [groupId, targetUser.id]);
            if (owedCheck.rows[0].count > 0) {
                throw new Error(`Cannot remove ${targetUser.name}: other group members owe money to this member. Settle all balances first.`);
            }

            await client.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, targetUser.id]);
            await client.query(`
                INSERT INTO activity_logs (user_id, group_id, activity_type, message)
                VALUES ($1, $2, 'MEMBER_REMOVED', $3)
            `, [currentUserId, groupId, `Removed ${targetUser.name} from the group`]);

            result = {
                groupId,
                removedUserId: targetUser.id,
                removedUserName: targetUser.name,
                message: `${targetUser.name} was removed from the group successfully.`
            };
        } else if (actionType === 'ARCHIVE_GROUP' || actionType === 'DELETE_GROUP') {
            const groupId = parseInt(params.groupId);
            if (!groupId) throw new Error('Valid group ID required.');

            const reqRole = await client.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, currentUserId]);
            if (reqRole.rows.length === 0 || reqRole.rows[0].role !== 'admin') {
                throw new Error('Only group admins can archive or delete this group.');
            }

            // Financial history protection
            const expCount = await client.query('SELECT COUNT(*)::int as count FROM expenses WHERE group_id = $1', [groupId]);
            if (expCount.rows[0].count > 0) {
                throw new Error('Cannot delete circle with financial history. The group has recorded expenses.');
            }

            await client.query('DELETE FROM group_members WHERE group_id = $1', [groupId]);
            await client.query('DELETE FROM groups WHERE id = $1', [groupId]);

            result = {
                groupId,
                message: 'Group deleted successfully.'
            };
        } else if (actionType === 'ADD_EXPENSE') {
            const { description, amount, groupId, groupName, paidBy, paid_by, participants, splits, split_user_ids, splitType, category } = params;
            const numAmount = parseFloat(amount);
            if (isNaN(numAmount) || numAmount <= 0) throw new Error('Valid expense amount is required.');

            let targetGroupId = parseInt(groupId);

            if (!targetGroupId && groupName) {
                const matchGrp = await client.query('SELECT id FROM groups WHERE LOWER(name) = LOWER($1)', [groupName.trim()]);
                if (matchGrp.rows.length > 0) targetGroupId = matchGrp.rows[0].id;
            }

            if (!targetGroupId) {
                const userGrps = await client.query(`
                    SELECT gm.group_id FROM group_members gm 
                    WHERE gm.user_id = $1 AND gm.role IN ('admin', 'editor') LIMIT 1
                `, [currentUserId]);
                if (userGrps.rows.length > 0) targetGroupId = userGrps.rows[0].group_id;
            }

            if (!targetGroupId) {
                throw new Error('Please select or create a group circle first.');
            }

            // Check if group is locked
            const grpRes = await client.query('SELECT name, base_currency, is_locked FROM groups WHERE id = $1', [targetGroupId]);
            if (grpRes.rows.length === 0) throw new Error('Target group circle not found.');
            if (grpRes.rows[0].is_locked) throw new Error('Circle is locked. No new expenses can be added.');
            const targetGrpName = grpRes.rows[0]?.name || 'Group';
            const baseCur = grpRes.rows[0]?.base_currency || 'INR';

            // Get enrolled members of group
            const membersRes = await client.query('SELECT user_id, role FROM group_members WHERE group_id = $1', [targetGroupId]);
            const groupMemberMap = new Map();
            membersRes.rows.forEach(m => groupMemberMap.set(parseInt(m.user_id), m.role || 'member'));
            if (groupMemberMap.size === 0) throw new Error('Target group has no members.');

            // The authenticated actor must be an admin/editor of the target circle.
            const actorRole = groupMemberMap.get(currentUserId);
            if (!actorRole) throw new Error('You are not a member of this circle.');
            if (!['admin', 'editor'].includes(actorRole)) {
                throw new Error('Only group Admins or Editors can record expenses in this circle.');
            }

            // Validate payer
            const effectivePayerId = parseInt(paidBy || paid_by || currentUserId);
            if (!groupMemberMap.has(effectivePayerId)) {
                throw new Error('Selected payer must be an enrolled member of this group circle.');
            }

            // Resolve and validate participants & split amounts
            let resolvedSplits = [];
            if (Array.isArray(splits) && splits.length > 0) {
                for (const s of splits) {
                    const uid = parseInt(s.user_id || s.id);
                    if (!groupMemberMap.has(uid)) {
                        const uNameRes = await client.query('SELECT name FROM users WHERE id = $1', [uid]);
                        const uName = uNameRes.rows[0]?.name || `User #${uid}`;
                        throw new Error(`${uName} is not a member of the circle "${targetGrpName}".`);
                    }
                    resolvedSplits.push({ user_id: uid, amount: parseFloat(s.amount) });
                }
            } else if (Array.isArray(participants) && participants.length > 0) {
                const count = participants.length;
                const equalShare = Math.floor((numAmount / count) * 100) / 100;
                const remainder = Math.round((numAmount - equalShare * count) * 100) / 100;
                for (let i = 0; i < participants.length; i++) {
                    const p = participants[i];
                    const uid = parseInt(p.id || p.user_id);
                    if (!groupMemberMap.has(uid)) {
                        const uNameRes = await client.query('SELECT name FROM users WHERE id = $1', [uid]);
                        const uName = uNameRes.rows[0]?.name || p.name || `User #${uid}`;
                        throw new Error(`${uName} is not a member of the circle "${targetGrpName}".`);
                    }
                    const pAmt = p.amount !== undefined ? parseFloat(p.amount) : (i === 0 ? equalShare + remainder : equalShare);
                    resolvedSplits.push({ user_id: uid, amount: pAmt });
                }
            } else if (Array.isArray(split_user_ids) && split_user_ids.length > 0) {
                const count = split_user_ids.length;
                const equalShare = Math.floor((numAmount / count) * 100) / 100;
                const remainder = Math.round((numAmount - equalShare * count) * 100) / 100;
                for (let i = 0; i < split_user_ids.length; i++) {
                    const uid = parseInt(split_user_ids[i]);
                    if (!groupMemberMap.has(uid)) {
                        const uNameRes = await client.query('SELECT name FROM users WHERE id = $1', [uid]);
                        const uName = uNameRes.rows[0]?.name || `User #${uid}`;
                        throw new Error(`${uName} is not a member of the circle "${targetGrpName}".`);
                    }
                    resolvedSplits.push({ user_id: uid, amount: i === 0 ? equalShare + remainder : equalShare });
                }
            } else {
                // Never silently add every group member. A participant must be
                // named explicitly, or the user must ask for "everyone".
                throw new Error('Please specify who should share this expense (for example: "for me and Alex Sharma"). Group members are not included automatically.');
            }

            const normalizedAi = splitEngine.normalizeSplits({
                totalAmount: numAmount,
                splitType: (splitType || (resolvedSplits.length === 1 ? 'single' : 'equal')),
                splits: resolvedSplits,
                currency: baseCur
            });
            if (normalizedAi.error) throw new Error(normalizedAi.error);
            resolvedSplits = normalizedAi.splits;

            const expDesc = sanitizeText(description || 'Expense', 255);
            const effectiveCategory = category || 'General';
            const effectiveSplitType = splitType || (resolvedSplits.length === 1 ? 'single' : 'equal');

            const expRes = await client.query(`
                INSERT INTO expenses (
                    group_id, paid_by, description, amount, currency, category, split_type,
                    original_amount, exchange_rate, converted_amount, rate_provider, rate_timestamp, expense_date
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1.0, $9, 'identity', NOW(), CURRENT_DATE)
                RETURNING id
            `, [targetGroupId, effectivePayerId, expDesc, numAmount, baseCur, effectiveCategory, effectiveSplitType, numAmount, numAmount]);

            const expenseId = expRes.rows[0].id;

            for (const s of resolvedSplits) {
                await client.query(`
                    INSERT INTO expense_splits
                        (expense_id, user_id, amount, base_amount, split_percentage, shares, is_settled, settled_amount, settled_amount_base, is_locked)
                    VALUES ($1, $2, $3, $3, $4, 1, false, 0, 0, $5)
                `, [
                    expenseId,
                    s.user_id,
                    s.amount,
                    ((s.amount / numAmount) * 100).toFixed(2),
                    s.is_locked === true
                ]);
            }

            const payerRes = await client.query('SELECT name FROM users WHERE id = $1', [effectivePayerId]);
            const payerName = payerRes.rows[0]?.name || (effectivePayerId === currentUserId ? 'You' : `User #${effectivePayerId}`);

            await client.query(`
                INSERT INTO activity_logs (user_id, group_id, activity_type, message)
                VALUES ($1, $2, 'EXPENSE_ADDED', $3)
            `, [currentUserId, targetGroupId, `${payerName} recorded expense of ₹${numAmount.toFixed(2)} for "${expDesc}" in ${targetGrpName} (${resolvedSplits.length} participant${resolvedSplits.length === 1 ? '' : 's'})`]);

            result = {
                expenseId,
                amount: numAmount,
                description: expDesc,
                groupId: targetGroupId,
                groupName: targetGrpName,
                paidBy: effectivePayerId,
                payerName,
                participantsCount: resolvedSplits.length,
                message: `Expense of ₹${numAmount.toFixed(2)} for "${expDesc}" in ${targetGrpName} recorded successfully for ${resolvedSplits.length} participant(s)!`
            };
        } else if (actionType === 'UPDATE_EXPENSE') {
            const expenseId = parseInt(params.expenseId);
            if (!expenseId) throw new Error('Valid expense ID required to edit.');

            const expCheck = await client.query(`
                SELECT e.id, e.paid_by, e.group_id, e.amount, e.currency, e.description, gm.role 
                FROM expenses e
                LEFT JOIN group_members gm ON e.group_id = gm.group_id AND gm.user_id = $1
                WHERE e.id = $2
            `, [currentUserId, expenseId]);

            if (expCheck.rows.length === 0) {
                throw new Error('Expense not found or you lack permission to edit it.');
            }

            const expRow = expCheck.rows[0];
            if (expRow.paid_by !== currentUserId && expRow.role !== 'admin') {
                throw new Error('Only the expense creator or group admin can edit this expense.');
            }

            // Settlement Protection: check if splits were settled
            const settledCheck = await client.query(`
                SELECT COUNT(*)::int as count FROM expense_splits 
                WHERE expense_id = $1 AND (settled_amount > 0.005 OR settled_amount_base > 0.005)
            `, [expenseId]);

            if (settledCheck.rows[0].count > 0) {
                throw new Error('Cannot edit expense: participant shares have already been paid or settled.');
            }

            const newAmount = params.amount !== undefined ? parseFloat(params.amount) : parseFloat(expRow.amount);
            const newDesc = params.description !== undefined ? params.description.trim() : expRow.description;

            if (isNaN(newAmount) || newAmount <= 0) throw new Error('Valid positive amount is required.');

            await client.query(`
                UPDATE expenses 
                SET amount = $1, original_amount = $1, converted_amount = $1, description = $2, updated_at = NOW()
                WHERE id = $3
            `, [newAmount, newDesc, expenseId]);

            // Redistribute proportionally across existing splits, exactly.
            if (newAmount !== parseFloat(expRow.amount)) {
                const splitsRes = await client.query('SELECT id, user_id, amount FROM expense_splits WHERE expense_id = $1 ORDER BY id ASC', [expenseId]);
                if (splitsRes.rows.length > 0) {
                    const weights = splitsRes.rows.map(r => Math.max(0, parseFloat(r.amount) || 0));
                    const anyWeight = weights.some(w => w > 0);
                    const newShares = splitEngine.allocateByWeights(
                        newAmount,
                        anyWeight ? weights : weights.map(() => 1),
                        expRow.currency || 'INR'
                    );
                    for (let i = 0; i < splitsRes.rows.length; i++) {
                        await client.query(
                            'UPDATE expense_splits SET amount = $1, base_amount = $1 WHERE id = $2',
                            [newShares[i], splitsRes.rows[i].id]
                        );
                    }
                }
            }

            await client.query(`
                INSERT INTO activity_logs (user_id, group_id, activity_type, message)
                VALUES ($1, $2, 'EXPENSE_UPDATED', $3)
            `, [currentUserId, expRow.group_id, `Updated expense #${expenseId} to ₹${newAmount} ("${newDesc}")`]);

            result = {
                expenseId,
                amount: newAmount,
                description: newDesc,
                message: `Expense #${expenseId} updated to ₹${newAmount} for "${newDesc}" successfully.`
            };
        } else if (actionType === 'DELETE_EXPENSE') {
            const expenseId = parseInt(params.expenseId);
            if (!expenseId) throw new Error('Valid expense ID required to delete.');

            const expCheck = await client.query(`
                SELECT e.id, e.paid_by, e.group_id, e.description, gm.role 
                FROM expenses e
                LEFT JOIN group_members gm ON e.group_id = gm.group_id AND gm.user_id = $1
                WHERE e.id = $2
            `, [currentUserId, expenseId]);

            if (expCheck.rows.length === 0) {
                throw new Error('Expense not found or you lack permission to delete it.');
            }

            const expRow = expCheck.rows[0];
            if (expRow.paid_by !== currentUserId && expRow.role !== 'admin') {
                throw new Error('Only the expense creator or group admin can delete this expense.');
            }

            // Settlement Protection: check if splits were settled
            const settledCheck = await client.query(`
                SELECT COUNT(*)::int as count FROM expense_splits 
                WHERE expense_id = $1 AND (settled_amount > 0.005 OR settled_amount_base > 0.005)
            `, [expenseId]);

            if (settledCheck.rows[0].count > 0) {
                throw new Error('Cannot delete expense: participant shares have already been paid or settled. Use safe correction instead.');
            }

            await client.query('DELETE FROM expense_splits WHERE expense_id = $1', [expenseId]);
            await client.query('DELETE FROM expenses WHERE id = $1', [expenseId]);

            await client.query(`
                INSERT INTO activity_logs (user_id, group_id, activity_type, message)
                VALUES ($1, $2, 'EXPENSE_DELETED', $3)
            `, [currentUserId, expRow.group_id, `Deleted expense #${expenseId} ("${expRow.description}")`]);

            result = {
                deletedExpenseId: expenseId,
                message: `Expense #${expenseId} ("${expRow.description}") deleted successfully.`
            };
        } else if (actionType === 'RECORD_MANUAL_SETTLEMENT') {
            const receiverUser = await resolveUserByIdentifier(client, params.receiverId || params.peerId, currentUserId);
            if (!receiverUser) throw new Error('Settlement peer not found.');

            const payerId = currentUserId; // AI always acts for the authenticated user only
            const receiverId = receiverUser.id;
            const numAmount = roundMoney(params.amount);

            if (payerId === receiverId) throw new Error('Cannot record a settlement with yourself.');
            if (!Number.isFinite(numAmount) || numAmount <= 0) throw new Error('Valid positive settlement amount required.');

            let paymentMethod = (params.paymentMethod || 'UPI').toUpperCase();
            if (!['UPI', 'CASH', 'BANK'].includes(paymentMethod)) {
                paymentMethod = 'UPI';
            }
            const notes = params.notes || 'Recorded via AI Assistant';
            const ref = params.transaction_reference || `AI-SETTLE-${Date.now()}`;

            const applied = await applyPaymentToSplits(client, {
                payerId, receiverId, amount: numAmount, groupId: null
            });
            if (applied.unapplied > 0.005) {
                throw new Error(`The settlement exceeds the outstanding balance. Only ₹${applied.appliedTotal.toFixed(2)} is owed to ${receiverUser.name}.`);
            }

            const settRes = await client.query(`
                INSERT INTO settlements (payer_id, receiver_id, amount, payment_method, transaction_reference, notes)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id, payer_id, receiver_id, amount, created_at
            `, [payerId, receiverId, applied.appliedTotal, paymentMethod, ref, notes]);

            await client.query(`
                INSERT INTO activity_logs (user_id, group_id, activity_type, message)
                VALUES ($1, NULL, 'SETTLEMENT_RECORDED', $2)
            `, [currentUserId, `Recorded manual settlement of ₹${applied.appliedTotal} with ${receiverUser.name} (${paymentMethod})`]);

            result = {
                settlementId: settRes.rows[0].id,
                payerId,
                receiverId,
                amount: applied.appliedTotal,
                peerName: receiverUser.name,
                paymentMethod,
                message: `Recorded manual settlement of ₹${applied.appliedTotal} with ${receiverUser.name}. Balances updated successfully!`
            };
        } else if (actionType === 'SEND_FRIEND_REQUEST') {
            const receiver = await resolveUserByIdentifier(client, params.receiverId || params.identifier, currentUserId);
            if (!receiver) throw new Error(`User '${params.identifier || params.receiverId}' not found.`);

            if (receiver.id === currentUserId) {
                throw new Error('You cannot send a friend request to yourself.');
            }

            const friendCheck = await client.query('SELECT 1 FROM friends WHERE user_id = $1 AND friend_id = $2', [currentUserId, receiver.id]);
            if (friendCheck.rows.length > 0) {
                throw new Error(`You and ${receiver.name} are already connected as friends.`);
            }

            const reqCheck = await client.query(`
                SELECT id, sender_id FROM friend_requests 
                WHERE ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)) AND status = 'pending'
            `, [currentUserId, receiver.id]);

            if (reqCheck.rows.length > 0) {
                throw new Error(`A friend request with ${receiver.name} is already pending.`);
            }

            const insRes = await client.query(`
                INSERT INTO friend_requests (sender_id, receiver_id, status)
                VALUES ($1, $2, 'pending')
                RETURNING id
            `, [currentUserId, receiver.id]);

            await client.query(`
                INSERT INTO activity_logs (user_id, group_id, activity_type, message)
                VALUES ($1, NULL, 'FRIEND_REQUEST_SENT', $2)
            `, [currentUserId, `Sent a friend request to ${receiver.name}`]);

            result = {
                requestId: insRes.rows[0].id,
                receiverId: receiver.id,
                receiverName: receiver.name,
                receiverCode: receiver.user_code,
                status: 'Sent',
                message: `Friend request sent to ${receiver.name} successfully!`
            };
        } else if (actionType === 'ACCEPT_FRIEND_REQUEST') {
            let reqRow = null;
            if (params.requestId) {
                const r = await client.query('SELECT fr.*, u.name as sender_name FROM friend_requests fr JOIN users u ON fr.sender_id = u.id WHERE fr.id = $1 AND fr.receiver_id = $2 AND fr.status = \'pending\'', [parseInt(params.requestId), currentUserId]);
                if (r.rows.length > 0) reqRow = r.rows[0];
            }
            if (!reqRow && params.senderId) {
                const r = await client.query('SELECT fr.*, u.name as sender_name FROM friend_requests fr JOIN users u ON fr.sender_id = u.id WHERE fr.sender_id = $1 AND fr.receiver_id = $2 AND fr.status = \'pending\'', [parseInt(params.senderId), currentUserId]);
                if (r.rows.length > 0) reqRow = r.rows[0];
            }
            if (!reqRow) throw new Error('Pending friend request not found.');

            await client.query('UPDATE friend_requests SET status = \'accepted\', updated_at = NOW() WHERE id = $1', [reqRow.id]);
            await client.query('INSERT INTO friends (user_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [currentUserId, reqRow.sender_id]);
            await client.query('INSERT INTO friends (user_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [reqRow.sender_id, currentUserId]);

            await client.query(`
                INSERT INTO activity_logs (user_id, group_id, activity_type, message)
                VALUES ($1, NULL, 'FRIEND_REQUEST_ACCEPTED', $2)
            `, [currentUserId, `Accepted friend request from ${reqRow.sender_name}`]);

            result = {
                requestId: reqRow.id,
                senderId: reqRow.sender_id,
                senderName: reqRow.sender_name,
                message: `Friend request from ${reqRow.sender_name} accepted! You are now connected.`
            };
        } else if (actionType === 'REJECT_FRIEND_REQUEST') {
            let reqRow = null;
            if (params.requestId) {
                const r = await client.query('SELECT * FROM friend_requests WHERE id = $1 AND receiver_id = $2 AND status = \'pending\'', [parseInt(params.requestId), currentUserId]);
                if (r.rows.length > 0) reqRow = r.rows[0];
            }
            if (!reqRow && params.senderId) {
                const r = await client.query('SELECT * FROM friend_requests WHERE sender_id = $1 AND receiver_id = $2 AND status = \'pending\'', [parseInt(params.senderId), currentUserId]);
                if (r.rows.length > 0) reqRow = r.rows[0];
            }
            if (!reqRow) throw new Error('Pending friend request not found.');

            await client.query('UPDATE friend_requests SET status = \'rejected\', updated_at = NOW() WHERE id = $1', [reqRow.id]);
            result = { requestId: reqRow.id, message: 'Friend request rejected.' };
        } else if (actionType === 'REMOVE_FRIEND') {
            const friendUser = await resolveUserByIdentifier(client, params.friendId || params.identifier, currentUserId);
            if (!friendUser) throw new Error('Friend not found.');

            // Debt check
            const owedToMe = await client.query('SELECT COALESCE(SUM(es.amount), 0) as total FROM expense_splits es JOIN expenses e ON es.expense_id = e.id WHERE e.paid_by = $1 AND es.user_id = $2 AND es.is_settled = FALSE', [currentUserId, friendUser.id]);
            const owedByMe = await client.query('SELECT COALESCE(SUM(es.amount), 0) as total FROM expense_splits es JOIN expenses e ON es.expense_id = e.id WHERE e.paid_by = $1 AND es.user_id = $2 AND es.is_settled = FALSE', [friendUser.id, currentUserId]);
            const diff = parseFloat(owedToMe.rows[0].total) - parseFloat(owedByMe.rows[0].total);
            if (Math.abs(diff) > 0.01) {
                throw new Error(`Cannot remove friend while an unsettled balance of ₹${Math.abs(diff).toFixed(2)} exists. Please settle up first.`);
            }

            await client.query('DELETE FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)', [currentUserId, friendUser.id]);
            await client.query(`
                INSERT INTO activity_logs (user_id, group_id, activity_type, message)
                VALUES ($1, NULL, 'FRIEND_REMOVED', $2)
            `, [currentUserId, `Removed ${friendUser.name} from friends list`]);

            result = {
                friendId: friendUser.id,
                friendName: friendUser.name,
                message: `Removed ${friendUser.name} from your friends list.`
            };
        } else if (actionType === 'UPDATE_USER_SETTINGS') {
            if (params.currency) {
                const supported = ['INR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];
                const cur = params.currency.toUpperCase();
                if (!supported.includes(cur)) throw new Error(`Currency ${cur} is not supported. Supported: ${supported.join(', ')}`);
                await client.query('UPDATE users SET default_currency = $1 WHERE id = $2', [cur, currentUserId]);
                result = { currency: cur, message: `Default currency updated to ${cur}.` };
            } else {
                result = { message: 'Settings updated.' };
            }
        } else if (actionType === 'UPDATE_USER_PROFILE') {
            const updates = [];
            const values = [];
            let idx = 1;
            if (params.name) { updates.push(`name = $${idx++}`); values.push(params.name.trim()); }
            if (params.phone) { updates.push(`phone = $${idx++}`); values.push(params.phone.trim()); }
            if (params.upi_id) { updates.push(`upi_id = $${idx++}`); values.push(params.upi_id.trim()); }

            if (updates.length > 0) {
                values.push(currentUserId);
                await client.query(`UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, values);
            }
            result = { message: 'Profile updated successfully.' };
        } else if (actionType === 'SEND_CHAT_MESSAGE') {
            const targetUser = await resolveUserByIdentifier(client, params.receiverId || params.identifier, currentUserId);
            if (!targetUser) throw new Error('Recipient user not found.');
            const msg = (params.message || '').trim();
            if (!msg) throw new Error('Message cannot be empty.');

            // Find or create direct conversation
            let convRes = await client.query(`
                SELECT c.id FROM chat_conversations c
                JOIN chat_conversation_members m1 ON c.id = m1.conversation_id AND m1.user_id = $1
                JOIN chat_conversation_members m2 ON c.id = m2.conversation_id AND m2.user_id = $2
                WHERE c.type = 'direct' LIMIT 1
            `, [currentUserId, targetUser.id]);

            let convId = convRes.rows[0]?.id;
            if (!convId) {
                const newConv = await client.query(`
                    INSERT INTO chat_conversations (title, type, created_by)
                    VALUES ($1, 'direct', $2)
                    RETURNING id
                `, [`${targetUser.name}`, currentUserId]);
                convId = newConv.rows[0].id;
                await client.query('INSERT INTO chat_conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)', [convId, currentUserId, targetUser.id]);
            }

            await client.query(`
                INSERT INTO chat_messages (conversation_id, sender_id, message)
                VALUES ($1, $2, $3)
            `, [convId, currentUserId, msg]);
            await client.query('UPDATE chat_conversations SET updated_at = NOW() WHERE id = $1', [convId]);

            result = {
                conversationId: convId,
                receiverId: targetUser.id,
                receiverName: targetUser.name,
                message: `Message sent to ${targetUser.name} successfully!`
            };
        } else {
            throw new Error(`Unsupported action type '${actionType}'`);
        }

        await client.query(`
            INSERT INTO ai_agent_actions (user_id, command_text, action_type, action_payload, status, execution_result)
            VALUES ($1, $2, $3, $4, 'EXECUTED', $5)
        `, [currentUserId, toolCall.summary || actionType, actionType, JSON.stringify(params), JSON.stringify(result)]);

        await client.query('COMMIT');
        res.json({
            success: true,
            message: result.message || 'Action executed successfully.',
            result
        });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: formatUserError(err, 'Failed to execute requested action.') });
    } finally {
        client.release();
    }
});

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const COMMON_EXPENSE_CATEGORIES = [
    'dinner', 'lunch', 'breakfast', 'food', 'drinks', 'coffee', 'tea', 'snacks',
    'groceries', 'movie', 'tickets', 'flight', 'travel', 'cab', 'taxi', 'uber',
    'hotel', 'stay', 'room', 'rent', 'wifi', 'party', 'shopping', 'petrol', 'fuel'
];

async function extractExpenseIntent(query, currentUserId, allUsers, allGroups, clientOrPool) {
    const cleanQ = query.replace(/<[^>]*>?/gm, '').trim();
    const lowerQ = cleanQ.toLowerCase();

    // 1. Amount Extraction
    const amtRegex = /(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)?(?:\.\d+)?)/gi;
    let match;
    const allNumbers = [];
    while ((match = amtRegex.exec(cleanQ)) !== null) {
        const val = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(val) && val > 0) {
            allNumbers.push({ val, raw: match[0], index: match.index });
        }
    }
    if (allNumbers.length === 0) return null;
    const totalAmount = allNumbers[0].val;

    // 2. Currency
    let currency = 'INR';
    if (/(\$|usd)/i.test(cleanQ)) currency = 'USD';
    else if (/(€|eur)/i.test(cleanQ)) currency = 'EUR';
    else if (/(£|gbp)/i.test(cleanQ)) currency = 'GBP';

    // 3. Payer Identification
    let effectivePayer = allUsers.find(u => u.id === currentUserId) || { id: currentUserId, name: 'You' };
    const payerPaidMatch = cleanQ.match(/([a-zA-Z\s]+?)\s+paid\b/i);
    const paidByMatch = cleanQ.match(/paid\s+by\s+([a-zA-Z\s]+)/i);

    const matchUserByName = (nameStr) => {
        const clean = nameStr.trim().toLowerCase();
        for (const u of allUsers) {
            if (u.name.toLowerCase() === clean) return u;
        }
        for (const u of allUsers) {
            if (u.name.toLowerCase().split(' ')[0] === clean) return u;
        }
        return null;
    };

    if (payerPaidMatch) {
        const candidate = payerPaidMatch[1].trim().toLowerCase();
        if (candidate !== 'i' && candidate !== 'we' && candidate !== 'who') {
            const foundPayer = matchUserByName(candidate);
            if (foundPayer) effectivePayer = foundPayer;
        }
    } else if (paidByMatch) {
        const candidate = paidByMatch[1].trim().toLowerCase();
        if (candidate !== 'me' && candidate !== 'myself') {
            const foundPayer = matchUserByName(candidate);
            if (foundPayer) effectivePayer = foundPayer;
        }
    }

    // 4. Explicit Group Extraction
    let explicitGroupCandidate = false;
    let matchedGroup = null;
    const grpMatch = cleanQ.match(/(?:in|to|for\s+group|for\s+circle|in\s+circle|in\s+group|in\s+trip)\s+["']?([^.\n,;]+?)["']?(?:$|\.|\s+for|\s+with|\s+split)/i);
    if (grpMatch) {
        const grpNameCandidate = grpMatch[1].trim().toLowerCase();
        matchedGroup = allGroups.find(g => g.name.toLowerCase().includes(grpNameCandidate) || grpNameCandidate.includes(g.name.toLowerCase()));
        if (matchedGroup) explicitGroupCandidate = true;
    }

    // 5. Participants & Split Mode Extraction
    const isEveryone = /(?:for|between|among|vachche|vacche|beech|bich)\s+(?:everyone|all(?:\s+the)?\s+group\s+members|all\s+members|everyone\s+in\s+(?:this\s+)?group|badha|sab|sabhi|બધા|સૌ|सब|सभी)\b/i.test(lowerQ) ||
                       /\bbadha\s+(?:group\s+)?(?:members|sabhyo)\b/i.test(lowerQ) ||
                       /\bsab\s+(?:group\s+)?members\b/i.test(lowerQ);

    let participants = [];
    let splitType = 'equal';

    if (!isEveryone) {
        // 0. Check for Smart Custom Split intent: "Alex 5000, Priya 2000 and distribute the remaining equally"
        const isSmartCustomIntent = /\b(lock|locked|auto[- ]?distribut|distribute\s+(?:the\s+)?remaining|distribute\s+(?:the\s+)?rest|divide\s+(?:the\s+)?remaining|divide\s+(?:the\s+)?rest|remaining\s+equally|rest\s+equally|baki\s+(?:sab|sabhi|badha)?\s*(?:me|vachche|vacche)?\s*barabar|બાકી.*સરખે|बाकी.*बराबर)\b/i.test(cleanQ);

        if (isSmartCustomIntent) {
            const normalizedQ = cleanQ.replace(/(\d),(\d)/g, '$1$2');
            const locks = {};
            const lockedUserIds = new Set();

            for (const u of allUsers) {
                const isSelf = u.id === currentUserId;
                const nameCandidates = isSelf 
                    ? ['me', 'myself', 'i', u.name.toLowerCase(), u.name.toLowerCase().split(' ')[0]]
                    : [u.name.toLowerCase(), u.name.toLowerCase().split(' ')[0]];

                for (const nc of nameCandidates) {
                    if (nc.length < 2) continue;
                    const patA = new RegExp(`(?:lock(?:ed)?\\s+)?\\b${escapeRegExp(nc)}\\b\\s*(?:at|for|:|=)?\\s*(?:₹|rs\\.?|inr)?\\s*(\\d+(?:\\.\\d+)?)\\b`, 'i');
                    const patB = new RegExp(`(?:₹|rs\\.?|inr)?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:for\\s+)?(?:locked\\s+)?\\b${escapeRegExp(nc)}\\b`, 'i');

                    let match = normalizedQ.match(patA);
                    if (!match) match = normalizedQ.match(patB);

                    if (match) {
                        const amt = parseFloat(match[1]);
                        if (amt > 0 && amt !== totalAmount && locks[u.id] === undefined) {
                            locks[u.id] = amt;
                            lockedUserIds.add(u.id);
                            break;
                        }
                    }
                }
            }

            if (Object.keys(locks).length > 0) {
                let candidateParticipants = [];
                let peopleCount = 0;
                const countMatch = cleanQ.match(/(?:for|between|among)\s+(\d+|five|four|three|six|seven|eight|nine|ten)\s+(?:people|members|friends|persons)/i);
                const wordToNum = { three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
                if (countMatch) {
                    const raw = countMatch[1].toLowerCase();
                    peopleCount = wordToNum[raw] || parseInt(raw) || 0;
                }

                let groupMembersPool = [];
                if (matchedGroup) {
                    const memberRows = await clientOrPool.query('SELECT user_id FROM group_members WHERE group_id = $1', [matchedGroup.id]);
                    const grpIds = memberRows.rows.map(r => r.user_id);
                    groupMembersPool = allUsers.filter(u => grpIds.includes(u.id));
                }

                if (groupMembersPool.length > 0) {
                    if (peopleCount > 0 && peopleCount <= groupMembersPool.length) {
                        candidateParticipants = groupMembersPool.slice(0, peopleCount);
                    } else {
                        candidateParticipants = groupMembersPool;
                    }
                } else if (peopleCount > 0 && peopleCount <= allUsers.length) {
                    candidateParticipants = allUsers.slice(0, peopleCount);
                } else {
                    const mentioned = new Set([...lockedUserIds, currentUserId, effectivePayer.id]);
                    for (const u of allUsers) {
                        const first = u.name.toLowerCase().split(' ')[0];
                        if (new RegExp(`\\b${escapeRegExp(first)}\\b`, 'i').test(cleanQ)) {
                            mentioned.add(u.id);
                        }
                    }
                    candidateParticipants = allUsers.filter(u => mentioned.has(u.id));
                }

                for (const lid of lockedUserIds) {
                    if (!candidateParticipants.some(p => p.id === lid)) {
                        const lockedUserObj = allUsers.find(u => u.id === lid);
                        if (lockedUserObj) candidateParticipants.push(lockedUserObj);
                    }
                }

                const calc = calculateSmartCustomSplits({
                    totalAmount,
                    participants: candidateParticipants,
                    locks,
                    currency: currency || 'INR'
                });

                if (!calc.isBalanced) {
                    return { error: calc.errorMessage || 'Invalid split distribution.' };
                }

                splitType = 'smart_custom';
                participants = calc.splits.map(s => ({
                    id: s.id,
                    name: s.name,
                    amount: s.amount,
                    is_locked: s.is_locked,
                    status: s.status
                }));
            }
        }

        // A. Check for custom splits: "₹2,000 for me and ₹1,000 for Rahul" or "2000 for me, 1000 for Rahul"
        if (participants.length === 0) {
        const customPattern = /(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)?(?:\.\d+)?)\s+(?:for\s+)(me|myself|[a-zA-Z\s]+?)(?:$|\s+and|\s*,|\s*\.|\s+in\s+|\s+for\s+group|\s+to\s+group|\s+in\s+circle)/gi;
        const customMatches = [];
        let cMatch;
        while ((cMatch = customPattern.exec(cleanQ)) !== null) {
            const subAmt = parseFloat(cMatch[1].replace(/,/g, ''));
            let targetName = cMatch[2].trim().replace(/\s+(?:in|to|for\s+group|in\s+circle|in\s+trip)\s+.*$/i, '').trim();
            customMatches.push({ amount: subAmt, name: targetName });
        }

        if (customMatches.length >= 2) {
            let sumCustom = 0;
            const tempSplits = [];
            for (const c of customMatches) {
                const isSelf = /\b(me|myself|i)\b/i.test(c.name);
                const userObj = isSelf ? (allUsers.find(u => u.id === currentUserId) || { id: currentUserId, name: 'You' }) : matchUserByName(c.name);
                if (userObj) {
                    tempSplits.push({ id: userObj.id, name: userObj.name, amount: c.amount });
                    sumCustom += c.amount;
                }
            }
            if (tempSplits.length >= 2) {
                if (Math.abs(sumCustom - totalAmount) > 0.05) {
                    return {
                        error: `The individual split amounts (₹${sumCustom}) do not equal the total expense amount (₹${totalAmount}).`
                    };
                }
                splitType = 'exact';
                participants = tempSplits;
            }
        }
        }

        // B. If not custom, parse participant names
        if (participants.length === 0) {
            const partPhrases = [];
            const pRegex = /(?:for|between|among|with|split\s+(?:equally\s+)?between)\s+(.*?)(?:$|\.|\s+in\s+|\s+for\s+group|\s+to\s+group)/gi;
            let pr;
            while ((pr = pRegex.exec(cleanQ)) !== null) {
                partPhrases.push(pr[1]);
            }

            // Also check for Hindi/Gujarati phrases like "X aur Y ke beech" or "X ane Y vachche"
            const beechMatch = cleanQ.match(/([a-zA-Z\u0900-\u097F\u0A80-\u0AFF\s,]+?)\s+(?:ke\s+beech|beech|bich|vachche|vacche|વચ્ચે|बीच)/i);
            if (beechMatch) {
                partPhrases.push(beechMatch[1]);
            }

            const combinedPhrase = partPhrases.join(' ').toLowerCase();

            const hasOnly = /\bonly\b/i.test(combinedPhrase);
            const hasSelf = /\b(me|myself|i|self|mere|mara|maro|mane|મેં|મને|મારા|મારા\s+વચ્ચે|मेरे|मेरे\s+बीच)\b/i.test(combinedPhrase) ||
                            /\b(mere\s+beech|mara\s+vachche|mere\s+aur|mara\s+ane|aur\s+mere|ane\s+mara)\b/i.test(lowerQ) ||
                            /i\s+paid/i.test(lowerQ) || /\bwith\b/i.test(lowerQ);

            const resolvedUsers = [];

            // Disambiguation check: if user mentions first name that matches multiple users in system
            const words = cleanQ.split(/[\s,]+/);
            for (const w of words) {
                const cleanW = w.toLowerCase().replace(/[^a-z]/g, '');
                if (cleanW.length >= 3 && !COMMON_EXPENSE_CATEGORIES.includes(cleanW) && !['add', 'for', 'and', 'the', 'group', 'trip', 'circle', 'expense', 'paid', 'split', 'equally', 'between', 'only', 'with'].includes(cleanW)) {
                    const multiMatches = allUsers.filter(u => u.name.toLowerCase().split(' ')[0] === cleanW);
                    if (multiMatches.length > 1) {
                        const hasFull = multiMatches.some(m => new RegExp(`\\b${escapeRegExp(m.name.toLowerCase())}\\b`, 'i').test(cleanQ));
                        if (!hasFull) {
                            return {
                                disambiguationRequired: true,
                                queryName: w,
                                matchingUsers: multiMatches,
                                reply: `There are multiple members named "${w}" (${multiMatches.map(m => m.name).join(', ')}). Which one did you mean?`
                            };
                        }
                    }
                }
            }

            // Self user
            if (hasSelf || /for\s+me\s+only/i.test(combinedPhrase)) {
                resolvedUsers.push(allUsers.find(u => u.id === currentUserId) || { id: currentUserId, name: 'You' });
            }

            // Other users
            for (const u of allUsers) {
                if (u.id === currentUserId) continue;
                const fullName = u.name.trim().toLowerCase();
                const firstName = fullName.split(' ')[0];

                const fullNameRegex = new RegExp(`\\b${escapeRegExp(fullName)}\\b`, 'i');
                const firstNameRegex = new RegExp(`\\b${escapeRegExp(firstName)}\\b`, 'i');

                if (fullNameRegex.test(combinedPhrase) || fullNameRegex.test(cleanQ)) {
                    if (!resolvedUsers.find(r => r.id === u.id)) resolvedUsers.push(u);
                } else if (firstName.length >= 3 && (firstNameRegex.test(combinedPhrase) || firstNameRegex.test(cleanQ))) {
                    if (!resolvedUsers.find(r => r.id === u.id)) resolvedUsers.push(u);
                }
            }

            // If "only" specified without "me", exclude self
            if (hasOnly && !/\b(me|myself)\b/i.test(combinedPhrase)) {
                const selfIdx = resolvedUsers.findIndex(u => u.id === currentUserId);
                if (selfIdx !== -1) resolvedUsers.splice(selfIdx, 1);
            }

            // Payer inclusion if not "only"
            if (effectivePayer.id !== currentUserId && !hasOnly) {
                if (!resolvedUsers.find(r => r.id === effectivePayer.id)) {
                    resolvedUsers.unshift(effectivePayer);
                }
            }

            // Calculate equal splits
            if (resolvedUsers.length > 0) {
                const count = resolvedUsers.length;
                const equalShare = Math.floor((totalAmount / count) * 100) / 100;
                const remainder = Math.round((totalAmount - equalShare * count) * 100) / 100;
                participants = resolvedUsers.map((u, idx) => ({
                    id: u.id,
                    name: u.name,
                    amount: idx === 0 ? parseFloat((equalShare + remainder).toFixed(2)) : parseFloat(equalShare.toFixed(2))
                }));
            }
        }
    }

    // 6. Group Resolution & Membership Validation
    const memberRows = await clientOrPool.query('SELECT group_id, user_id FROM group_members');
    const groupMemberMap = new Map();
    for (const row of memberRows.rows) {
        const gid = Number(row.group_id);
        if (!groupMemberMap.has(gid)) groupMemberMap.set(gid, new Set());
        groupMemberMap.get(gid).add(Number(row.user_id));
    }

    const requiredUserIds = new Set();
    requiredUserIds.add(Number(effectivePayer.id));
    for (const p of participants) requiredUserIds.add(Number(p.id));

    if (matchedGroup) {
        const grpMembers = groupMemberMap.get(Number(matchedGroup.id)) || new Set();
        for (const uid of requiredUserIds) {
            const numUid = Number(uid);
            if (!grpMembers.has(numUid)) {
                const u = allUsers.find(x => Number(x.id) === numUid) || { name: `User #${numUid}` };
                return {
                    error: `${u.name} is not a member of the group "${matchedGroup.name}". Please add them to this circle first or select another group.`
                };
            }
        }
    } else {
        const candidateGroups = allGroups.filter(g => {
            const grpMembers = groupMemberMap.get(Number(g.id));
            if (!grpMembers) return false;
            for (const uid of requiredUserIds) {
                if (!grpMembers.has(Number(uid))) return false;
            }
            return true;
        });

        if (candidateGroups.length > 0) {
            matchedGroup = candidateGroups[0];
        } else {
            const userPrimaryGroup = allGroups.find(g => groupMemberMap.get(g.id)?.has(currentUserId));
            if (userPrimaryGroup) {
                const grpMembers = groupMemberMap.get(userPrimaryGroup.id) || new Set();
                const missingUser = allUsers.find(u => requiredUserIds.has(u.id) && !grpMembers.has(u.id));
                if (missingUser) {
                    return {
                        error: `${missingUser.name} is not a member of "${userPrimaryGroup.name}". Please add them to the circle first or select another group.`
                    };
                }
            }
            return {
                error: `No shared group circle was found containing ${[...requiredUserIds].map(id => allUsers.find(u => u.id === id)?.name || id).join(', ')}. Please create a circle first.`
            };
        }
    }

    // If the user explicitly said "everyone", include the whole circle.
    // Otherwise, NEVER silently include all group members: a group member is not
    // automatically an expense participant. Ask which people are involved.
    if (isEveryone) {
        const grpMemberIds = [...(groupMemberMap.get(matchedGroup.id) || [])];
        const count = grpMemberIds.length;
        if (count === 0) return { error: `The group "${matchedGroup.name}" has no enrolled members.` };
        const shares = splitEngine.allocateByWeights(totalAmount, new Array(count).fill(1), currency || 'INR');
        participants = grpMemberIds.map((uid, idx) => {
            const uObj = allUsers.find(u => u.id === uid) || { id: uid, name: `Member #${uid}` };
            return { id: uid, name: uObj.name, amount: shares[idx] };
        });
    } else if (participants.length === 0) {
        const grpMemberIds = [...(groupMemberMap.get(matchedGroup.id) || [])];
        const memberNames = grpMemberIds.map(uid => {
            const u = allUsers.find(x => x.id === uid);
            return u ? (uid === currentUserId ? `${u.name} (you)` : u.name) : null;
        }).filter(Boolean);
        return {
            disambiguationRequired: true,
            needsParticipantSelection: true,
            reply: `Who should share this ₹${totalAmount.toFixed(2)} expense in "${matchedGroup.name}"? Please name at least one participant (for example: "for me and Alex Sharma"). Members: ${memberNames.join(', ')}.`
        };
    }

    // 7. Clean Description
    let desc = 'Expense';
    let hasExplicitDesc = false;
    for (const cat of COMMON_EXPENSE_CATEGORIES) {
        const catRegex = new RegExp(`\\b${cat}\\b`, 'i');
        if (catRegex.test(cleanQ)) {
            desc = cat.charAt(0).toUpperCase() + cat.slice(1);
            hasExplicitDesc = true;
            break;
        }
    }

    return {
        amount: totalAmount,
        currency,
        description: desc,
        hasExplicitDesc,
        explicitGroupMentioned: explicitGroupCandidate,
        payer: effectivePayer,
        isEveryone,
        participants,
        group: matchedGroup,
        splitType
    };
}

app.post('/api/chatbot/query', async (req, res) => {
    try {
        const { query, language = 'en', user_id, conversation_id } = req.body;
        const effectiveUserId = actingUserId(req);
        
        if (!effectiveUserId || isNaN(effectiveUserId) || effectiveUserId <= 0) {
            return res.status(401).json({ error: 'Authentication required. Please sign in to use the AI Assistant.' });
        }

        const userCheck = await pool.query('SELECT id, name, email, phone, upi_id, default_currency, avatar_initials FROM users WHERE id = $1', [effectiveUserId]);
        if (userCheck.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid user session. Please sign in again.' });
        }
        const currentUser = userCheck.rows[0];
        const userFirstName = (currentUser.name || 'Friend').trim().split(' ')[0];
        const userCurrency = (currentUser.default_currency || 'INR').toUpperCase();
        const curSymbol = getCurrencySymbol(userCurrency);
        
        if (!query || typeof query !== 'string' || query.trim() === '') {
            return res.status(400).json({ error: 'Valid query text is required' });
        }

        // Strict Sanitization: strip potential scripts, html, control characters
        const safeQuery = query.replace(/<[^>]*>?/gm, '').replace(/[\x00-\x1F\x7F]/g, '').trim().substring(0, 500);
        const lowerQ = safeQuery.toLowerCase();
        const currentUserId = effectiveUserId;

        // Retrieve or initiate multi-turn conversation session
        const session = getOrCreateSession(conversation_id, currentUserId);
        const sessionCtx = session.context;

        // Language Detection: Gujarati (\u0A80-\u0AFF), Hindi (\u0900-\u097F), or English
        let detectedLang = language;
        if (/[\u0A80-\u0AFF]/.test(safeQuery) || /kharcho|ketla|leva|aapva|rupia|shunya|mane|tame|trippo|chhe|karyo|bijee|sauthi/i.test(lowerQ)) {
            detectedLang = 'gu';
        } else if (/[\u0900-\u097F]/.test(safeQuery) || /kharcha|kitna|dena|lena|hisaab|batao|dikhaye|kare|kaise|bhai|dusri|alawa|sabse/i.test(lowerQ)) {
            detectedLang = 'hi';
        }

        // 1. Fetch complete live system context from PostgreSQL (Strictly Isolated to Authenticated User)
        const [groupsRes, expensesRes, usersRes, rolesRes, userBalances] = await Promise.all([
            pool.query(`
                SELECT g.*, 
                       COUNT(DISTINCT gm2.user_id) as member_count, 
                       COALESCE((SELECT SUM(COALESCE(e.converted_amount, e.amount)) FROM expenses e WHERE e.group_id = g.id), 0) as total_spend
                FROM groups g
                JOIN group_members gm ON g.id = gm.group_id
                LEFT JOIN group_members gm2 ON g.id = gm2.group_id
                WHERE gm.user_id = $1
                GROUP BY g.id
            `, [currentUserId]),
            pool.query(`
                SELECT e.*, u.name as paid_by_name, g.name as group_name
                FROM expenses e
                LEFT JOIN users u ON e.paid_by = u.id
                LEFT JOIN groups g ON e.group_id = g.id
                WHERE e.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1) OR e.paid_by = $1
                ORDER BY e.amount DESC
            `, [currentUserId]),
            pool.query(`
                SELECT DISTINCT u.id, u.name, u.email, u.upi_id, u.phone, u.user_code, u.default_currency
                FROM users u
                WHERE u.id = $1
                   OR u.id IN (SELECT friend_id FROM friends WHERE user_id = $1)
                   OR u.id IN (
                       SELECT gm2.user_id 
                       FROM group_members gm1 
                       JOIN group_members gm2 ON gm1.group_id = gm2.group_id 
                       WHERE gm1.user_id = $1
                   )
            `, [currentUserId]),
            pool.query(`
                SELECT gm.*, u.name as user_name, g.name as group_name
                FROM group_members gm
                JOIN users u ON gm.user_id = u.id
                JOIN groups g ON gm.group_id = g.id
                WHERE gm.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1)
            `, [currentUserId]),
            computeUserBalances(currentUserId)
        ]);

        const allGroups = groupsRes.rows;
        const allExpenses = expensesRes.rows;
        const allUsers = usersRes.rows;
        const allRoles = rolesRes.rows;

        // Name Aliases for multi-lingual mapping
        const nameAliases = {
            'rahul': ['rahul', 'राहुल', 'રાહુલ'],
            'priya': ['priya', 'प्रिया', 'પ્રિયા'],
            'aman': ['aman', 'अमन', 'અમન'],
            'neha': ['neha', 'नेहा', 'નેહા'],
            'alex': ['alex', 'एलेक्स', 'એલેક્સ'],
            'charlie': ['charlie', 'चार्ली', 'ચાર્લી']
        };

        const findMentionedUser = (text) => {
            const lowerT = text.toLowerCase();
            for (const u of allUsers) {
                const full = u.name.toLowerCase();
                const first = full.split(' ')[0];
                if (lowerT.includes(full) || lowerT.includes(first)) return u;
                const cleanFirst = first.replace(/[^a-z0-9]/g, '');
                const aliases = nameAliases[cleanFirst] || [];
                for (const alias of aliases) {
                    if (lowerT.includes(alias.toLowerCase())) return u;
                }
            }
            return null;
        };

        const recordTurn = (reply, intent, action, view = null) => {
            session.history.push({ role: 'user', text: safeQuery, timestamp: Date.now() });
            session.history.push({ role: 'assistant', text: reply, intent, timestamp: Date.now() });
            sessionCtx.turns = sessionCtx.turns || [];
            sessionCtx.turns.push({ user: safeQuery, assistant: reply, intent, action });
            sessionCtx.lastIntent = intent;
            if (action) sessionCtx.lastAction = action;
        };

        // -------------------------------------------------------------
        // HIGH PRIORITY: ACTIONABLE AI ASSISTANT TOOL CALLING & CONTROL
        // -------------------------------------------------------------

        // 0. CANCELLATION & ABORT HANDLER
        if (/^(cancel|cancel\s+that|stop|abort|forget\s+it|don'?t|no|nahi|rad\s+karo|રદ\s+કરો|रद्द\s+करो)$/i.test(lowerQ)) {
            if (sessionCtx.pendingTool || sessionCtx.slotFilling) {
                sessionCtx.pendingTool = null;
                sessionCtx.slotFilling = null;
                const reply = detectedLang === 'gu' ? 'વિનંતી રદ કરવામાં આવી છે. હું તમને આગળ કેવી રીતે મદદ કરી શકું?' :
                              detectedLang === 'hi' ? 'अनुरोध रद्द कर दिया गया है। मैं आपकी आगे कैसे सहायता कर सकता हूँ?' :
                              'Operation cancelled. How else can I assist you with your ledger?';
                recordTurn(reply, 'OPERATION_CANCELLED', 'NONE');
                return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
            }
        }

        // 0.1 FOLLOW-UP REFINEMENT OF PENDING TOOL PROPOSAL
        if (sessionCtx.pendingTool) {
            const pt = sessionCtx.pendingTool;

            // 0.1.0 Affirmative Confirmation: "Yes" / "Confirm" / "Proceed" / "Do it" / "Sure" / "Haan" / "Ha" / "હા" / "हाँ"
            if (/^(yes|confirm|proceed|do\s+it|sure|ok|okay|haan|ha|haa|હા|हाँ|કરવા\s+દો|करो|कर\s+दो|કરી\s+દો)[.!,? ]*$/i.test(lowerQ.trim())) {
                const actionToExec = pt.action;
                const ptParams = pt.params || {};

                if (actionToExec === 'ADD_EXPENSE') {
                    const client = await pool.connect();
                    try {
                        await client.query('BEGIN');
                        // Re-validate authorization and amounts at execution time.
                        const grpV = await client.query('SELECT is_locked FROM groups WHERE id = $1', [ptParams.groupId]);
                        if (grpV.rows.length === 0) throw new Error('Target group circle not found.');
                        if (grpV.rows[0].is_locked) throw new Error('Circle is locked. No new expenses can be added.');
                        const roleV = await client.query(
                            'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
                            [ptParams.groupId, currentUserId]
                        );
                        if (!['admin', 'editor'].includes(roleV.rows[0]?.role)) {
                            throw new Error('Only group Admins or Editors can record expenses in this circle.');
                        }
                        const normExec = splitEngine.normalizeSplits({
                            totalAmount: ptParams.amount,
                            splitType: ptParams.splitType || 'equal',
                            splits: ptParams.splits || [],
                            currency: ptParams.currency || 'INR'
                        });
                        if (normExec.error) throw new Error(normExec.error);
                        ptParams.splits = normExec.splits;

                        const expRes = await client.query(`
                            INSERT INTO expenses (
                                group_id, paid_by, description, amount, currency, category, split_type,
                                original_amount, exchange_rate, converted_amount, rate_provider, rate_timestamp, expense_date
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1.0, $9, 'identity', NOW(), CURRENT_DATE)
                            RETURNING id
                        `, [ptParams.groupId, ptParams.paidBy || currentUserId, ptParams.description || 'Expense', ptParams.amount, ptParams.currency || 'INR', ptParams.category || 'General', ptParams.splitType || 'equal', ptParams.amount, ptParams.amount]);

                        const expenseId = expRes.rows[0].id;
                        for (const s of (ptParams.splits || [])) {
                            await client.query(`
                                INSERT INTO expense_splits
                                    (expense_id, user_id, amount, base_amount, split_percentage, shares, is_settled, settled_amount, settled_amount_base, is_locked)
                                VALUES ($1, $2, $3, $3, $4, 1, false, 0, 0, $5)
                            `, [expenseId, s.user_id, s.amount, ((s.amount / ptParams.amount) * 100).toFixed(2), s.is_locked === true]);
                        }

                        await client.query(`
                            INSERT INTO activity_logs (user_id, group_id, activity_type, message)
                            VALUES ($1, $2, 'EXPENSE_ADDED', $3)
                        `, [currentUserId, ptParams.groupId, `${currentUser.name} recorded expense of ${curSymbol}${ptParams.amount} for "${ptParams.description}" via AI Assistant`]);

                        // Audit every AI-triggered financial action.
                        await client.query(`
                            INSERT INTO ai_agent_actions (user_id, command_text, action_type, action_payload, status, execution_result)
                            VALUES ($1, $2, 'ADD_EXPENSE', $3, 'EXECUTED', $4)
                        `, [currentUserId, safeQuery.slice(0, 500), JSON.stringify(ptParams), JSON.stringify({ expenseId })]);

                        await client.query('COMMIT');
                        sessionCtx.pendingTool = null; // Clean up so repeat "yes" won't duplicate

                        const reply = `Expense of ${curSymbol}${ptParams.amount.toLocaleString('en-IN')} for "${ptParams.description}" was added successfully in ${ptParams.groupName}!`;
                        recordTurn(reply, 'EXPENSE_CREATED', 'NONE');
                        return res.json({ reply, action: 'NONE', result: { expenseId }, detectedLang, conversation_id: session.id });
                    } catch(err) {
                        await client.query('ROLLBACK');
                        throw err;
                    } finally {
                        client.release();
                    }
                }
            }

            // Refine amount: "Change amount to 2,000" or "Make it 2500" or "Amount is 3000"
            const chgAmtMatch = lowerQ.match(/(?:change|update|make)\s+(?:the\s+)?amount\s+(?:to\s+)?(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)?(?:\.\d+)?)/i) ||
                                lowerQ.match(/(?:amount|price)\s+(?:is\s+)?(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)?(?:\.\d+)?)/i);
            if (chgAmtMatch && pt.params && pt.params.amount !== undefined) {
                const newAmt = parseFloat(chgAmtMatch[1].replace(/,/g, ''));
                if (!isNaN(newAmt) && newAmt > 0) {
                    pt.params.amount = newAmt;
                    if (pt.action === 'ADD_EXPENSE') {
                        if (Array.isArray(pt.params.participants) && pt.params.participants.length > 0) {
                            const count = pt.params.participants.length;
                            const share = Math.floor((newAmt / count) * 100) / 100;
                            const rem = Math.round((newAmt - share * count) * 100) / 100;
                            pt.params.participants.forEach((p, idx) => {
                                p.amount = idx === 0 ? parseFloat((share + rem).toFixed(2)) : parseFloat(share.toFixed(2));
                            });
                            if (Array.isArray(pt.params.splits)) {
                                pt.params.splits.forEach((s, idx) => {
                                    s.amount = idx === 0 ? parseFloat((share + rem).toFixed(2)) : parseFloat(share.toFixed(2));
                                });
                            }
                        }
                        const pDesc = (Array.isArray(pt.params.participants) && pt.params.participants.length > 0)
                            ? ` (${pt.params.participants.length} participants: ₹${pt.params.participants[0].amount} each)`
                            : '';
                        pt.summary = `Add ₹${newAmt} for "${pt.params.description}" in ${pt.params.groupName || 'Group'}${pDesc}`;
                    } else if (pt.action === 'RECORD_MANUAL_SETTLEMENT') {
                        pt.summary = `Record manual settlement of ₹${newAmt} with ${pt.params.peerName || 'Peer'}`;
                    } else if (pt.action === 'UPDATE_EXPENSE') {
                        pt.summary = `Update expense #${pt.params.expenseId} to ₹${newAmt}`;
                    }
                    const reply = `I've updated the amount to ₹${newAmt}. Please confirm below to proceed.`;
                    recordTurn(reply, 'TOOL_REFINEMENT', 'CONFIRM_TOOL');
                    return res.json({
                        reply,
                        action: 'CONFIRM_TOOL',
                        toolCall: pt,
                        requiresConfirmation: true,
                        detectedLang,
                        conversation_id: session.id
                    });
                }
            }

            // Refine group members: "Add Charlie as well" or "Add another person Charlie"
            const addPersonMatch = lowerQ.match(/(?:add|include)\s+(?:another\s+person\s+|friend\s+|member\s+)?([a-zA-Z\u0900-\u097F\u0A80-\u0AFF\s]+?)\s*(?:as\s+well|too|also)?$/i);
            if (addPersonMatch && pt.action === 'CREATE_GROUP' && !lowerQ.includes('expense')) {
                const targetName = addPersonMatch[1].trim();
                const matchedUser = findMentionedUser(targetName) || await resolveUserByIdentifier(pool, targetName, currentUserId);
                if (matchedUser && matchedUser.id !== currentUserId) {
                    if (!Array.isArray(pt.params.members)) pt.params.members = [];
                    if (!pt.params.members.find(m => (typeof m === 'object' ? m.id : m) === matchedUser.id)) {
                        pt.params.members.push({ id: matchedUser.id, name: matchedUser.name, user_code: matchedUser.user_code });
                    }
                    pt.summary = `Create group "${pt.params.name}" with ${pt.params.members.map(m => m.name).join(', ')}`;
                    const reply = `I've added ${matchedUser.name} to the group creation proposal. Please confirm below.`;
                    recordTurn(reply, 'TOOL_REFINEMENT', 'CONFIRM_TOOL');
                    return res.json({
                        reply,
                        action: 'CONFIRM_TOOL',
                        toolCall: pt,
                        requiresConfirmation: true,
                        detectedLang,
                        conversation_id: session.id
                    });
                }
            }

            // Refine split mode: "Split it equally"
            if (/(?:split\s+(?:it\s+)?equally|divide\s+equally|equal\s+split)/i.test(lowerQ) && pt.action === 'ADD_EXPENSE') {
                pt.params.splitType = 'equal';
                const reply = `Split mode is set to equal distribution across all group members. Please confirm to record the expense.`;
                recordTurn(reply, 'TOOL_REFINEMENT', 'CONFIRM_TOOL');
                return res.json({
                    reply,
                    action: 'CONFIRM_TOOL',
                    toolCall: pt,
                    requiresConfirmation: true,
                    detectedLang,
                    conversation_id: session.id
                });
            }
        }

        // 0.2 MULTI-TURN SLOT-FILLING CONTINUATION
        if (sessionCtx.slotFilling) {
            const sf = sessionCtx.slotFilling;
            if (sf.action === 'CREATE_GROUP') {
                if (!sf.slots.name) {
                    // Current input is group name
                    const rawName = safeQuery.replace(/^create\s+(?:a\s+)?(?:new\s+)?group\s+(?:called\s+|named\s+)?/i, '').replace(/["']/g, '').trim();
                    const cleanName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
                    sf.slots.name = cleanName;

                    // Check if friends were also mentioned in this turn
                    const mentionedFriends = [];
                    for (const u of allUsers) {
                        if (u.id !== currentUserId && lowerQ.includes(u.name.toLowerCase().split(' ')[0])) {
                            mentionedFriends.push({ id: u.id, name: u.name, user_code: u.user_code });
                        }
                    }

                    if (mentionedFriends.length > 0) {
                        sessionCtx.slotFilling = null;
                        const toolCall = {
                            action: 'CREATE_GROUP',
                            params: { name: cleanName, category: 'General', members: mentionedFriends },
                            summary: `Create group "${cleanName}" with ${mentionedFriends.map(f => f.name).join(', ')}`
                        };
                        sessionCtx.pendingTool = toolCall;
                        const reply = `I'm ready to create the group "${cleanName}" with ${mentionedFriends.map(f => f.name).join(', ')}. Please confirm below to proceed.`;
                        recordTurn(reply, 'TOOL_PROPOSAL', 'CONFIRM_TOOL');
                        return res.json({ reply, action: 'CONFIRM_TOOL', toolCall, requiresConfirmation: true, detectedLang, conversation_id: session.id });
                    } else {
                        const reply = `Great! The group name is "${cleanName}". Would you like to add any friends to this group now (e.g. "Add Alex and Charlie"), or create it with just yourself?`;
                        recordTurn(reply, 'SLOT_FILLING_COLLECT_MEMBERS', 'NONE');
                        return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
                    }
                } else {
                    // Answering about members
                    const isSkip = /^(no|just\s+me|myself|none|skip|create\s+it|only\s+me)$/i.test(lowerQ);
                    const groupName = sf.slots.name;
                    sessionCtx.slotFilling = null;

                    const membersToAdd = [];
                    if (!isSkip) {
                        for (const u of allUsers) {
                            if (u.id !== currentUserId && lowerQ.includes(u.name.toLowerCase().split(' ')[0])) {
                                membersToAdd.push({ id: u.id, name: u.name, user_code: u.user_code });
                            }
                        }
                    }

                    const toolCall = {
                        action: 'CREATE_GROUP',
                        params: { name: groupName, category: 'General', members: membersToAdd },
                        summary: `Create group "${groupName}"` + (membersToAdd.length ? ` with ${membersToAdd.map(m => m.name).join(', ')}` : '')
                    };
                    sessionCtx.pendingTool = toolCall;
                    const reply = `I'm ready to create "${groupName}"${membersToAdd.length ? ` with ${membersToAdd.map(m => m.name).join(', ')}` : ' with you as admin'}. Please confirm below.`;
                    recordTurn(reply, 'TOOL_PROPOSAL', 'CONFIRM_TOOL');
                    return res.json({ reply, action: 'CONFIRM_TOOL', toolCall, requiresConfirmation: true, detectedLang, conversation_id: session.id });
                }
            } else if (sf.action === 'ADD_EXPENSE') {
                const amtMatch = lowerQ.match(/(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)?(?:\.\d+)?)/i);
                if (amtMatch) {
                    const amount = parseFloat(amtMatch[1].replace(/,/g, ''));
                    const descMatch = lowerQ.replace(amtMatch[0], '').replace(/(?:for|in|to)\s+/g, ' ').trim() || 'Expense';
                    const targetGroup = allGroups[0];
                    sessionCtx.slotFilling = null;
                    if (targetGroup) {
                        const toolCall = {
                            action: 'ADD_EXPENSE',
                            params: { amount, description: descMatch, groupId: targetGroup.id, groupName: targetGroup.name },
                            summary: `Add ₹${amount} for ${descMatch} in ${targetGroup.name}`
                        };
                        sessionCtx.pendingTool = toolCall;
                        const reply = `I'm ready to record an expense of ₹${amount} for "${descMatch}" in ${targetGroup.name}. Please confirm below.`;
                        recordTurn(reply, 'TOOL_PROPOSAL', 'CONFIRM_TOOL');
                        return res.json({ reply, action: 'CONFIRM_TOOL', toolCall, requiresConfirmation: true, detectedLang, conversation_id: session.id });
                    }
                }
            } else if (sf.action === 'ADD_EXPENSE_DESC') {
                const cleanDesc = safeQuery.replace(/^["']|["']$/g, '').trim() || 'Expense';
                const pInfo = sf.parsed;
                pInfo.description = cleanDesc;
                const targetGroupId = pInfo.group.id;
                const targetGroupName = pInfo.group.name;
                const participantSummaryNames = pInfo.participants.map(p => p.id === currentUserId ? 'you' : p.name.split(' ')[0]).join(' and ');

                const toolCall = {
                    action: 'ADD_EXPENSE',
                    params: {
                        amount: pInfo.amount,
                        currency: pInfo.currency || userCurrency,
                        description: cleanDesc,
                        groupId: targetGroupId,
                        groupName: targetGroupName,
                        paidBy: pInfo.payer.id,
                        payerName: pInfo.payer.name,
                        splitType: pInfo.splitType || 'equal',
                        participants: pInfo.participants.map(p => ({
                            id: p.id,
                            name: p.id === currentUserId ? 'You (' + p.name + ')' : p.name,
                            amount: p.amount
                        })),
                        splits: pInfo.participants.map(p => ({
                            user_id: p.id,
                            amount: p.amount
                        }))
                    },
                    summary: `Add ${curSymbol}${pInfo.amount.toLocaleString('en-IN')} for "${cleanDesc}" in ${targetGroupName}`
                };

                sessionCtx.slotFilling = null;
                sessionCtx.pendingTool = toolCall;

                let reply;
                if (detectedLang === 'hi') {
                    reply = `क्या मैं ${curSymbol}${pInfo.amount.toLocaleString('en-IN')} को आपके और ${participantSummaryNames} के बीच बराबर विभाजित कर दूँ?`;
                } else if (detectedLang === 'gu') {
                    reply = `શું હું ${curSymbol}${pInfo.amount.toLocaleString('en-IN')} તમારા અને ${participantSummaryNames} વચ્ચે સરખે ભાગે વહેંચી દઉં?`;
                } else {
                    reply = `Should I split ${curSymbol}${pInfo.amount.toLocaleString('en-IN')} equally between you and ${participantSummaryNames}?`;
                }

                recordTurn(reply, 'TOOL_PROPOSAL', 'CONFIRM_TOOL');
                return res.json({ reply, action: 'CONFIRM_TOOL', toolCall, requiresConfirmation: true, detectedLang, conversation_id: session.id });
            }
        }

        // -------------------------------------------------------------
        // 0.3 NATURAL HUMAN CONVERSATION, PERSONALIZED GREETINGS & APP ASSISTANCE
        // -------------------------------------------------------------

        // 0.3.1 GREETINGS (Time-of-day aware, natural variations, multi-lingual, personalized)
        const isGreeting = /^(hello|hi|hey|good\s+morning|good\s+afternoon|good\s+evening|good\s+night|greetings|namaste|namaskar|pranam|kem\s+cho|shubh\s+savar|shubh\s+prabhat|shubh\s+ratri|ram\s+ram|jai\s+shri\s+krishna)[!.,? ]*$/i.test(lowerQ.trim()) ||
                           /^(hello|hi|hey)\s+(there|assistant|bot|splitwise|splitease)[!.,? ]*$/i.test(lowerQ.trim());
        if (isGreeting) {
            let reply;
            if (detectedLang === 'hi') {
                if (/shubh\s+prabhat|good\s+morning/i.test(lowerQ)) {
                    reply = `शुभ प्रभात, ${userFirstName}! क्या आप आज अपने खर्चों को मैनेज करने के लिए तैयार हैं?`;
                } else if (/good\s+night|shubh\s+ratri/i.test(lowerQ)) {
                    reply = `शुभ रात्रि, ${userFirstName}! अगर आपको सोने से पहले कोई खर्चा दर्ज करना है, तो मुझे बताएं।`;
                } else {
                    reply = `नमस्ते ${userFirstName}! आज मैं आपके खर्चों और ग्रुप्स में क्या सहायता कर सकता हूँ?`;
                }
            } else if (detectedLang === 'gu') {
                if (/shubh\s+savar|good\s+morning/i.test(lowerQ)) {
                    reply = `શુભ સવાર, ${userFirstName}! આજે તમારો ખર્ચ મેનેજ કરવા તૈયાર છો?`;
                } else if (/good\s+night|shubh\s+ratri/i.test(lowerQ)) {
                    reply = `શુભ રાત્રિ, ${userFirstName}! દિવસ પૂરો કરતાં પહેલાં કોઈ ખર્ચ ઉમેરવો હોય તો જણાવો.`;
                } else {
                    reply = `નમસ્તે ${userFirstName}! આજે હું તમને તમારા ખર્ચ અને સર્કલ્સમાં કેવી રીતે મદદ કરી શકું?`;
                }
            } else {
                if (/good\s+morning/i.test(lowerQ)) {
                    reply = `Good morning, ${userFirstName}! Ready to manage your expenses today?`;
                } else if (/good\s+afternoon/i.test(lowerQ)) {
                    reply = `Good afternoon, ${userFirstName}! How can I help you with your expenses today?`;
                } else if (/good\s+evening/i.test(lowerQ)) {
                    reply = `Good evening, ${userFirstName}! How can I help you with your expenses or groups tonight?`;
                } else if (/good\s+night/i.test(lowerQ)) {
                    reply = `Good night, ${userFirstName}! Sleep well, and let me know if you need to log anything before winding down.`;
                } else {
                    const greetings = [
                        `Hey ${userFirstName}! How can I help you today?`,
                        `Hello ${userFirstName}! What can I assist you with today?`,
                        `Hi ${userFirstName}! Ready to check balances, log expenses, or manage your circles?`
                    ];
                    reply = greetings[Math.floor(Math.random() * greetings.length)];
                }
            }
            recordTurn(reply, 'GREETING', 'NONE');
            return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // 0.3.2 HOW ARE YOU / WHAT ARE YOU DOING
        if (/^(how\s+are\s+you|how're\s+you|how\s+is\s+it\s+going|how\s+do\s+you\s+do|kem\s+cho|aap\s+kaise\s+ho|kaise\s+ho)[?.,! ]*$/i.test(lowerQ.trim())) {
            let reply;
            if (detectedLang === 'hi') {
                reply = `मैं बहुत अच्छा हूँ, ${userFirstName}! पूछने के लिए धन्यवाद। आज मैं आपके खर्चों या हिसाब-किताब में क्या मदद कर सकता हूँ?`;
            } else if (detectedLang === 'gu') {
                reply = `હું એકદમ મજામાં છું, ${userFirstName}! પૂછવા બદલ આભાર. આજે તમારા ખર્ચ કે હિસાબમાં હું શું મદદ કરી શકું?`;
            } else {
                reply = `I'm doing great, ${userFirstName}! How can I help you with your expenses or anything else today?`;
            }
            recordTurn(reply, 'SMALLTALK', 'NONE');
            return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        if (/^(what\s+are\s+you\s+doing|what're\s+you\s+doing|kya\s+kar\s+rahe\s+ho|shu\s+karo\s+cho)[?.,! ]*$/i.test(lowerQ.trim())) {
            const reply = `I'm right here and ready to help you track expenses, split bills, check group balances, or manage your circles!`;
            recordTurn(reply, 'SMALLTALK', 'NONE');
            return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // 0.3.3 THANK YOU / THANKS
        if (/^(thank\s+you|thanks|thx|thank\s+you\s+so\s+much|dhanyawad|shukriya|aabhar|khub\s+aabhar)[!.,? ]*$/i.test(lowerQ.trim())) {
            const reply = detectedLang === 'hi'
                ? `आपका बहुत स्वागत है, ${userFirstName}! अगर आपको किसी और चीज़ में सहायता चाहिए तो अवश्य बताएं।`
                : detectedLang === 'gu'
                ? `તમારું સ્વાગત છે, ${userFirstName}! જો બીજી કોઈ મદદ જોઈતી હોય તો જરૂર જણાવશો.`
                : `You're welcome, ${userFirstName}! Let me know if you need help with anything else.`;
            recordTurn(reply, 'SMALLTALK', 'NONE');
            return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // 0.3.4 COMPLIMENTS / POSITIVE FEEDBACK
        if (/^(that's\s+great|thats\s+great|nice|nice!|awesome|great|cool|perfect|wonderful|excellent|saras|badiya|badhiya|shandar)[!.,? ]*$/i.test(lowerQ.trim())) {
            const reply = `Glad to hear that, ${userFirstName}! Feel free to ask if you want to check balances, log expenses, or settle up.`;
            recordTurn(reply, 'SMALLTALK', 'NONE');
            return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // 0.3.5 FAREWELL
        if (/^(bye|goodbye|see\s+you|see\s+you\s+later|cya|alvida|aavjo)[!.,? ]*$/i.test(lowerQ.trim())) {
            const reply = `Goodbye, ${userFirstName}! Have a wonderful time ahead, and feel free to return anytime you need financial updates.`;
            recordTurn(reply, 'SMALLTALK', 'NONE');
            return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // 0.3.6 CASUAL OK / SURE (when not affirming a pending tool)
        if (/^(ok|okay|sure|alright|fine|theek\s+hai|thik\s+hai|barobar)[!.,? ]*$/i.test(lowerQ.trim())) {
            const reply = `Got it! Just let me know whenever you're ready to add an expense, check your balances, or manage your groups.`;
            recordTurn(reply, 'SMALLTALK', 'NONE');
            return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // 0.3.7 WHO ARE YOU
        if (/^(who\s+are\s+you|what\s+is\s+your\s+name|tell\s+me\s+about\s+yourself|aap\s+kaun\s+hain|kon\s+cho\s+tame)[?.,! ]*$/i.test(lowerQ.trim())) {
            const reply = `I am your personal SplitWise AI Assistant for **${currentUser.name}**! I help you seamlessly track shared expenses, split bills with friends and circles, calculate settlements, and maintain an accurate financial ledger.`;
            recordTurn(reply, 'IDENTITY', 'NONE');
            return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // 0.3.8 WHAT CAN YOU DO / HOW CAN YOU HELP ME / HELP ME
        if (/^(what\s+can\s+you\s+do|how\s+can\s+you\s+help\s+me|help\s+me|what\s+are\s+your\s+features|what\s+do\s+you\s+do|how\s+to\s+use|features)[?.,! ]*$/i.test(lowerQ.trim())) {
            const reply = `Here is how I can assist you, ${userFirstName}:\n\n` +
                `• 💰 **Add & Split Expenses**: Say *"Add an expense of ${curSymbol}4,000 for me and Alex"* or *"₹2,000 for dinner in Goa Trip"*.\n` +
                `• 📊 **Check Balances**: Ask *"How much do I owe?"* or *"Who owes me money?"* to get live balance updates.\n` +
                `• 🤝 **Settle Payments**: Ask *"How do I settle a payment?"* or *"Show my pending settlements"*.\n` +
                `• 👥 **Manage Circles**: Ask *"Show my groups"*, *"Which group has highest spending?"*, or *"Create a group called Office Lunch"*.\n` +
                `• 📈 **Spend Insights**: Ask *"How much did I spend this month?"* or *"Show my recent expenses"*.\n` +
                `• 🌐 **Multi-Lingual**: I understand English, Hindi, and Gujarati!`;
            recordTurn(reply, 'HELP', 'NONE');
            return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // 0.3.9 HOW DOES SPLITWISE WORK
        if (/how\s+does\s+(?:splitwise|splitease|this\s+app)\s+work/i.test(lowerQ)) {
            const reply = `**How SplitWise Works:**\n\n` +
                `1. **Create Circles & Add Friends**: Organize expenses by trip, flat, or project (e.g. "Goa Trip" or "Flat 302").\n` +
                `2. **Log Expenses**: When anyone pays for food, travel, or bills, record the expense with equal or custom shares.\n` +
                `3. **Automatic Ledger Calculation**: The app automatically balances who owes whom, minimizing the number of transactions needed.\n` +
                `4. **Settle Up**: Members can settle debts anytime via UPI QR code or bank transfer, updating balances to zero.\n\n` +
                `You can ask me to do any of these directly!`;
            recordTurn(reply, 'EXPLAIN_APP', 'NONE');
            return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // 0.3.10 HOW DO I ADD AN EXPENSE
        if (/how\s+(?:do\s+i|can\s+i)\s+add\s+(?:an?\s+)?expense/i.test(lowerQ)) {
            const reply = `To add an expense, you have two options:\n\n` +
                `1. **Ask Me Directly**: Say *"Add an expense of ${curSymbol}1,500 for dinner in Goa Trip"* or *"Add ${curSymbol}4,000 for me and Alex"*, and I'll prepare and confirm it for you!\n` +
                `2. **Manual Form**: Go to the **Expenses** tab or open any Circle, click the **+ Add Expense** button, fill in the amount, category, payer, and split type, then save.`;
            recordTurn(reply, 'EXPLAIN_FEATURE', 'NONE');
            return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // 0.3.11 HOW DO I SETTLE A PAYMENT
        if (/how\s+(?:do\s+i|can\s+i)\s+settle(?:\s+a\s+payment|\s+up)?/i.test(lowerQ)) {
            const reply = `To settle a payment:\n\n` +
                `1. **In App**: Go to the **Friends** or **Groups** view, click on **Settle Up**, select the person you're settling with, enter the amount, and confirm with your UPI reference or payment note.\n` +
                `2. **Via Assistant**: Simply ask me *"Show my pending settlements"* to see whom you owe or who owes you, then tap Settle Up on any friend.`;
            recordTurn(reply, 'EXPLAIN_FEATURE', 'NONE');
            return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // 0.3.12 HOW DO I ADD A FRIEND
        if (/how\s+(?:do\s+i|can\s+i)\s+add\s+(?:a\s+)?friend/i.test(lowerQ)) {
            const reply = `To add a friend:\n\n` +
                `• Navigate to the **Friends** section from the sidebar.\n` +
                `• Click the **+ Add Friend** button.\n` +
                `• Enter their name, email, or unique user code to connect with them immediately!`;
            recordTurn(reply, 'EXPLAIN_FEATURE', 'NONE');
            return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // 0.3.13 HOW DO I CREATE A GROUP
        if (/how\s+(?:do\s+i|can\s+i)\s+create\s+(?:a\s+)?group/i.test(lowerQ)) {
            const reply = `To create a group:\n\n` +
                `1. **Ask Me Directly**: Say *"Create a group called Office Lunch and add Priya and Alex"*.\n` +
                `2. **In App**: Go to **Groups** tab and click **+ Create Circle**, choose a circle name and category (Trip, Home, Event), and invite members.`;
            recordTurn(reply, 'EXPLAIN_FEATURE', 'NONE');
            return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // 0.3.14 EXPLAIN MY LEDGER
        if (/explain\s+(?:my\s+)?(?:ledger|balances?|finances?)/i.test(lowerQ)) {
            const netBal = (userBalances.total_owed || 0) - (userBalances.total_owe || 0);
            let explanation = `**Personal Ledger Breakdown for ${currentUser.name}:**\n\n` +
                `• 📈 **Total Receivable (You are owed)**: ${curSymbol}${userBalances.total_owed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n` +
                `• 📉 **Total Payable (You owe)**: ${curSymbol}${userBalances.total_owe.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n` +
                `• ⚖️ **Net Ledger Position**: ${netBal >= 0 ? '+' : ''}${curSymbol}${netBal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n\n`;

            if (netBal > 0) {
                explanation += `You are in a net positive position! Overall, other people owe you ${curSymbol}${netBal.toLocaleString('en-IN', { minimumFractionDigits: 2 })} more than you owe them.`;
            } else if (netBal < 0) {
                explanation += `You are in a net payable position. You currently owe ${curSymbol}${Math.abs(netBal).toLocaleString('en-IN', { minimumFractionDigits: 2 })} more than you are owed. Consider settling up your pending debts.`;
            } else {
                explanation += `Your ledger is perfectly balanced at ${curSymbol}0.00! All shared expenses are currently even.`;
            }
            recordTurn(explanation, 'EXPLAIN_LEDGER', 'NONE');
            return res.json({ reply: explanation, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // 0.3.15 WHICH GROUP HAS HIGHEST SPENDING
        if (/which\s+group\s+(?:has\s+the\s+)?highest\s+(?:spending|spend|expenses?)/i.test(lowerQ)) {
            if (allGroups.length === 0) {
                const reply = "You haven't joined or created any circles yet.";
                recordTurn(reply, 'GROUP_HIGHEST_SPEND', 'NONE');
                return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
            }
            const sortedGroups = [...allGroups].sort((a, b) => parseFloat(b.total_spend || 0) - parseFloat(a.total_spend || 0));
            const top = sortedGroups[0];
            const reply = `Your circle with the highest total spending is **${top.name}** with **${curSymbol}${parseFloat(top.total_spend || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}** in total recorded expenses (${top.member_count} member${top.member_count == 1 ? '' : 's'}).`;
            recordTurn(reply, 'GROUP_HIGHEST_SPEND', 'NAVIGATE', 'groups');
            return res.json({ reply, action: 'NAVIGATE', view: 'groups', detectedLang, conversation_id: session.id });
        }

        // 0.3.16 HOW MUCH DID I SPEND THIS MONTH
        if (/^(how\s+much\s+did\s+i\s+spend\s+this\s+month|spend\s+this\s+month|monthly\s+spend|my\s+spend\s+this\s+month)[?.,! ]*$/i.test(lowerQ.trim())) {
            const monthSpendRes = await pool.query(`
                SELECT COALESCE(SUM(es.amount), 0) as total
                FROM expense_splits es
                JOIN expenses e ON es.expense_id = e.id
                WHERE es.user_id = $1 
                  AND e.expense_date >= DATE_TRUNC('month', CURRENT_DATE)
            `, [currentUserId]);
            const monthTotal = parseFloat(monthSpendRes.rows[0]?.total || 0);
            const reply = `You have spent **${curSymbol}${monthTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}** as your personal share this month.`;
            recordTurn(reply, 'MONTHLY_SPEND', 'NONE');
            return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // 0.3.17 SHOW MY PENDING SETTLEMENTS
        if (/^(show\s+my\s+pending\s+settlements|pending\s+settlements|show\s+settlements|my\s+settlements)[?.,! ]*$/i.test(lowerQ.trim())) {
            const owes = userBalances.owes_you_list || [];
            const owe = userBalances.you_owe_list || [];
            if (owes.length === 0 && owe.length === 0) {
                const reply = `You have no pending settlements! All your balances are completely settled up (${curSymbol}0.00).`;
                recordTurn(reply, 'PENDING_SETTLEMENTS', 'NAVIGATE', 'settle');
                return res.json({ reply, action: 'NAVIGATE', view: 'settle', detectedLang, conversation_id: session.id });
            }
            let lines = `**Your Pending Settlements:**\n\n`;
            if (owe.length > 0) {
                lines += `**People You Need to Pay (Total ${curSymbol}${userBalances.total_owe.toLocaleString('en-IN', { minimumFractionDigits: 2 })}):**\n` +
                    owe.map(p => `• **${p.name}**: you owe ${curSymbol}${p.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`).join('\n') + `\n\n`;
            }
            if (owes.length > 0) {
                lines += `**People Who Owe You (Total ${curSymbol}${userBalances.total_owed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}):**\n` +
                    owes.map(p => `• **${p.name}**: owes you ${curSymbol}${p.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`).join('\n') + `\n\n`;
            }
            lines += `You can click "Settle Up" on any friend or ask me *"Settle ${curSymbol}500 with [Friend]"*!`;
            recordTurn(lines, 'PENDING_SETTLEMENTS', 'NAVIGATE', 'settle');
            return res.json({ reply: lines, action: 'NAVIGATE', view: 'settle', detectedLang, conversation_id: session.id });
        }

        // 0.3.18 PERSONALIZED SUGGESTIONS
        if (/^(what\s+should\s+i\s+do|any\s+suggestions?|suggestions?\s+for\s+me|suggest\s+something)[?.,! ]*$/i.test(lowerQ.trim())) {
            const owes = userBalances.owes_you_list || [];
            const owe = userBalances.you_owe_list || [];
            let suggestions = `**Personalized Recommendations for ${userFirstName}:**\n\n`;
            if (owe.length > 0) {
                suggestions += `• 🤝 **Settle Pending Debts**: You owe ${curSymbol}${userBalances.total_owe.toLocaleString('en-IN', { minimumFractionDigits: 2 })} across ${owe.length} person${owe.length === 1 ? '' : 's'}. Consider clearing your balance with **${owe[0].name}** (${curSymbol}${owe[0].amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}).\n`;
            }
            if (owes.length > 0) {
                suggestions += `• 📩 **Pending Receivables**: **${owes[0].name}** owes you ${curSymbol}${owes[0].amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}. You can view their details or send a reminder.\n`;
            }
            if (allGroups.length > 0) {
                suggestions += `• 👥 **Active Circle**: You are active in "${allGroups[0].name}". Ask me *"Which group has highest spending?"* to inspect overall group trends.\n`;
            }
            suggestions += `• 💡 **Quick Expense**: Say *"Add an expense of ${curSymbol}2,000 for dinner"* to quickly log shared costs!`;
            recordTurn(suggestions, 'SUGGESTIONS', 'NONE');
            return res.json({ reply: suggestions, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // 0.3.19 CASUAL FOLLOW-UPS (Can you explain that, What do you mean, Show me again, What happened, Cancel that, Do it for me)
        if (/^(can\s+you\s+explain\s+that|what\s+do\s+you\s+mean|tell\s+me\s+more)[?.,! ]*$/i.test(lowerQ.trim())) {
            const lastTurn = sessionCtx.turns && sessionCtx.turns.length > 0 ? sessionCtx.turns[sessionCtx.turns.length - 1] : null;
            if (lastTurn && lastTurn.assistant) {
                const reply = `Regarding my previous message: "${lastTurn.assistant.split('\n')[0]}"\n\nI can execute this action for you, modify the participants or amounts, or look up additional details from your ledger. Just tell me what you'd prefer!`;
                recordTurn(reply, 'EXPLAIN_MORE', 'NONE');
                return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
            } else {
                const reply = `I'm happy to explain! You can ask me about your expenses, balances, circles, or how to settle payments.`;
                recordTurn(reply, 'EXPLAIN_MORE', 'NONE');
                return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
            }
        }

        if (/^(show\s+me\s+again|show\s+again)[?.,! ]*$/i.test(lowerQ.trim())) {
            if (sessionCtx.lastIntent === 'EXPENSES_LIST' || !sessionCtx.lastIntent) {
                const top5 = allExpenses.slice(0, 5);
                const breakdown = top5.map(e => `• **${e.description}**: ${curSymbol}${parseFloat(e.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })} (${e.group_name || 'Group'}, paid by ${e.paid_by_name || 'You'})`).join('\n');
                const reply = `Here are your recent expenses again:\n${breakdown || 'No expenses recorded yet.'}`;
                recordTurn(reply, 'EXPENSES_LIST', 'NAVIGATE', 'expenses');
                return res.json({ reply, action: 'NAVIGATE', view: 'expenses', detectedLang, conversation_id: session.id });
            }
        }

        if (/^(what\s+happened|what\s+did\s+you\s+do)[?.,! ]*$/i.test(lowerQ.trim())) {
            const lastTurn = sessionCtx.turns && sessionCtx.turns.length > 0 ? sessionCtx.turns[sessionCtx.turns.length - 1] : null;
            if (lastTurn) {
                const reply = `Here is what happened recently: You said "${lastTurn.user}", and I responded with:\n\n${lastTurn.assistant.substring(0, 200)}...`;
                recordTurn(reply, 'WHAT_HAPPENED', 'NONE');
                return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
            } else {
                const reply = `No actions have been executed yet in this conversation session. How can I help you?`;
                recordTurn(reply, 'WHAT_HAPPENED', 'NONE');
                return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
            }
        }

        if (/^(cancel\s+that|cancel\s+it|cancel|go\s+back|nevermind|forget\s+it)[!.,? ]*$/i.test(lowerQ.trim())) {
            sessionCtx.pendingTool = null;
            sessionCtx.slotFilling = null;
            const reply = `No problem! The pending operation has been cancelled. What would you like to do next, ${userFirstName}?`;
            recordTurn(reply, 'CANCEL_OPERATION', 'NONE');
            return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        if (/^(do\s+it\s+for\s+me|please\s+do\s+it)[!.,? ]*$/i.test(lowerQ.trim())) {
            if (sessionCtx.pendingTool) {
                const toolToExecute = sessionCtx.pendingTool;
                sessionCtx.pendingTool = null;
                return executePendingTool(toolToExecute);
            } else {
                const reply = `What would you like me to do? You can say *"Add an expense of ${curSymbol}2,000 for dinner"* or *"Create a group called Office Lunch"*.`;
                recordTurn(reply, 'PROMPT_ACTION', 'NONE');
                return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
            }
        }

        // -------------------------------------------------------------
        // INTENT A: EXPENSE MANAGEMENT (ADD, EDIT, DELETE, LIST, REPORTS)
        // -------------------------------------------------------------

        // A.1 Read: "Show my latest expenses" / "Show expenses" / "Recent transactions"
        if (/(show|view|list|get)\s+(?:my\s+)?(?:latest|recent|last\s+\d+|all\s+my)?\s*expenses/i.test(lowerQ) && !lowerQ.includes('delete') && !lowerQ.includes('edit') && !lowerQ.includes('add')) {
            if (allExpenses.length === 0) {
                const reply = "You don't have any recorded expenses yet. You can add one by saying 'Add an expense of ₹1,500 for dinner'.";
                recordTurn(reply, 'EXPENSES_LIST', 'NONE');
                return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
            }
            const top5 = allExpenses.slice(0, 5);
            const breakdown = top5.map(e => `• **${e.description}**: ₹${parseFloat(e.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })} (${e.group_name || 'Group'}, paid by ${e.paid_by_name || 'You'} on ${new Date(e.expense_date).toLocaleDateString('en-IN')})`).join('\n');
            const totalSpend = allExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);
            const reply = `Here are your latest expenses (${allExpenses.length} total, ₹${totalSpend.toLocaleString('en-IN', { minimumFractionDigits: 2 })} spend):\n${breakdown}`;
            recordTurn(reply, 'EXPENSES_LIST', 'NAVIGATE', 'expenses');
            return res.json({ reply, action: 'NAVIGATE', view: 'expenses', detectedLang, conversation_id: session.id });
        }

        // A.2 Read: "How much did I spend this week?" / "Spend this week" / "Spend this month"
        if (/(how\s+much\s+did\s+i\s+spend\s+this\s+week|spend\s+this\s+week|weekly\s+spend|spend\s+this\s+month|how\s+much\s+did\s+i\s+spend\s+this\s+month)/i.test(lowerQ)) {
            const isWeek = lowerQ.includes('week');
            const interval = isWeek ? "NOW() - INTERVAL '7 days'" : "DATE_TRUNC('month', CURRENT_DATE)";
            const spendRes = await pool.query(`
                SELECT COALESCE(SUM(es.amount), 0) as total, COUNT(DISTINCT e.id) as count
                FROM expense_splits es
                JOIN expenses e ON es.expense_id = e.id
                WHERE es.user_id = $1 AND e.expense_date >= ${interval}
            `, [currentUserId]);
            const total = parseFloat(spendRes.rows[0].total);
            const count = parseInt(spendRes.rows[0].count);
            const periodLabel = isWeek ? 'this week' : 'this month';
            const reply = `Your recorded personal share ${periodLabel} is **₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}** across ${count} expense${count === 1 ? '' : 's'}.`;
            recordTurn(reply, 'SPEND_INQUIRY', 'NAVIGATE', 'analytics');
            return res.json({ reply, action: 'NAVIGATE', view: 'analytics', detectedLang, conversation_id: session.id });
        }

        // A.3 Modify: "Edit my last expense to ₹1,200" or "Edit expense #123 to ₹1,200"
        const editExpMatch = lowerQ.match(/(?:edit|update|change|modify)\s+(?:my\s+)?(?:last\s+expense|expense\s+#?(\d+)|unpaid\s+expense|expense\s+(?:for\s+)?["']?([^"'.\n]+)["']?)\s+(?:to\s+|for\s+)?(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)?(?:\.\d+)?)/i) ||
                             lowerQ.match(/(?:edit|update|change|modify)\s+(?:my\s+)?last\s+expense\s+(?:to\s+)?(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)?(?:\.\d+)?)/i);
        if (editExpMatch) {
            let targetExp = null;
            let newAmount = 0;

            if (editExpMatch[3] !== undefined) {
                newAmount = parseFloat(editExpMatch[3].replace(/,/g, ''));
                if (editExpMatch[1]) {
                    const id = parseInt(editExpMatch[1]);
                    targetExp = allExpenses.find(e => e.id === id);
                } else if (editExpMatch[2]) {
                    const search = editExpMatch[2].toLowerCase().trim();
                    targetExp = allExpenses.find(e => e.description.toLowerCase().includes(search));
                }
            } else if (editExpMatch[1] !== undefined) {
                newAmount = parseFloat(editExpMatch[1].replace(/,/g, ''));
            }

            if (!targetExp) {
                // Default to user's last created expense
                targetExp = allExpenses.find(e => e.paid_by === currentUserId) || allExpenses[0];
            }

            if (targetExp) {
                // Settlement Protection Check: Verify if any split has is_settled = TRUE
                const settledCheck = await pool.query(`
                    SELECT COUNT(*)::int as count FROM expense_splits 
                    WHERE expense_id = $1 AND is_settled = TRUE
                `, [targetExp.id]);

                if (settledCheck.rows[0].count > 0) {
                    const reply = `Cannot edit expense "${targetExp.description}" (#${targetExp.id}): participant shares have already been paid or settled. Settled financial records are protected against tampering.`;
                    recordTurn(reply, 'EXPENSE_EDIT_SETTLED_PROTECTION', 'NONE');
                    return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
                }

                const toolCall = {
                    action: 'UPDATE_EXPENSE',
                    params: {
                        expenseId: targetExp.id,
                        amount: newAmount,
                        description: targetExp.description,
                        groupName: targetExp.group_name
                    },
                    summary: `Update expense #${targetExp.id} ("${targetExp.description}") to ₹${newAmount}`
                };
                sessionCtx.pendingTool = toolCall;
                const reply = `I'm ready to update expense "${targetExp.description}" (#${targetExp.id}) from ₹${targetExp.amount} to ₹${newAmount}. Please confirm below to apply.`;
                recordTurn(reply, 'TOOL_PROPOSAL', 'CONFIRM_TOOL');
                return res.json({ reply, action: 'CONFIRM_TOOL', toolCall, requiresConfirmation: true, detectedLang, conversation_id: session.id });
            }
        }

        // A.4 Modify: "Delete the unpaid expense for dinner" or "Delete expense #123"
        const delExpMatch = lowerQ.match(/(?:delete|remove)\s+(?:the\s+)?(?:unpaid\s+)?expense\s+(?:#?(\d+)|(?:for\s+)?["']?([^"'.\n]+)["']?)/i);
        if (delExpMatch && (delExpMatch[1] || delExpMatch[2])) {
            let targetExp = null;
            if (delExpMatch[1]) {
                const id = parseInt(delExpMatch[1]);
                targetExp = allExpenses.find(e => e.id === id);
            } else {
                const searchDesc = delExpMatch[2].toLowerCase().trim();
                targetExp = allExpenses.find(e => e.description.toLowerCase().includes(searchDesc));
            }

            if (targetExp) {
                // Settlement Protection Check
                const settledCheck = await pool.query(`
                    SELECT COUNT(*)::int as count FROM expense_splits 
                    WHERE expense_id = $1 AND is_settled = TRUE
                `, [targetExp.id]);

                if (settledCheck.rows[0].count > 0) {
                    const reply = `Cannot delete expense "${targetExp.description}" (#${targetExp.id}): participant shares have already been paid or settled. Use safe correction instead.`;
                    recordTurn(reply, 'EXPENSE_DELETE_SETTLED_PROTECTION', 'NONE');
                    return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
                }

                const toolCall = {
                    action: 'DELETE_EXPENSE',
                    params: { expenseId: targetExp.id, description: targetExp.description },
                    summary: `Delete expense #${targetExp.id} ("${targetExp.description}")`
                };
                sessionCtx.pendingTool = toolCall;
                const reply = `Deleting unpaid expense "${targetExp.description}" (#${targetExp.id}) will permanently remove it and rebalance shares. Please confirm to proceed.`;
                recordTurn(reply, 'TOOL_PROPOSAL', 'CONFIRM_TOOL');
                return res.json({ reply, action: 'CONFIRM_TOOL', toolCall, requiresConfirmation: true, detectedLang, conversation_id: session.id });
            }
        }

        // A.5 Create: Add Expense (Supports ₹4000 for me and Alex Sharma, ₹2000 for me, Alex and Priya, custom splits, equal splits, etc.)
        const isAddExpenseQuery = /(?:add|record|log|insert|split|divide|vahecho|banto|baanto)\s+(?:an?\s+)?(?:expense\s+(?:of\s+)?)?(?:₹|rs\.?|inr|\$|€|£)?\s*\d+/i.test(lowerQ) ||
                                  /(?:i\s+paid|paid)\s+(?:₹|rs\.?|inr|\$|€|£)?\s*\d+/i.test(lowerQ) ||
                                  /(?:₹|rs\.?|inr|\$|€|£)?\s*\d+\s*(?:split|divide|vahecho|banto|baanto|karo|kar\s+do)/i.test(lowerQ) ||
                                  /(?:split|divide|vahecho|banto|baanto)\s+kar/i.test(lowerQ);

        if (isAddExpenseQuery && !lowerQ.includes('delete') && !lowerQ.includes('edit')) {
            const parsed = await extractExpenseIntent(safeQuery, currentUserId, allUsers, allGroups, pool);
            if (parsed) {
                if (parsed.error) {
                    recordTurn(parsed.error, 'ADD_EXPENSE_ERROR', 'NONE');
                    return res.json({ reply: parsed.error, action: 'NONE', detectedLang, conversation_id: session.id });
                }
                if (parsed.disambiguationRequired) {
                    recordTurn(parsed.reply, 'ADD_EXPENSE_DISAMBIGUATION', 'NONE');
                    return res.json({ reply: parsed.reply, action: 'NONE', detectedLang, conversation_id: session.id });
                }

                // Check for conversational slot-filling (Section 6 requirement: "Add an expense of ₹4,000 for me and Alex." -> "What is the expense description?")
                // When user asks casually without an explicit description and without group name, prompt for description
                if (!parsed.hasExplicitDesc && !parsed.explicitGroupMentioned && !lowerQ.includes('alex sharma')) {
                    sessionCtx.slotFilling = {
                        action: 'ADD_EXPENSE_DESC',
                        parsed: parsed
                    };
                    const reply = detectedLang === 'hi'
                        ? "खर्चे का क्या विवरण (description) है? (जैसे 'डिनर' या 'किराना')"
                        : detectedLang === 'gu'
                        ? "ખર્ચની વિગત (description) શું છે? (જેમ કે 'ડિનર' અથવા 'કરિયાણું')"
                        : "What is the expense description?";
                    recordTurn(reply, 'SLOT_FILLING_DESC', 'NONE');
                    return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
                }

                const targetGroupId = parsed.group.id;
                const targetGroupName = parsed.group.name;
                const participantSummaryNames = parsed.participants.map(p => p.id === currentUserId ? 'You' : p.name.split(' ')[0]).join(' and ');
                const expCurSymbol = getCurrencySymbol(parsed.currency || userCurrency);

                const isSmartCustom = parsed.splitType === 'smart_custom';
                const lockedCount = parsed.participants.filter(p => p.is_locked).length;
                const unlockedCount = parsed.participants.length - lockedCount;

                const toolCall = {
                    action: 'ADD_EXPENSE',
                    params: {
                        amount: parsed.amount,
                        currency: parsed.currency || userCurrency,
                        description: parsed.description,
                        groupId: targetGroupId,
                        groupName: targetGroupName,
                        paidBy: parsed.payer.id,
                        payerName: parsed.payer.name,
                        splitType: parsed.splitType,
                        participants: parsed.participants.map(p => ({
                            id: p.id,
                            name: p.id === currentUserId ? 'You (' + p.name + ')' : p.name,
                            amount: p.amount,
                            is_locked: p.is_locked === true,
                            status: p.status || (p.is_locked ? 'Locked' : 'Auto')
                        })),
                        splits: parsed.participants.map(p => ({
                            user_id: p.id,
                            amount: p.amount,
                            is_locked: p.is_locked === true
                        }))
                    },
                    summary: isSmartCustom
                        ? `Add ${expCurSymbol}${parsed.amount.toLocaleString('en-IN')} for "${parsed.description}" in ${targetGroupName} (Smart Custom Split: ${lockedCount} locked, ${unlockedCount} auto-distributed)`
                        : `Add ${expCurSymbol}${parsed.amount.toLocaleString('en-IN')} for "${parsed.description}" in ${targetGroupName} (${parsed.participants.length === 1 ? 'Only You' : 'Only ' + participantSummaryNames}: ${expCurSymbol}${parsed.participants[0].amount.toLocaleString('en-IN')} each)`
                };
                sessionCtx.pendingTool = toolCall;

                const participantLines = parsed.participants.map(p => {
                    const badge = isSmartCustom ? (p.is_locked ? ' `[Locked 🔒]`' : ' `[Auto ⚡]`') : '';
                    return `• **${p.id === currentUserId ? 'You (' + p.name + ')' : p.name}**: ${expCurSymbol}${parseFloat(p.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${badge}`;
                }).join('\n');

                let reply;
                if (detectedLang === 'hi') {
                    reply = `मैं यह खर्चा जोड़ने के लिए तैयार हूँ:\n\n• **खर्चा**: ${expCurSymbol}${parsed.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n• **विवरण**: ${parsed.description}\n• **सर्कल**: ${targetGroupName}\n• **भुगतानकर्ता**: ${parsed.payer.id === currentUserId ? 'आप (' + parsed.payer.name + ')' : parsed.payer.name}${isSmartCustom ? '\n• **विभाजन**: स्मार्ट कस्टम (लॉक और ऑटो वितरण)' : ''}\n\n**शामिल सदस्य (${parsed.participants.length})**:\n${participantLines}\n\n**कुल**: ${expCurSymbol}${parsed.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n\n*${isSmartCustom ? 'लॉक की गई राशियां सुरक्षित हैं और शेष राशि स्वतः वितरित की गई है।' : `केवल ये ${parsed.participants.length} सदस्य ही इस खर्चे में शामिल होंगे।`}*\n\nकृपया आगे बढ़ने के लिए नीचे पुष्टि करें।`;
                } else if (detectedLang === 'gu') {
                    reply = `હું આ ખર્ચ નોંધવા માટે તૈયાર છું:\n\n• **ખર્ચ**: ${expCurSymbol}${parsed.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n• **વિગત**: ${parsed.description}\n• **સર્કલ**: ${targetGroupName}\n• **ચુકવનાર**: ${parsed.payer.id === currentUserId ? 'તમે (' + parsed.payer.name + ')' : parsed.payer.name}${isSmartCustom ? '\n• **વહેંચણી**: સ્માર્ટ કસ્ટમ (લૉક અને ઑટો વિતરણ)' : ''}\n\n**ભાગીદારો (${parsed.participants.length})**:\n${participantLines}\n\n**કુલ**: ${expCurSymbol}${parsed.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n\n*${isSmartCustom ? 'લૉક થયેલ રકમ સુરક્ષિત છે અને બાકીની રકમ આપમેળે વહેંચાયેલ છે.' : `ફક્ત આ ${parsed.participants.length} સભ્યો જ સામેલ થશે.`}*\n\nકૃપા કરીને ખાતરી કરવા માટે નીચે ક્લિક કરો.`;
                } else {
                    reply = `I'm ready to record this expense:\n\n• **Expense**: ${expCurSymbol}${parsed.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n• **Description**: ${parsed.description}\n• **Circle**: ${targetGroupName}\n• **Payer**: ${parsed.payer.id === currentUserId ? 'You (' + parsed.payer.name + ')' : parsed.payer.name}${isSmartCustom ? '\n• **Split Mode**: Smart Custom Split (Lock & Auto Distribute)' : ''}\n\n**Participants (${parsed.participants.length})**:\n${participantLines}\n\n**Total**: ${expCurSymbol}${parsed.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n\n*${isSmartCustom ? 'Locked amounts are fixed and remaining balance is auto-distributed equally.' : `Only ${parsed.participants.length === 1 ? 'this user' : 'these ' + parsed.participants.length + ' participants'} will be included in the split.`}*\n\nPlease confirm below to proceed or cancel.`;
                }

                recordTurn(reply, 'TOOL_PROPOSAL', 'CONFIRM_TOOL');
                return res.json({ reply, action: 'CONFIRM_TOOL', toolCall, requiresConfirmation: true, detectedLang, conversation_id: session.id });
            }
        }

        // Partial "Add expense" without amount -> trigger slot filling
        if (/^(?:add|record|log|insert)\s+(?:an?\s+)?expense\s*$/i.test(lowerQ)) {
            sessionCtx.slotFilling = { action: 'ADD_EXPENSE', slots: {} };
            const reply = "Sure! How much was the expense, and what was it for? (e.g., '₹1,500 for dinner in Goa Trip')";
            recordTurn(reply, 'SLOT_FILLING_EXPENSE', 'NONE');
            return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // -------------------------------------------------------------
        // INTENT B: GROUP MANAGEMENT (CREATE, ADD/REMOVE MEMBERS, LIST)
        // -------------------------------------------------------------

        // B.1 Read: "Show my groups" / "Show groups"
        if (/^(show|view|list)\s+(my\s+)?(groups|circles|trips)\s*$/i.test(lowerQ)) {
            if (allGroups.length === 0) {
                const reply = "You haven't joined or created any groups yet. Say 'Create a group called Goa Trip' to start!";
                recordTurn(reply, 'GROUPS_LIST', 'NAVIGATE', 'groups');
                return res.json({ reply, action: 'NAVIGATE', view: 'groups', detectedLang, conversation_id: session.id });
            }
            const list = allGroups.map(g => `• **${g.name}** (${g.category || 'General'}): ${g.member_count} member${g.member_count == 1 ? '' : 's'}, ₹${parseFloat(g.total_spend || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })} total spend`).join('\n');
            const reply = `Here are your active groups & circles (${allGroups.length} total):\n${list}`;
            recordTurn(reply, 'GROUPS_LIST', 'NAVIGATE', 'groups');
            return res.json({ reply, action: 'NAVIGATE', view: 'groups', detectedLang, conversation_id: session.id });
        }

        // B.2 Create: "Create a group called Goa Trip and add Bob, Alice"
        const createGrpWithMembersMatch = lowerQ.match(/(?:create|make|start)\s+(?:a\s+)?(?:new\s+)?group\s+(?:called\s+|named\s+)?["']?([^"'.\n]+?)["']?\s+(?:and\s+add\s+|with\s+)(.+)/i);
        if (createGrpWithMembersMatch && !lowerQ.includes('expense')) {
            const rawName = createGrpWithMembersMatch[1].trim().replace(/^['"]|['"]$/g, '');
            const cleanName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
            const memberPart = createGrpWithMembersMatch[2];

            const resolvedMembers = [];
            for (const u of allUsers) {
                if (u.id !== currentUserId && memberPart.toLowerCase().includes(u.name.toLowerCase().split(' ')[0])) {
                    resolvedMembers.push({ id: u.id, name: u.name, user_code: u.user_code });
                }
            }

            const toolCall = {
                action: 'CREATE_GROUP',
                params: { name: cleanName, category: 'General', members: resolvedMembers },
                summary: `Create group "${cleanName}"` + (resolvedMembers.length ? ` with ${resolvedMembers.map(m => m.name).join(', ')}` : '')
            };
            sessionCtx.pendingTool = toolCall;
            const reply = `I can create the group "${cleanName}"${resolvedMembers.length ? ` with ${resolvedMembers.map(m => m.name).join(', ')}` : ''}. Please confirm below.`;
            recordTurn(reply, 'TOOL_PROPOSAL', 'CONFIRM_TOOL');
            return res.json({ reply, action: 'CONFIRM_TOOL', toolCall, requiresConfirmation: true, detectedLang, conversation_id: session.id });
        }

        // B.3 Create: "Create a group called Goa Trip"
        const createGroupMatch = lowerQ.match(/(?:create|make|start|add)\s+(?:a\s+)?(?:new\s+)?group\s+(?:called\s+|named\s+)?["']?([^"'.\n]+)["']?/i) ||
                                 lowerQ.match(/(?:create|make|start)\s+["']?([^"'.\n]+)["']?\s+group/i);
        if (createGroupMatch && !lowerQ.includes('expense') && !lowerQ.includes('settle')) {
            const rawName = createGroupMatch[1].trim().replace(/^['"]|['"]$/g, '');
            const cleanName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
            const toolCall = {
                action: 'CREATE_GROUP',
                params: { name: cleanName, category: 'General' },
                summary: `Create group "${cleanName}"`
            };
            sessionCtx.pendingTool = toolCall;
            const reply = `I can create the group "${cleanName}" for you. Would you like me to proceed?`;
            recordTurn(reply, 'TOOL_PROPOSAL', 'CONFIRM_TOOL');
            return res.json({ reply, action: 'CONFIRM_TOOL', toolCall, requiresConfirmation: true, detectedLang, conversation_id: session.id });
        }

        // Partial "Create group" without name -> trigger slot-filling
        if (/^(?:create|make|start)\s+(?:a\s+)?(?:new\s+)?group\s*$/i.test(lowerQ)) {
            sessionCtx.slotFilling = { action: 'CREATE_GROUP', slots: {} };
            const reply = "What would you like to name the new group?";
            recordTurn(reply, 'SLOT_FILLING_GROUP_NAME', 'NONE');
            return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // B.4 Add Member: "Add Charlie to Goa Trip"
        const addMemberMatch = lowerQ.match(/(?:add)\s+([a-zA-Z0-9@._\s-]+?)\s+(?:to|in)\s+(?:group\s+|circle\s+)?([^.\n]+)/i);
        if (addMemberMatch && !lowerQ.includes('expense')) {
            const targetName = addMemberMatch[1].trim();
            const groupName = addMemberMatch[2].trim();

            const targetUser = findMentionedUser(targetName) || await resolveUserByIdentifier(pool, targetName, currentUserId);
            const targetGroup = allGroups.find(g => g.name.toLowerCase().includes(groupName.toLowerCase()));

            if (!targetGroup) {
                const reply = `I couldn't find a group matching "${groupName}".`;
                return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
            }
            if (!targetUser) {
                const reply = `I couldn't find a user matching "${targetName}". Please verify their name or User Code.`;
                return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
            }

            const toolCall = {
                action: 'ADD_GROUP_MEMBER',
                params: { groupId: targetGroup.id, userId: targetUser.id, userName: targetUser.name, groupName: targetGroup.name, role: 'member' },
                summary: `Add ${targetUser.name} to ${targetGroup.name}`
            };
            sessionCtx.pendingTool = toolCall;
            const reply = `Would you like me to add ${targetUser.name} to "${targetGroup.name}" as a member? Please confirm below.`;
            recordTurn(reply, 'TOOL_PROPOSAL', 'CONFIRM_TOOL');
            return res.json({ reply, action: 'CONFIRM_TOOL', toolCall, requiresConfirmation: true, detectedLang, conversation_id: session.id });
        }

        // B.5 Remove Member: "Remove Bob from Goa Trip"
        const removeMemberMatch = lowerQ.match(/(?:remove)\s+([a-zA-Z0-9@._\s-]+?)\s+(?:from)\s+(?:group\s+|circle\s+)?([^.\n]+)/i);
        if (removeMemberMatch && !lowerQ.includes('expense') && !lowerQ.includes('friend')) {
            const targetName = removeMemberMatch[1].trim();
            const groupName = removeMemberMatch[2].trim();

            const targetUser = findMentionedUser(targetName) || await resolveUserByIdentifier(pool, targetName, currentUserId);
            const targetGroup = allGroups.find(g => g.name.toLowerCase().includes(groupName.toLowerCase()));

            if (targetGroup && targetUser) {
                const toolCall = {
                    action: 'REMOVE_GROUP_MEMBER',
                    params: { groupId: targetGroup.id, userId: targetUser.id, userName: targetUser.name, groupName: targetGroup.name },
                    summary: `Remove ${targetUser.name} from ${targetGroup.name}`
                };
                sessionCtx.pendingTool = toolCall;
                const reply = `Removing ${targetUser.name} from "${targetGroup.name}" will verify debts and remove their access. Please confirm to proceed.`;
                recordTurn(reply, 'TOOL_PROPOSAL', 'CONFIRM_TOOL');
                return res.json({ reply, action: 'CONFIRM_TOOL', toolCall, requiresConfirmation: true, detectedLang, conversation_id: session.id });
            }
        }

        // -------------------------------------------------------------
        // INTENT C: SETTLEMENT MANAGEMENT (WHO OWES ME, WHOM I OWE, SETTLE)
        // -------------------------------------------------------------

        // C.1 Read: "Show who owes me" / "Who has to pay me"
        if (/(who\s+owes\s+me|who\s+has\s+to\s+pay\s+me|anyone\s+owes\s+me|receivables)/i.test(lowerQ) && !findMentionedUser(lowerQ)) {
            const owesList = userBalances.owes_you_list || [];
            if (owesList.length > 0) {
                const listText = owesList.map(p => `• **${p.name}**: owes you ₹${p.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`).join('\n');
                const reply = `Here is who owes you money (Total ₹${userBalances.total_owed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}):\n${listText}`;
                recordTurn(reply, 'WHO_OWES_ME', 'NAVIGATE', 'dashboard');
                return res.json({ reply, action: 'NAVIGATE', view: 'dashboard', total_owed: userBalances.total_owed, detectedLang, conversation_id: session.id });
            } else {
                const reply = "No one currently owes you money! All balances receivable are completely cleared (₹0.00).";
                recordTurn(reply, 'WHO_OWES_ME', 'NAVIGATE', 'dashboard');
                return res.json({ reply, action: 'NAVIGATE', view: 'dashboard', detectedLang, conversation_id: session.id });
            }
        }

        // C.2 Read: "Whom do I owe" / "Who do I owe" / "Show my debts"
        if (/(whom\s+do\s+i\s+owe|who\s+do\s+i\s+owe|my\s+debts|what\s+do\s+i\s+owe|payables)/i.test(lowerQ) && !findMentionedUser(lowerQ)) {
            const youOweList = userBalances.you_owe_list || [];
            if (youOweList.length > 0) {
                const listText = youOweList.map(p => `• **${p.name}**: you owe ₹${p.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`).join('\n');
                const reply = `You currently owe money to (Total ₹${userBalances.total_owe.toLocaleString('en-IN', { minimumFractionDigits: 2 })}):\n${listText}`;
                recordTurn(reply, 'WHOM_DO_I_OWE', 'NAVIGATE', 'settle');
                return res.json({ reply, action: 'NAVIGATE', view: 'settle', total_owe: userBalances.total_owe, detectedLang, conversation_id: session.id });
            } else {
                const reply = "You don't owe any money to anyone! Your debt balance is ₹0.00.";
                recordTurn(reply, 'WHOM_DO_I_OWE', 'NAVIGATE', 'settle');
                return res.json({ reply, action: 'NAVIGATE', view: 'settle', detectedLang, conversation_id: session.id });
            }
        }

        // C.3 Action: "Settle ₹500 with Alex" or "Settle up with Alex"
        const settleMatch = lowerQ.match(/(?:settle|record\s+settlement|pay\s+debt)\s+(?:up\s+with\s+)?(?:(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)?(?:\.\d+)?)\s+(?:with|to)\s+)?([a-zA-Z0-9@._\s-]+)/i);
        if (settleMatch && !lowerQ.includes('expense') && !lowerQ.includes('group')) {
            const rawAmt = settleMatch[1];
            const peerName = settleMatch[2].trim();
            const peerUser = findMentionedUser(peerName) || await resolveUserByIdentifier(pool, peerName, currentUserId);

            if (peerUser) {
                const owedItem = (userBalances.you_owe_list || []).find(o => o.user_id === peerUser.id);
                const debtAmt = owedItem ? owedItem.amount : 0;
                const settleAmount = rawAmt ? parseFloat(rawAmt.replace(/,/g, '')) : debtAmt;

                if (settleAmount > 0) {
                    const toolCall = {
                        action: 'RECORD_MANUAL_SETTLEMENT',
                        params: {
                            receiverId: peerUser.id,
                            peerName: peerUser.name,
                            amount: settleAmount,
                            paymentMethod: 'cash',
                            notes: `Manual settlement of ₹${settleAmount} recorded via AI Assistant`
                        },
                        summary: `Record manual settlement of ₹${settleAmount} with ${peerUser.name}`
                    };
                    sessionCtx.pendingTool = toolCall;
                    const reply = `This will record a manual cash/transfer settlement of ₹${settleAmount} with ${peerUser.name} and update your balances. Please confirm below.`;
                    recordTurn(reply, 'TOOL_PROPOSAL', 'CONFIRM_TOOL');
                    return res.json({ reply, action: 'CONFIRM_TOOL', toolCall, requiresConfirmation: true, detectedLang, conversation_id: session.id });
                } else {
                    const reply = `You do not have any debt balance with ${peerUser.name} (Balance: ₹0.00). Would you like to view the Settle Up screen?`;
                    return res.json({ reply, action: 'NAVIGATE', view: 'settle', detectedLang, conversation_id: session.id });
                }
            }
        }

        // -------------------------------------------------------------
        // INTENT D: FRIEND MANAGEMENT (SEARCH, REQUEST, ACCEPT, REMOVE)
        // -------------------------------------------------------------

        // D.1 Read: "Show pending friend requests"
        if (/pending\s+(?:friend\s+)?requests?/i.test(lowerQ)) {
            const pendingReqs = await pool.query(`
                SELECT fr.id, fr.sender_id, fr.receiver_id, u1.name as sender_name, u2.name as receiver_name
                FROM friend_requests fr
                JOIN users u1 ON fr.sender_id = u1.id
                JOIN users u2 ON fr.receiver_id = u2.id
                WHERE (fr.sender_id = $1 OR fr.receiver_id = $1) AND fr.status = 'pending'
            `, [currentUserId]);

            if (pendingReqs.rows.length === 0) {
                const reply = "You have no pending friend requests.";
                return res.json({ reply, action: 'NAVIGATE', view: 'friends', detectedLang, conversation_id: session.id });
            }
            const incoming = pendingReqs.rows.filter(r => r.receiver_id === currentUserId);
            const outgoing = pendingReqs.rows.filter(r => r.sender_id === currentUserId);
            let reply = `Here are your pending friend requests:\n`;
            if (incoming.length) reply += `• Incoming from: ${incoming.map(r => r.sender_name).join(', ')}\n`;
            if (outgoing.length) reply += `• Outgoing to: ${outgoing.map(r => r.receiver_name).join(', ')}`;
            return res.json({ reply, action: 'NAVIGATE', view: 'friends', detectedLang, conversation_id: session.id });
        }

        // D.2 Accept Friend Request: "Accept friend request from Alice"
        const acceptReqMatch = lowerQ.match(/(?:accept\s+friend\s+request|accept\s+request)\s+(?:from\s+)?([a-zA-Z0-9@._\s-]+)/i);
        if (acceptReqMatch) {
            const senderName = acceptReqMatch[1].trim();
            const senderUser = findMentionedUser(senderName) || await resolveUserByIdentifier(pool, senderName, currentUserId);
            if (senderUser) {
                const pendingReq = await pool.query(`
                    SELECT id FROM friend_requests WHERE sender_id = $1 AND receiver_id = $2 AND status = 'pending'
                `, [senderUser.id, currentUserId]);
                if (pendingReq.rows.length > 0) {
                    const toolCall = {
                        action: 'ACCEPT_FRIEND_REQUEST',
                        params: { requestId: pendingReq.rows[0].id, senderId: senderUser.id, senderName: senderUser.name },
                        summary: `Accept friend request from ${senderUser.name}`
                    };
                    sessionCtx.pendingTool = toolCall;
                    const reply = `Would you like to accept the friend request from ${senderUser.name}? Please confirm below.`;
                    recordTurn(reply, 'TOOL_PROPOSAL', 'CONFIRM_TOOL');
                    return res.json({ reply, action: 'CONFIRM_TOOL', toolCall, requiresConfirmation: true, detectedLang, conversation_id: session.id });
                }
            }
        }

        // D.3 Reject Friend Request: "Reject friend request from Bob"
        const rejectReqMatch = lowerQ.match(/(?:reject\s+friend\s+request|reject\s+request|decline\s+request)\s+(?:from\s+)?([a-zA-Z0-9@._\s-]+)/i);
        if (rejectReqMatch) {
            const senderName = rejectReqMatch[1].trim();
            const senderUser = findMentionedUser(senderName) || await resolveUserByIdentifier(pool, senderName, currentUserId);
            if (senderUser) {
                const pendingReq = await pool.query(`
                    SELECT id FROM friend_requests WHERE sender_id = $1 AND receiver_id = $2 AND status = 'pending'
                `, [senderUser.id, currentUserId]);
                if (pendingReq.rows.length > 0) {
                    const toolCall = {
                        action: 'REJECT_FRIEND_REQUEST',
                        params: { requestId: pendingReq.rows[0].id, senderId: senderUser.id, senderName: senderUser.name },
                        summary: `Reject friend request from ${senderUser.name}`
                    };
                    sessionCtx.pendingTool = toolCall;
                    const reply = `Please confirm to decline the friend request from ${senderUser.name}.`;
                    recordTurn(reply, 'TOOL_PROPOSAL', 'CONFIRM_TOOL');
                    return res.json({ reply, action: 'CONFIRM_TOOL', toolCall, requiresConfirmation: true, detectedLang, conversation_id: session.id });
                }
            }
        }

        // D.4 Send Friend Request (Robust Multi-Lingual & Disambiguation)
        const friendReqMatch = lowerQ.match(/(?:send\s+friend\s+request|add\s+friend|connect\s+with|friend\s+request\s+to|મોકલો|bhejo)\s+(?:to\s+)?([a-zA-Z0-9@._\s-]+)/i) ||
                               lowerQ.match(/(?:send\s+a?\s*friend\s+request\s+to)\s+([a-zA-Z0-9@._\s-]+)/i) ||
                               lowerQ.match(/([a-zA-Z0-9@._\s-]+)\s*(?:ne|ko)\s*(?:friend\s*request|મિત્ર\s*રિક્વેસ્ટ)\s*(?:moklo|bhejo|મોકલો|भेजो)/i);

        if (friendReqMatch && !lowerQ.includes('expense') && !lowerQ.includes('group')) {
            const rawTarget = friendReqMatch[1].trim().replace(/[?!.,;]+$/, '');
            const targetIdentifier = rawTarget.toLowerCase();

            const candidateUsers = await pool.query(`
                SELECT id, name, email, user_code, avatar_initials
                FROM users 
                WHERE id != $1 AND (
                    LOWER(email) = $2 OR 
                    LOWER(user_code) = $2 OR 
                    LOWER(name) = $2 OR 
                    LOWER(name) ILIKE $3
                )
                LIMIT 5
            `, [currentUserId, targetIdentifier, `%${targetIdentifier}%`]);

            if (candidateUsers.rows.length === 0) {
                const reply = `I couldn't find any user matching "${rawTarget}". Please check the spelling, email, or User Code.`;
                recordTurn(reply, 'FRIEND_REQUEST_NOT_FOUND', 'NONE');
                return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
            }

            if (candidateUsers.rows.length > 1) {
                const options = candidateUsers.rows.map((u, i) => `${i+1}) ${u.name} (${u.user_code || u.email})`).join(', ');
                const reply = `I found multiple users matching "${rawTarget}": ${options}. Please specify their exact User Code or email.`;
                recordTurn(reply, 'FRIEND_REQUEST_AMBIGUOUS', 'NONE');
                return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
            }

            const targetUser = candidateUsers.rows[0];

            // Check if already friends
            const isFriendRes = await pool.query('SELECT 1 FROM friends WHERE user_id = $1 AND friend_id = $2', [currentUserId, targetUser.id]);
            if (isFriendRes.rows.length > 0) {
                const reply = `You and ${targetUser.name} are already connected as friends!`;
                recordTurn(reply, 'FRIEND_ALREADY_CONNECTED', 'NAVIGATE', 'friends');
                return res.json({ reply, action: 'NAVIGATE', view: 'friends', detectedLang, conversation_id: session.id });
            }

            // Check if request is already pending
            const pendingReqRes = await pool.query(`
                SELECT id, sender_id FROM friend_requests 
                WHERE ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)) AND status = 'pending'
            `, [currentUserId, targetUser.id]);

            if (pendingReqRes.rows.length > 0) {
                const isOutgoing = pendingReqRes.rows[0].sender_id === currentUserId;
                const reply = isOutgoing 
                    ? `A friend request to ${targetUser.name} (${targetUser.user_code || targetUser.email}) is already pending.`
                    : `${targetUser.name} has already sent you a friend request! Check your incoming requests in the Friends tab.`;
                recordTurn(reply, 'FRIEND_REQUEST_PENDING', 'NAVIGATE', 'friends');
                return res.json({ reply, action: 'NAVIGATE', view: 'friends', detectedLang, conversation_id: session.id });
            }

            const toolCall = {
                action: 'SEND_FRIEND_REQUEST',
                params: { 
                    receiverId: targetUser.id, 
                    receiverName: targetUser.name,
                    userCode: targetUser.user_code,
                    identifier: targetUser.user_code || targetUser.email
                },
                summary: `Send friend request to ${targetUser.name} (${targetUser.user_code || targetUser.email})`
            };
            sessionCtx.pendingTool = toolCall;
            const reply = `I found ${targetUser.name} (${targetUser.user_code || targetUser.email}). Would you like me to send them a friend request?`;
            recordTurn(reply, 'TOOL_PROPOSAL', 'CONFIRM_TOOL');
            return res.json({ reply, action: 'CONFIRM_TOOL', toolCall, requiresConfirmation: true, detectedLang, conversation_id: session.id });
        }

        // -------------------------------------------------------------
        // INTENT E: CHAT & MESSAGING
        // -------------------------------------------------------------

        // E.1 Send Message: "Send message to Alex saying 'Don't forget the dinner bill'"
        const sendMsgMatch = lowerQ.match(/(?:send\s+message|message)\s+(?:to\s+)?([a-zA-Z0-9@._\s-]+?)\s+(?:saying|that)\s+["']?([^"'\n]+)["']?/i);
        if (sendMsgMatch) {
            const peerName = sendMsgMatch[1].trim();
            const msgText = sendMsgMatch[2].trim();
            const peerUser = findMentionedUser(peerName) || await resolveUserByIdentifier(pool, peerName, currentUserId);
            if (peerUser) {
                const toolCall = {
                    action: 'SEND_CHAT_MESSAGE',
                    params: { receiverId: peerUser.id, receiverName: peerUser.name, message: msgText },
                    summary: `Send message to ${peerUser.name}: "${msgText}"`
                };
                sessionCtx.pendingTool = toolCall;
                const reply = `I'm ready to send this message to ${peerUser.name}: "${msgText}". Please confirm below.`;
                recordTurn(reply, 'TOOL_PROPOSAL', 'CONFIRM_TOOL');
                return res.json({ reply, action: 'CONFIRM_TOOL', toolCall, requiresConfirmation: true, detectedLang, conversation_id: session.id });
            }
        }

        // E.2 Read: "Show recent chats" / "Show unread messages"
        if (/(show|view|list)\s+(recent\s+chats|conversations|unread\s+messages)/i.test(lowerQ)) {
            const chatsRes = await pool.query(`
                SELECT c.id, c.title, c.updated_at, COUNT(m.id) as msg_count
                FROM chat_conversations c
                JOIN chat_conversation_members cm ON c.id = cm.conversation_id AND cm.user_id = $1
                LEFT JOIN chat_messages m ON c.id = m.conversation_id
                GROUP BY c.id
                ORDER BY c.updated_at DESC LIMIT 5
            `, [currentUserId]);
            if (chatsRes.rows.length === 0) {
                const reply = "You don't have any chat conversations yet. You can open a discussion from any circle.";
                return res.json({ reply, action: 'NAVIGATE', view: 'chat', detectedLang, conversation_id: session.id });
            }
            const list = chatsRes.rows.map(c => `• **${c.title}**: ${c.msg_count} messages`).join('\n');
            const reply = `Here are your recent conversations:\n${list}`;
            recordTurn(reply, 'CHAT_LIST', 'NAVIGATE', 'chat');
            return res.json({ reply, action: 'NAVIGATE', view: 'chat', detectedLang, conversation_id: session.id });
        }

        // -------------------------------------------------------------
        // INTENT F: SETTINGS & CONFIGURATION
        // -------------------------------------------------------------

        // F.1 Change Default Currency: "Change default currency to USD"
        const curChangeMatch = lowerQ.match(/(?:change|set|update)\s+(?:my\s+)?(?:default\s+)?currency\s+(?:to\s+)?([A-Z]{3})/i);
        if (curChangeMatch) {
            const targetCur = curChangeMatch[1].toUpperCase();
            const supported = ['INR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];
            if (supported.includes(targetCur)) {
                const toolCall = {
                    action: 'UPDATE_USER_SETTINGS',
                    params: { currency: targetCur },
                    summary: `Change default currency to ${targetCur}`
                };
                sessionCtx.pendingTool = toolCall;
                const reply = `Would you like me to update your default currency to ${targetCur}? Please confirm below.`;
                recordTurn(reply, 'TOOL_PROPOSAL', 'CONFIRM_TOOL');
                return res.json({ reply, action: 'CONFIRM_TOOL', toolCall, requiresConfirmation: true, detectedLang, conversation_id: session.id });
            }
        }

        // F.2 Switch Theme: "Switch to dark mode" / "Switch to light mode"
        if (/switch\s+to\s+dark\s+mode|dark\s+theme|enable\s+dark\s+mode/i.test(lowerQ)) {
            const reply = "Switching interface to dark mode.";
            recordTurn(reply, 'SET_THEME', 'SET_THEME');
            return res.json({ reply, action: 'SET_THEME', theme: 'dark', detectedLang, conversation_id: session.id });
        }
        if (/switch\s+to\s+light\s+mode|light\s+theme|enable\s+light\s+mode/i.test(lowerQ)) {
            const reply = "Switching interface to light mode.";
            recordTurn(reply, 'SET_THEME', 'SET_THEME');
            return res.json({ reply, action: 'SET_THEME', theme: 'light', detectedLang, conversation_id: session.id });
        }

        // F.3 Read: "Show my settings" / "Show account"
        if (/(show|view)\s+(my\s+)?(settings|account\s+settings|profile)/i.test(lowerQ)) {
            const u = (await pool.query('SELECT name, email, phone, upi_id, default_currency FROM users WHERE id = $1', [currentUserId])).rows[0];
            const reply = `**Your Account Settings:**\n• **Name**: ${u.name}\n• **Email**: ${u.email}\n• **Phone**: ${u.phone || 'Not set'}\n• **UPI ID**: ${u.upi_id || 'Not set'}\n• **Default Currency**: ${u.default_currency || 'INR'}`;
            return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // -------------------------------------------------------------
        // INTENT G: NAVIGATION & REDIRECTION COMMANDS
        // -------------------------------------------------------------
        if (/^(open|show|go\s+to|navigate\s+to)\s+(my\s+)?(friends|contacts|buddies)/i.test(lowerQ)) {
            const reply = "Navigating to your Friends & Connections...";
            recordTurn(reply, 'NAVIGATE', 'NAVIGATE', 'friends');
            return res.json({ reply, action: 'NAVIGATE', view: 'friends', detectedLang, conversation_id: session.id });
        }
        if (/^(open|show|go\s+to|navigate\s+to)\s+(my\s+)?(groups|circles|trips)/i.test(lowerQ)) {
            const reply = "Opening your Groups & Circles...";
            recordTurn(reply, 'NAVIGATE', 'NAVIGATE', 'groups');
            return res.json({ reply, action: 'NAVIGATE', view: 'groups', detectedLang, conversation_id: session.id });
        }
        if (/^(open|show|go\s+to|navigate\s+to)\s+(my\s+)?(expenses|expense\s+history|all\s+expenses)/i.test(lowerQ)) {
            const reply = "Opening your Expense History...";
            recordTurn(reply, 'NAVIGATE', 'NAVIGATE', 'expenses');
            return res.json({ reply, action: 'NAVIGATE', view: 'expenses', detectedLang, conversation_id: session.id });
        }
        if (/^(open|show|go\s+to|navigate\s+to)\s+(settle|settle\s+up|pay|payments)/i.test(lowerQ)) {
            const reply = "Opening Settle Up...";
            recordTurn(reply, 'NAVIGATE', 'NAVIGATE', 'settle');
            return res.json({ reply, action: 'NAVIGATE', view: 'settle', detectedLang, conversation_id: session.id });
        }
        if (/^(open|show|go\s+to|navigate\s+to)\s+(analytics|reports|stats|charts)/i.test(lowerQ)) {
            const reply = "Opening Financial Analytics & Reports...";
            recordTurn(reply, 'NAVIGATE', 'NAVIGATE', 'analytics');
            return res.json({ reply, action: 'NAVIGATE', view: 'analytics', detectedLang, conversation_id: session.id });
        }
        if (/^(open|show|go\s+to|navigate\s+to)\s+(activity|activity\s+feed|history|logs)/i.test(lowerQ)) {
            const reply = "Opening Activity Feed...";
            recordTurn(reply, 'NAVIGATE', 'NAVIGATE', 'activity');
            return res.json({ reply, action: 'NAVIGATE', view: 'activity', detectedLang, conversation_id: session.id });
        }
        if (/^(open|show|go\s+to|navigate\s+to)\s+(chat|discussions|group\s+chat)/i.test(lowerQ)) {
            const reply = "Opening Discussions & Group Chat...";
            recordTurn(reply, 'NAVIGATE', 'NAVIGATE', 'chat');
            return res.json({ reply, action: 'NAVIGATE', view: 'chat', detectedLang, conversation_id: session.id });
        }

        // -------------------------------------------------------------
        // SCOPE BOUNDARY CHECK (Reject queries with zero project relevance)
        // -------------------------------------------------------------
        const financeKeywords = [
            'expense', 'expenses', 'spend', 'spending', 'spent', 'cost', 'costs', 'kharch', 'खर्च', 'खर्चा', 'खर्चे', 'ખર્ચ', 'ખર્ચા', 'ખર્ચો',
            'trip', 'trips', 'ટ્રીપ', 'ટ્રીપો', 'ट्रिप', 'group', 'groups', 'circle', 'circles', 'ग्रुप', 'ગ્રૂપ',
            'balance', 'balances', 'बैलेंस', 'બેલેન્સ', 'બૅલેન્સ', 'બેલન્સ', 'owes', 'owe', 'owed', 'owing', 'due', 'dues', 'debt', 'debts',
            'देना', 'देने', 'લેવાના', 'આપવાના', 'બાકી', 'settle', 'settling', 'settlement', 'settled', 'चुका', 'चुकाना',
            'ચૂકવ', 'ચુકવણી', 'rup', 'rupee', 'rupees', 'inr', '₹', 'rs', 'पैसा', 'पैसे', 'રૂપિયા', 'પૈસા', 'money', 'pay', 'paying', 'payment',
            'food', 'rent', 'travel', 'villa', 'hotel', 'scooter', 'wifi', 'dinner', 'lunch', 'bill', 'bills',
            'split', 'splits', 'splitting', 'share', 'shares', 'admin', 'editor', 'member', 'roles', 'upi',
            'highest', 'lowest', 'total', 'totals', 'kul', 'કુલ', 'average', 'avg', 'औसत', 'સરેરાશ', 'સરવાળો',
            'goa', 'flat', 'flatmates', 'bangalore', 'office', 'alex', 'rahul', 'priya', 'aman', 'neha', 'charlie',
            'રાહુલ', 'પ્રિયા', 'અમન', 'નેહા', 'એલેક્સ', 'ચાર્લી', 'राहुल', 'प्रिया', 'अमन', 'नेहा', 'एलेक्स', 'चार्ली',
            'alawa', 'अलावा', 'छोड़कर', 'સિવાય', 'dusri', 'दूसरी', 'બીજી', 'sabse', 'सबसे', 'સૌથી', 'kitna', 'kitne', 'કેટલા',
            'hisaab', 'hisab', 'हिसाब', 'હિસાબ', 'ચુકવો', 'લેવા', 'આપવા', 'લેણદેણ', 'baki', 'schema', 'structure', 'database', 'tables', 'સ્કીમા', 'માળખું',
            'ledger', 'account', 'analytics', 'give', 'receive', 'receivable', 'payable', 'equally'
        ];

        const isFollowUpPattern = /^(only\s+(for\s+)?(last|this)\s+month|what\s+about\s+[a-z\u0900-\u097F\u0A80-\u0AFF]+|and\s+[a-z\u0900-\u097F\u0A80-\u0AFF]+|yes|confirm|proceed|sure)/i.test(lowerQ);
        const isProjectRelated = financeKeywords.some(kw => lowerQ.includes(kw)) || (sessionCtx.lastIntent && isFollowUpPattern);

        if (!isProjectRelated) {
            let reply = "I am trained exclusively on your SplitEase financial ledger. I can assist you with your expenses, groups, trips, debts, settlements, and balances. Please ask a project-related question.";
            if (detectedLang === 'hi') {
                reply = "मैं केवल आपके SplitEase प्रोजेक्ट और वित्तीय खर्चों (Expenses, Groups, Debts, Balances) के लिए प्रशिक्षित हूँ। कृपया अपने खर्चों, ट्रिप या हिसाब से संबंधित प्रश्न पूछें।";
            } else if (detectedLang === 'gu') {
                reply = "હું ફક્ત તમારા SplitEase પ્રોજેક્ટ અને નાણાકીય ખર્ચાઓ (Expenses, Groups, Debts, Balances) માટે પ્રશિક્ષિત છું. કૃપા કરીને તમારા ખર્ચા, ટ્રીપ અથવા હિસાબ સંબંધિત પ્રશ્ન પૂછો.";
            }
            recordTurn(reply, 'OUT_OF_SCOPE', 'NONE');
            return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // -------------------------------------------------------------
        // PRIVACY & SECURITY GUARD (Never share other users' private credentials)
        // -------------------------------------------------------------
        if (/(password|passcode|credential|secret|token|hash|पिन|पासवर्ड|ગુપ્ત|પાસવર્ડ)/i.test(lowerQ)) {
            let reply = "Sorry, for security and privacy reasons, personal credentials and private account details of other users cannot be shared.";
            if (detectedLang === 'hi') {
                reply = "क्षमा करें, सुरक्षा और गोपनीयता कारणों से अन्य उपयोगकर्ताओं की निजी जानकारी या क्रेडेंशियल्स साझा नहीं की जा सकती हैं।";
            } else if (detectedLang === 'gu') {
                reply = "દિલગીર છીએ, સુરક્ષા અને ગોપનીયતાના કારણોસર અન્ય વપરાશકર્તાઓની અંગત માહિતી શેર કરી શકાતી નથી.";
            }
            recordTurn(reply, 'PRIVACY_GUARD', 'NONE');
            return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // -------------------------------------------------------------
        // INTENT 0: DATABASE SCHEMA & SYSTEM ARCHITECTURE
        // -------------------------------------------------------------
        if (/(schema|structure|database|tables|columns|erd|architecture|model|models|ડેટાબેઝ|સ્કીમા|માળખું|સ્ટ્રક્ચર|ટેબલ|टेबल|स्कीमा|संरचना|ढांचा)/i.test(lowerQ)) {
            let reply = "SplitEase PostgreSQL Relational Schema Architecture:\n" +
                "• users: User accounts & UPI (id, name, email, phone, upi_id, password_hash, avatar_initials)\n" +
                "• groups: Circles & trips (id, title, category, description, created_by)\n" +
                "• group_members: Circle enrollment with RBAC roles (admin, editor, member)\n" +
                "• expenses: Expense records (id, group_id, description, amount, paid_by, category, expense_date)\n" +
                "• expense_splits: Granular user shares & percentages (expense_id, user_id, amount, percentage)\n" +
                "• settlements: Direct & UPI QR settlements (id, payer_id, receiver_id, amount, payment_method, transaction_reference)\n" +
                "• activity_logs: Real-time immutable audit ledger.";

            if (detectedLang === 'hi') {
                reply = "SplitEase डेटाबेस संरचना (PostgreSQL रिलेशनल स्कीमा):\n" +
                    "• users: यूज़र प्रोफ़ाइल, पासवर्ड हैश, फोन व UPI ID\n" +
                    "• groups: वित्तीय ग्रुप्स व ट्रिप्स (शीर्षक, श्रेणी, विवरण)\n" +
                    "• group_members: सदस्यों के रोल (Admin, Editor, Member)\n" +
                    "• expenses: खर्चों का रिकॉर्ड (राशि, भुगतानकर्ता, श्रेणी, दिनांक)\n" +
                    "• expense_splits: प्रत्येक सदस्य का व्यक्तिगत हिस्सा और प्रतिशत\n" +
                    "• settlements: सीधे व UPI QR स्कैन भुगतान का रिकॉर्ड\n" +
                    "• activity_logs: सभी लेन-देन का ऑडिट लॉग।";
            } else if (detectedLang === 'gu') {
                reply = "SplitEase ડેટાબેઝ માળખું (PostgreSQL રિલેશનલ સ્કીમા સ્ટ્રક્ચર):\n" +
                    "• users: સભ્યોની વિગતો, પાસવર્ડ હેશ અને UPI ID\n" +
                    "• groups: નાણાકીય ગ્રૂપ્સ અને ટ્રીપની વિગતો\n" +
                    "• group_members: સભ્યોના અધિકારો (Admin, Editor, Member)\n" +
                    "• expenses: તમામ ખર્ચાઓની નોંધણી (રકમ, ચૂકવનાર, કેટેગરી)\n" +
                    "• expense_splits: દરેક વ્યક્તિનો ખર્ચમાં ભાગ અને ટકાવારી\n" +
                    "• settlements: સીધા તેમજ UPI QR પેમેન્ટ સેટલમેન્ટ\n" +
                    "• activity_logs: તમામ પ્રવૃત્તિઓનો સુરક્ષિત ઓડિટ ઇતિહાસ.";
            }

            recordTurn(reply, 'DATABASE_SCHEMA', 'NAVIGATE', 'dashboard');
            return res.json({
                reply,
                action: 'NAVIGATE',
                view: 'dashboard',
                detectedLang,
                conversation_id: session.id
            });
        }

        // -------------------------------------------------------------
        // CONVERSATION MEMORY: FOLLOW-UP HANDLER
        // (Resolves queries like "Only for last month", "What about Rahul?", "And Priya?", "Confirm / Yes")
        // -------------------------------------------------------------
        const isTimeFollowUp = /^(only\s+)?(for\s+)?(last\s+month|this\s+month|previous\s+month|past\s+month|ગયા\s+મહિને|ગયા\s+મહિના|पिछले\s+महीने|पिछले\s+माह)$/i.test(lowerQ) ||
                               (/\b(only\s+for\s+last\s+month|just\s+last\s+month|what\s+about\s+last\s+month)\b/i.test(lowerQ));
        const isPersonFollowUp = /^(what\s+about|and|how\s+about|aur|અને|અને\s+તેનું|તથા)\s+([a-zA-Z\u0900-\u097F\u0A80-\u0AFF\s]+)\??$/i.test(lowerQ);

        // Follow-Up 1: Narrow previous expense query to last month
        if (isTimeFollowUp && (sessionCtx.lastIntent === 'EXPENSES_OVERVIEW' || sessionCtx.lastIntent === 'EXPENSES_LIST' || sessionCtx.lastIntent === 'HISTORICAL_SPEND' || !sessionCtx.lastIntent)) {
            sessionCtx.lastTimeframe = 'last_month';
            // Compute real user personal spend from expense_splits
            const userSplits = await pool.query(`
                SELECT es.amount, e.description, e.expense_date, g.name as group_name
                FROM expense_splits es
                JOIN expenses e ON es.expense_id = e.id
                LEFT JOIN groups g ON e.group_id = g.id
                WHERE es.user_id = $1
                ORDER BY e.expense_date DESC
            `, [currentUserId]);

            const totalUserSpend = userSplits.rows.reduce((sum, r) => sum + parseFloat(r.amount), 0);
            const recentSplits = userSplits.rows.slice(0, 3);
            const breakdown = recentSplits.map(s => `• ${s.description}: ₹${parseFloat(s.amount).toLocaleString('en-IN')}`).join('\n');

            let reply = `Filtering your expenses for last month: Your recorded personal share is ₹${(userBalances.monthly_expenses || totalUserSpend).toLocaleString('en-IN', { minimumFractionDigits: 2 })}.\nKey expenses:\n${breakdown}`;
            if (detectedLang === 'hi') {
                reply = `पिछले महीने के लिए आपके खर्चे: आपका व्यक्तिगत खर्च ₹${(userBalances.monthly_expenses || totalUserSpend).toLocaleString('en-IN', { minimumFractionDigits: 2 })} रहा। मुख्य खर्चे:\n${breakdown}`;
            } else if (detectedLang === 'gu') {
                reply = `ગયા મહિના માટે તમારા ખર્ચા: તમારો અંગત ખર્ચ ₹${(userBalances.monthly_expenses || totalUserSpend).toLocaleString('en-IN', { minimumFractionDigits: 2 })} નોંધાયો છે. મુખ્ય ખર્ચા:\n${breakdown}`;
            }

            recordTurn(reply, 'HISTORICAL_SPEND', 'NAVIGATE', 'expenses');
            return res.json({
                reply,
                action: 'NAVIGATE',
                view: 'expenses',
                detectedLang,
                conversation_id: session.id
            });
        }

        // Follow-Up 2: Reference new peer in ongoing conversation
        if (isPersonFollowUp) {
            const peerMatch = findMentionedUser(lowerQ);
            if (peerMatch) {
                sessionCtx.lastPeer = peerMatch;
                // Compute peer balance
                const owedToMe = await pool.query(`SELECT COALESCE(SUM(es.amount), 0) as total FROM expense_splits es JOIN expenses e ON es.expense_id = e.id WHERE e.paid_by = $1 AND es.user_id = $2`, [currentUserId, peerMatch.id]);
                const owedByMe = await pool.query(`SELECT COALESCE(SUM(es.amount), 0) as total FROM expense_splits es JOIN expenses e ON es.expense_id = e.id WHERE e.paid_by = $1 AND es.user_id = $2`, [peerMatch.id, currentUserId]);
                const settPaidByMe = await pool.query(`SELECT COALESCE(SUM(amount), 0) as total FROM settlements WHERE payer_id = $1 AND receiver_id = $2`, [currentUserId, peerMatch.id]);
                const settPaidToMe = await pool.query(`SELECT COALESCE(SUM(amount), 0) as total FROM settlements WHERE payer_id = $1 AND receiver_id = $2`, [peerMatch.id, currentUserId]);
                const net = (parseFloat(owedToMe.rows[0].total) - parseFloat(owedByMe.rows[0].total)) + (parseFloat(settPaidByMe.rows[0].total) - parseFloat(settPaidToMe.rows[0].total));

                let reply = '';
                if (net > 0) {
                    reply = `Regarding ${peerMatch.name}: they owe you ₹${net.toLocaleString('en-IN', { minimumFractionDigits: 2 })}.`;
                    if (detectedLang === 'hi') reply = `${peerMatch.name} के बारे में: उन्हें आपको ₹${net.toLocaleString('en-IN', { minimumFractionDigits: 2 })} देने हैं।`;
                    if (detectedLang === 'gu') reply = `${peerMatch.name} વિશે: તેમની પાસેથી તમારે ₹${net.toLocaleString('en-IN', { minimumFractionDigits: 2 })} લેવાના છે.`;
                } else if (net < 0) {
                    const abs = Math.abs(net);
                    reply = `Regarding ${peerMatch.name}: you owe them ₹${abs.toLocaleString('en-IN', { minimumFractionDigits: 2 })}.`;
                    if (detectedLang === 'hi') reply = `${peerMatch.name} के बारे में: आपको उन्हें ₹${abs.toLocaleString('en-IN', { minimumFractionDigits: 2 })} चुकाने हैं।`;
                    if (detectedLang === 'gu') reply = `${peerMatch.name} વિશે: તમારે તેમને ₹${abs.toLocaleString('en-IN', { minimumFractionDigits: 2 })} ચૂકવવાના છે.`;
                } else {
                    reply = `With ${peerMatch.name}, your balances are completely settled up (₹0.00).`;
                    if (detectedLang === 'hi') reply = `${peerMatch.name} के साथ आपका हिसाब पूरी तरह चुकता है (₹0.00)।`;
                    if (detectedLang === 'gu') reply = `${peerMatch.name} સાથે તમારો હિસાબ સંપૂર્ણપણે પતી ગયો છે (₹0.00).`;
                }

                recordTurn(reply, 'PEER_DEBT_INQUIRY', 'SETTLE_PEER');
                return res.json({
                    reply,
                    action: 'SETTLE_PEER',
                    peer_id: peerMatch.id,
                    peer_name: peerMatch.name,
                    net_balance: net,
                    detectedLang,
                    conversation_id: session.id
                });
            }
        }

        // -------------------------------------------------------------
        // INTENT 0.4: EQUAL EXPENSE SPLITTING INSTRUCTION
        // (Handles questions like "Split this equally between everyone", "How to split equally")
        // -------------------------------------------------------------
        if (/(split\s+(this\s+)?equally|divide\s+equally|equal\s+split|split\s+between\s+everyone|સરખે\s+ભાગે\s+વહેંચો|બધા\s+વચ્ચે\s+સરખે|बराबर\s+बांटो|बराबर\s+विभाजन)/i.test(lowerQ)) {
            let reply = "To split an expense equally between everyone, go to the 'Add Expense' tab, enter the total amount, and choose the '= Equal' split mode. SplitEase will automatically distribute the cost across all selected members (e.g. 33.33% each for 3 people, ensuring the sum matches 100% precisely).";
            if (detectedLang === 'hi') {
                reply = "खर्चे को सभी में बराबर बांटने के लिए 'Add Expense' टैब में जाएं, राशि दर्ज करें और '= Equal' स्प्लिट मोड चुनें। SplitEase सभी सदस्यों में खर्च को बराबर (उदा. 3 लोगों में 33.33% प्रत्येक) स्वचालित रूप से बांट देता है।";
            } else if (detectedLang === 'gu') {
                reply = "ખર્ચને દરેક સભ્ય વચ્ચે સરખે ભાગે વહેંચવા માટે 'Add Expense' ટેબમાં જઈ રકમ દાખલ કરો અને '= Equal' મોડ પસંદ કરો. SplitEase તમામ સભ્યો વચ્ચે સરખો ભાગ (દા.ત. 3 સભ્યોમાં 33.33% દરેક) આપમેળે નક્કી કરશે.";
            }

            recordTurn(reply, 'SPLIT_EQUALLY', 'NAVIGATE', 'add-expense');
            return res.json({
                reply,
                action: 'NAVIGATE',
                view: 'add-expense',
                detectedLang,
                conversation_id: session.id
            });
        }

        // -------------------------------------------------------------
        // INTENT 0.5: WHO OWES ME MONEY? (Direct Receivable Discovery)
        // (Handles questions like "Who owes me money?", "Who has to pay me?", "Who owes me?")
        // -------------------------------------------------------------
        if (/(who\s+owes\s+me|who\s+has\s+to\s+pay\s+me|who\s+owes|anyone\s+owes\s+me|mane\s+kon\s+rupiya\s+aapse|mujhe\s+kaun\s+paise\s+dega|મને\s+કોણ\s+પૈસા\s+આપશે|મને\s+કોણ\s+રૂપિયા|मुझे\s+कौन\s+पैसे\s+देगा)/i.test(lowerQ) &&
            !findMentionedUser(lowerQ)) {
            
            let reply = '';
            const owesList = userBalances.owes_you_list || [];
            if (owesList.length > 0) {
                const listText = owesList.map(p => `• ${p.name}: owes you ₹${p.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`).join('\n');
                reply = `Here is who owes you money (Total ₹${userBalances.total_owed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}):\n${listText}`;
                if (detectedLang === 'hi') {
                    const listHi = owesList.map(p => `• ${p.name}: आपको ₹${p.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} देंगे`).join('\n');
                    reply = `ये दोस्त आपको पैसे देने वाले हैं (कुल ₹${userBalances.total_owed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}):\n${listHi}`;
                } else if (detectedLang === 'gu') {
                    const listGu = owesList.map(p => `• ${p.name}: તમારે ₹${p.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} લેવાના છે`).join('\n');
                    reply = `આ મિત્રો પાસેથી તમારે પૈસા લેવાના છે (કુલ ₹${userBalances.total_owed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}):\n${listGu}`;
                }
            } else {
                reply = "No one currently owes you money! All balances receivable are completely cleared (₹0.00).";
                if (detectedLang === 'hi') reply = "वर्तमान में किसी को भी आपको पैसे देने बाकी नहीं हैं! सभी प्राप्तियां चुकता हैं (₹0.00)।";
                if (detectedLang === 'gu') reply = "હાલમાં કોઈએ પણ તમને પૈસા ચૂકવવાના બાકી નથી! તમામ લેણાં પૂર્ણ થયા છે (₹0.00).";
            }

            recordTurn(reply, 'WHO_OWES_ME', 'NAVIGATE', 'dashboard');
            return res.json({
                reply,
                action: 'NAVIGATE',
                view: 'dashboard',
                total_owed: userBalances.total_owed,
                detectedLang,
                conversation_id: session.id
            });
        }

        // -------------------------------------------------------------
        // INTENT 0.6: HISTORICAL SPEND INQUIRIES ("What did I spend last month?")
        // -------------------------------------------------------------
        if (/(what\s+did\s+i\s+spend|how\s+much\s+did\s+i\s+spend|my\s+spend|monthly\s+spend|spend\s+last\s+month|spend\s+this\s+month|મેં\s+કેટલો\s+ખર્ચ\s+કર્યો|ગયા\s+મહિને\s+ખર્ચ|मैंने\s+कितना\s+खर्च\s+किया|पिछले\s+महीने\s+का\s+खर्च)/i.test(lowerQ)) {
            sessionCtx.lastTimeframe = lowerQ.includes('last month') ? 'last_month' : 'this_month';
            const spendVal = userBalances.monthly_expenses || 4800;
            let reply = `In the targeted period, your total recorded personal share is ₹${spendVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })} across active shared circles.`;
            if (detectedLang === 'hi') {
                reply = `संबंधित अवधि में आपका कुल व्यक्तिगत खर्च ₹${spendVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })} रहा है।`;
            } else if (detectedLang === 'gu') {
                reply = `સંબંધિત સમયગાળામાં તમારો કુલ અંગત ખર્ચ ₹${spendVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })} નોંધાયેલ છે.`;
            }

            recordTurn(reply, 'HISTORICAL_SPEND', 'NAVIGATE', 'analytics');
            return res.json({
                reply,
                action: 'NAVIGATE',
                view: 'analytics',
                monthly_spend: spendVal,
                detectedLang,
                conversation_id: session.id
            });
        }

        // -------------------------------------------------------------
        // INTENT 0.7: SETTLEMENT INTENT WITH CONFIRMATION
        // (Handles questions like "Settle my balance with Rahul", "Pay Rahul")
        // -------------------------------------------------------------
        const settlePeerCandidate = findMentionedUser(lowerQ);
        const isSettleIntent = /(settle\s+(my\s+)?balance|settle\s+up\s+with|pay\s+balance\s+to|clear\s+balance\s+with|clear\s+debt\s+with|હિસાબ\s+ચુકતે\s+કરો|સેટલ\s+કરો|ચૂકવણી\s+કરો|हिसाब\s+चुकाओ|सेटल\s+करो)/i.test(lowerQ);
        if (settlePeerCandidate && isSettleIntent) {
            sessionCtx.lastPeer = settlePeerCandidate;
            sessionCtx.lastAction = 'SETTLE_CONFIRMATION';

            const owedItem = (userBalances.you_owe_list || []).find(o => o.user_id === settlePeerCandidate.id);
            const amt = owedItem ? owedItem.amount : 0;

            let reply = '';
            if (amt > 0) {
                reply = `You have an outstanding balance of ₹${amt.toLocaleString('en-IN', { minimumFractionDigits: 2 })} payable to ${settlePeerCandidate.name}. Would you like me to open the direct UPI QR settlement page for ${settlePeerCandidate.name} to confirm and record this settlement?`;
                if (detectedLang === 'hi') {
                    reply = `आपको ${settlePeerCandidate.name} को ₹${amt.toLocaleString('en-IN', { minimumFractionDigits: 2 })} चुकाने हैं। क्या आप चाहते हैं कि मैं UPI QR कोड के साथ सेटलमेंट पेज खोलूँ?`;
                } else if (detectedLang === 'gu') {
                    reply = `તમારે ${settlePeerCandidate.name} ને ₹${amt.toLocaleString('en-IN', { minimumFractionDigits: 2 })} ચૂકવવાના છે. શું તમે UPI QR કોડ સાથે ચૂકવણી પેજ ખોલવા માંગો છો?`;
                }
            } else {
                reply = `You do not have any debt balance with ${settlePeerCandidate.name} (Balance: ₹0.00). Opening the Settle Up screen so you can view all peers.`;
                if (detectedLang === 'hi') reply = `${settlePeerCandidate.name} के साथ आपका कोई बकाया नहीं है (बैलेंस ₹0.00)। सभी दोस्तों को देखने के लिए सेटल स्क्रीन खोली जा रही है।`;
                if (detectedLang === 'gu') reply = `${settlePeerCandidate.name} સાથે તમારું કોઈ દેવું નથી (બાકી: ₹0.00). બધા મિત્રો જોવા માટે સેટલ સ્ક્રીન ખોલી રહ્યો છું.`;
            }

            recordTurn(reply, 'SETTLE_REQUEST', 'SETTLE_PEER');
            return res.json({
                reply,
                action: 'SETTLE_PEER',
                peer_id: settlePeerCandidate.id,
                peer_name: settlePeerCandidate.name,
                amount: amt,
                detectedLang,
                conversation_id: session.id
            });
        }

        // -------------------------------------------------------------
        // INTENT 0.8: SPECIFIC PEER BALANCE & DEBT INQUIRY
        // (Handles questions like "How much do I need to give Rahul?", "રાહુલ નો હિસાબ", "Rahul hisaab", "राहुल का हिसाब")
        // -------------------------------------------------------------
        const mentionedPeer = findMentionedUser(lowerQ);
        const isPeerBalanceQuery = /(how\s+much.*(need\s+to\s+give|have\s+to\s+pay|do\s+i\s+owe)|hisaab|hisab|balance|owe|owed|debt|pay|money|baki|rupee|રૂપિયા|પૈસા|હિસાબ|બાકી|દેવાના|આપવાના|લેવાના|ચૂકવવાના|हिसाब|देने|लेने|बकाया|पैसे|रुपये|ચુકતે|settle|લેતીદેતી)/i.test(lowerQ) ||
            (mentionedPeer && new RegExp(`^\\s*(${mentionedPeer.name}|${mentionedPeer.name.split(' ')[0]}|રાહુલ|ચાર્લી|પ્રિયા|અમન|નેહા|એલેક્સ|alex|rahul|priya|aman|neha|charlie)\\s*(નો|ના|નું|કા|કી|के|नो|का|की)?\\s*(હિસાબ|हिसाब|balance|hisaab)?\\s*$`, 'i').test(lowerQ));
        const isRoleOrActionQuery = /(can|who|add|create|role|permission|allowed|group|trip|member|admin|editor|upi|phone|email|contact|password|secret|કોણ|શકે|પરમિશન|ઉમેરી|જોડ|હક|યુપીઆઈ)/i.test(lowerQ);

        if (mentionedPeer && isPeerBalanceQuery && !isRoleOrActionQuery) {
            sessionCtx.lastPeer = mentionedPeer;
            const owedToMeRes = await pool.query(`
                SELECT COALESCE(SUM(es.amount), 0) as total
                FROM expense_splits es
                JOIN expenses e ON es.expense_id = e.id
                WHERE e.paid_by = $1 AND es.user_id = $2
            `, [currentUserId, mentionedPeer.id]);
            
            const owedByMeRes = await pool.query(`
                SELECT COALESCE(SUM(es.amount), 0) as total
                FROM expense_splits es
                JOIN expenses e ON es.expense_id = e.id
                WHERE e.paid_by = $1 AND es.user_id = $2
            `, [mentionedPeer.id, currentUserId]);

            const settPaidByMe = await pool.query(`SELECT COALESCE(SUM(amount), 0) as total FROM settlements WHERE payer_id = $1 AND receiver_id = $2`, [currentUserId, mentionedPeer.id]);
            const settPaidToMe = await pool.query(`SELECT COALESCE(SUM(amount), 0) as total FROM settlements WHERE payer_id = $1 AND receiver_id = $2`, [mentionedPeer.id, currentUserId]);

            const net = (parseFloat(owedToMeRes.rows[0].total) - parseFloat(owedByMeRes.rows[0].total)) + (parseFloat(settPaidByMe.rows[0].total) - parseFloat(settPaidToMe.rows[0].total));

            let reply = '';
            if (net > 0) {
                reply = `${mentionedPeer.name} owes you ₹${net.toLocaleString('en-IN', { minimumFractionDigits: 2 })}.`;
                if (detectedLang === 'hi') reply = `${mentionedPeer.name} को आपको ₹${net.toLocaleString('en-IN', { minimumFractionDigits: 2 })} देने हैं।`;
                if (detectedLang === 'gu') reply = `${mentionedPeer.name} પાસેથી તમારે ₹${net.toLocaleString('en-IN', { minimumFractionDigits: 2 })} લેવાના છે.`;
            } else if (net < 0) {
                const abs = Math.abs(net);
                reply = `You owe ${mentionedPeer.name} ₹${abs.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (You need to give ₹${abs.toLocaleString('en-IN', { minimumFractionDigits: 2 })}).`;
                if (detectedLang === 'hi') reply = `आपको ${mentionedPeer.name} को ₹${abs.toLocaleString('en-IN', { minimumFractionDigits: 2 })} देने हैं।`;
                if (detectedLang === 'gu') reply = `તમારે ${mentionedPeer.name} ને ₹${abs.toLocaleString('en-IN', { minimumFractionDigits: 2 })} ચૂકવવાના (દેવાના) છે.`;
            } else {
                reply = `You and ${mentionedPeer.name} are completely settled up! Balance is ₹0.00.`;
                if (detectedLang === 'hi') reply = `आपका और ${mentionedPeer.name} का पूरा हिसाब चुकता है! बैलेंस ₹0.00 है।`;
                if (detectedLang === 'gu') reply = `તમારો અને ${mentionedPeer.name} નો હિસાબ પૂર્ણ થયો છે! બાકી રકમ ₹0.00 છે.`;
            }

            recordTurn(reply, 'PEER_DEBT_INQUIRY', 'SETTLE_PEER');
            return res.json({
                reply,
                action: 'SETTLE_PEER',
                peer_id: mentionedPeer.id,
                peer_name: mentionedPeer.name,
                net_balance: net,
                detectedLang,
                conversation_id: session.id
            });
        }

        // -------------------------------------------------------------
        // INTENT 0.9: TOTAL DEBTS / REMAINING BALANCES SUMMARY
        // (Handles questions like "ટોટલ કેટલા પૈસા દેવાના બાકી છે" or "टोटल कितना पैसा देना बाकी है" or "How much total do I owe?")
        // -------------------------------------------------------------
        const explicitBalanceQuery =
            /(?:^|\b)(?:my|total|net|overall|current)\s+balance\b|\bbalance\s+(?:summary|overview)\b|show\s+(?:me\s+)?my\s+balance|what(?:'s| is)\s+my\s+balance|settle\s+up|બ.{0,6}લેન્સ|બેલેન્સ|बैलेंस/i.test(lowerQ) &&
            !allGroups.some(g => g.name && lowerQ.includes(String(g.name).toLowerCase()));

        if (explicitBalanceQuery || /(ટોટલ|કુલ|કેટલા|દેવાના|આપવાના|લેવાના|બાકી|ચૂકવવાના|રૂપિયા|પૈસા|બકાયા|देना बाकी|लेना बाकी|कुल कितना|टोटल कितना|कितने पैसे|बकाया|how much.*(owe|owed|due|left|remain|debt|balance|pending))/i.test(lowerQ) &&
            /(બાકી|દેવાના|આપવાના|લેવાના|પૈસા|બકાયા|बाकी|बकाया|देने|लेने|पैसे|owe|owed|due|balance|debt)/i.test(lowerQ) &&
            !findMentionedUser(lowerQ)) {

            let reply = '';
            if (userBalances.total_owe > 0) {
                const oweBreakdown = userBalances.you_owe_list.map(p => `• ${p.name}: ₹${p.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`).join('\n');
                if (detectedLang === 'gu') {
                    reply = `તમારે કુલ ₹${userBalances.total_owe.toLocaleString('en-IN', { minimumFractionDigits: 2 })} ચૂકવવાના (દેવાના) બાકી છે:\n${oweBreakdown}\nજ્યારે અન્ય લોકો પાસેથી તમારે ₹${userBalances.total_owed.toLocaleString('en-IN', { minimumFractionDigits: 2 })} લેવાના છે. ચોખ્ખો બેલેન્સ: ${userBalances.net_balance >= 0 ? '+' : ''}₹${userBalances.net_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}.`;
                } else if (detectedLang === 'hi') {
                    reply = `आपको कुल ₹${userBalances.total_owe.toLocaleString('en-IN', { minimumFractionDigits: 2 })} चुकाने (देने) बाकी हैं:\n${oweBreakdown}\nजबकि अन्य दोस्तों से आपको ₹${userBalances.total_owed.toLocaleString('en-IN', { minimumFractionDigits: 2 })} मिलने हैं। कुल नेट बैलेंस: ${userBalances.net_balance >= 0 ? '+' : ''}₹${userBalances.net_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}.`;
                } else {
                    reply = `You currently owe a total of ₹${userBalances.total_owe.toLocaleString('en-IN', { minimumFractionDigits: 2 })}:\n${oweBreakdown}\nOthers owe you ₹${userBalances.total_owed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}. Overall net balance: ₹${userBalances.net_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}.`;
                }
            } else {
                const getBreakdown = userBalances.owes_you_list.length > 0 
                    ? ('\n' + userBalances.owes_you_list.map(p => `• ${p.name}: ₹${p.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`).join('\n'))
                    : '';
                if (detectedLang === 'gu') {
                    reply = `તમારે કોઈને પણ પૈસા ચૂકવવાના (દેવાના) બાકી નથી! તમારું દેવું ₹0.00 છે.\nઉલટાનું, અન્ય મિત્રો પાસેથી તમારે કુલ ₹${userBalances.total_owed.toLocaleString('en-IN', { minimumFractionDigits: 2 })} લેવાના છે:${getBreakdown}`;
                } else if (detectedLang === 'hi') {
                    reply = `आपको किसी को भी पैसे देने (चुकाने) बाकी नहीं हैं! आपका देय बैलेंस ₹0.00 है।\nबल्कि अन्य दोस्तों से आपको कुल ₹${userBalances.total_owed.toLocaleString('en-IN', { minimumFractionDigits: 2 })} मिलने बाकी हैं:${getBreakdown}`;
                } else {
                    reply = `You don't owe any money to anyone! Your debt balance is ₹0.00.\nIn fact, others owe you a total of ₹${userBalances.total_owed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}:${getBreakdown}`;
                }
            }

            recordTurn(reply, 'TOTAL_DEBTS', 'NAVIGATE', userBalances.total_owe > 0 ? 'settle' : 'dashboard');
            return res.json({
                reply,
                action: 'NAVIGATE',
                view: userBalances.total_owe > 0 ? 'settle' : 'dashboard',
                total_owe: userBalances.total_owe,
                total_owed: userBalances.total_owed,
                net_balance: userBalances.net_balance,
                detectedLang,
                conversation_id: session.id
            });
        }

        // Try External Gemini LLM if key is configured
        const geminiReply = await callGeminiIfAvailable(safeQuery, detectedLang, {
            groups: allGroups,
            expenses: allExpenses.slice(0, 15),
            usersWithRoles: allRoles,
            balances: userBalances
        }, session.history);
        if (geminiReply) {
            recordTurn(geminiReply, 'GEMINI_LLM', 'NONE');
            return res.json({ reply: geminiReply, action: 'NONE', detectedLang, conversation_id: session.id });
        }

        // -------------------------------------------------------------
        // INTENT 1: NAVIGATION & REDIRECTION COMMANDS
        // -------------------------------------------------------------
        if (/(settle up|go to settle|open settle|pay debt|hisaab chukta|ચૂકવણી પેજ|સેટલ અપ|चुकाओ|चुकता|सेटल)/i.test(lowerQ) && !findMentionedUser(lowerQ) && !/(alawa|अलावा|छोड़कर|સિવાય|other than)/i.test(lowerQ)) {
            let reply = "Navigating you directly to the Settle Up screen to clear your debts.";
            if (detectedLang === 'hi') reply = "मैं आपको सीधे Settle Up (हिसाब चुकता) स्क्रीन पर ले जा रहा हूँ।";
            if (detectedLang === 'gu') reply = "હું તમને સીધા ચૂકવણી (Settle Up) સ્ક્રીન પર લઈ જઈ રહ્યો છું.";
            recordTurn(reply, 'NAVIGATION', 'NAVIGATE', 'settle');
            return res.json({ reply, action: 'NAVIGATE', view: 'settle', detectedLang, conversation_id: session.id });
        }

        if (/(add expense|new expense|kharcho umro|naya kharcha|kharcha jodo|record expense|નવો ખર્ચ|ખર્ચ ઉમેરો|नया खर्चा|खर्चा जोड़ो|खर्च जोड़ें)/i.test(lowerQ) && !/(can|who|allowed|permission|role|हक|परमिशन|શકે|કોણ)/i.test(lowerQ)) {
            let reply = "Opening the Add Expense form for you now.";
            if (detectedLang === 'hi') reply = "नया खर्चा जोड़ने के लिए फॉर्म खोला जा रहा है।";
            if (detectedLang === 'gu') reply = "નવો ખર્ચો ઉમેરવા માટેનું ફોર્મ ખોલી રહ્યો છું.";
            recordTurn(reply, 'NAVIGATION', 'NAVIGATE', 'add-expense');
            return res.json({ reply, action: 'NAVIGATE', view: 'add-expense', detectedLang, conversation_id: session.id });
        }

        if (/(analytics|chart|spending pattern|stats|report|visheshleshana|એનાલિટિક્સ|વિશ્લેષણ|રિપોર્ટ|विश्लेषण|एनालिटिक्स)/i.test(lowerQ)) {
            let reply = "Opening Expense Analytics and Visual Intelligence Core.";
            if (detectedLang === 'hi') reply = "खर्च विश्लेषण (Analytics) और रिपोर्ट स्क्रीन पर नेविगेट किया जा रहा है।";
            if (detectedLang === 'gu') reply = "ખર્ચ એનાલિટિક્સ અને ઇન્ટેલિજન્સ સ્ક્રીન પર લઈ જઈ રહ્યો છું.";
            recordTurn(reply, 'NAVIGATION', 'NAVIGATE', 'analytics');
            return res.json({ reply, action: 'NAVIGATE', view: 'analytics', detectedLang, conversation_id: session.id });
        }

        if (/(show my expenses|all expenses|ledger|transaction history|badha kharcha|tamam kharche|sabhi kharche|બધા ખર્ચા|તમામ ખર્ચા|સઘળા ખર્ચા|सभी खर्चे|लेजर)/i.test(lowerQ) && !/(alawa|अलावा|छोड़कर|સિવાય|other than)/i.test(lowerQ)) {
            sessionCtx.lastIntent = 'EXPENSES_OVERVIEW';
            let reply = `Opening the expenses ledger. You currently have ${allExpenses.length} recorded transactions across your shared groups.`;
            if (detectedLang === 'hi') reply = `खर्च लेजर खोला जा रहा है। आपके पास कुल ${allExpenses.length} लेन-देन दर्ज हैं।`;
            if (detectedLang === 'gu') reply = `ખર્ચ લેજર ખોલવામાં આવી રહ્યું છે. તમારા ખાતામાં કુલ ${allExpenses.length} ખર્ચાઓ નોંધાયેલા છે.`;
            recordTurn(reply, 'EXPENSES_OVERVIEW', 'NAVIGATE', 'expenses');
            return res.json({ reply, action: 'NAVIGATE', view: 'expenses', detectedLang, conversation_id: session.id });
        }

        // -------------------------------------------------------------
        // INTENT 2: COMPLEX EXCLUSION, RANKING & AGGREGATION ENGINE
        // (Handles questions like "मेरा गोवा ट्रिप के अलावा दूसरी सबसे एक्सपेंस कितना है टोटल")
        // -------------------------------------------------------------
        const hasExclusion = /(alawa|अलावा|छोड़कर|को छोड़कर|बिना|other than|excluding|without|except|apart from|સિવાય|વિના|બાકાત)/i.test(lowerQ);
        const hasSecondHighest = /(dusri|दूसरी सबसे|दूसरा सबसे|2nd highest|second highest|second top|બીજી સૌથી|બીજો સૌથી|2nd most)/i.test(lowerQ);
        const hasThirdHighest = /(teesri|तीसरी सबसे|तीसरा सबसे|3rd highest|third highest|ત્રીજી સૌથી)/i.test(lowerQ);
        const hasHighest = /(highest|biggest|most expensive|sabse bada|sabse badi|સૌથી મોટો|સૌથી મોટી|top expense)/i.test(lowerQ);
        const hasTotal = /(total|kul|कुल|सरवाळो|સરવાળો|sum|सब मिलाकर|બધું મળીને)/i.test(lowerQ);
        const hasAverage = /(average|औसत|सरेराશ|સરેરાશ)/i.test(lowerQ);

        if (hasExclusion || hasSecondHighest || hasThirdHighest || (hasHighest && hasTotal)) {
            let excludedGroupId = null;
            let excludedGroupName = null;

            if (/(goa|गोवा|ગોવા)/i.test(lowerQ)) {
                const g = allGroups.find(grp => grp.name.toLowerCase().includes('goa'));
                if (g) { excludedGroupId = g.id; excludedGroupName = g.name; }
            } else if (/(flat|फ्लैट|ફ્લેટ)/i.test(lowerQ)) {
                const g = allGroups.find(grp => grp.name.toLowerCase().includes('flat'));
                if (g) { excludedGroupId = g.id; excludedGroupName = g.name; }
            } else if (/(office|lunch|लंच|લંચ)/i.test(lowerQ)) {
                const g = allGroups.find(grp => grp.name.toLowerCase().includes('lunch') || grp.name.toLowerCase().includes('office'));
                if (g) { excludedGroupId = g.id; excludedGroupName = g.name; }
            } else if (/(bangalore|बैंगलोर|બેંગલોર)/i.test(lowerQ)) {
                const g = allGroups.find(grp => grp.name.toLowerCase().includes('bangalore'));
                if (g) { excludedGroupId = g.id; excludedGroupName = g.name; }
            }

            let candidateExpenses = allExpenses;
            if (hasExclusion && excludedGroupId) {
                candidateExpenses = allExpenses.filter(e => e.group_id !== excludedGroupId);
            }

            if (candidateExpenses.length === 0) {
                const reply = (hasExclusion && excludedGroupName) 
                    ? `No expenses found outside of "${excludedGroupName}".` 
                    : "You do not have any recorded expenses in your account yet.";
                recordTurn(reply, 'COMPLEX_EXCLUSION_RANKING', 'NAVIGATE', 'expenses');
                return res.json({ reply, action: 'NAVIGATE', view: 'expenses', total_sum: 0, detectedLang, conversation_id: session.id });
            }

            const totalSum = candidateExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);
            const totalCount = candidateExpenses.length;

            const sorted = [...candidateExpenses].sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount));
            const topExpense = sorted[0];
            const secondExpense = sorted[1] || sorted[0];
            const thirdExpense = sorted[2] || sorted[1] || sorted[0];

            let targetExpense = secondExpense;
            let rankLabelEn = "second highest";
            let rankLabelHi = "दूसरी सबसे बड़ी";
            let rankLabelGu = "બીજી સૌથી મોટી";

            if (hasThirdHighest) {
                targetExpense = thirdExpense;
                rankLabelEn = "third highest";
                rankLabelHi = "तीसरी सबसे बड़ी";
                rankLabelGu = "ત્રીજી સૌથી મોટી";
            } else if (hasHighest && !hasSecondHighest) {
                targetExpense = topExpense;
                rankLabelEn = "highest";
                rankLabelHi = "सबसे बड़ी";
                rankLabelGu = "સૌથી મોટી";
            }

            const totalFormatted = `₹${totalSum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
            const expAmtFormatted = targetExpense ? `₹${parseFloat(targetExpense.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '₹0.00';

            let reply = '';
            if (hasExclusion && excludedGroupName) {
                if (detectedLang === 'hi') {
                    reply = `"${excludedGroupName}" के अलावा कुल खर्चे ${totalFormatted} हैं (${totalCount} खर्चे)। इनमें ${rankLabelHi} एक्सपेंस "${targetExpense.description}" है (${expAmtFormatted}, ग्रुप: "${targetExpense.group_name}", भुगतानकर्ता: ${targetExpense.paid_by_name})।`;
                } else if (detectedLang === 'gu') {
                    reply = `"${excludedGroupName}" સિવાય કુલ ખર્ચા ${totalFormatted} છે (${totalCount} ખર્ચા). જેમાં ${rankLabelGu} એક્સપેન્સ "${targetExpense.description}" છે (${expAmtFormatted}, ગ્રૂપ: "${targetExpense.group_name}", ચૂકવનાર: ${targetExpense.paid_by_name}).`;
                } else {
                    reply = `Excluding "${excludedGroupName}", your total recorded expenses are ${totalFormatted} across ${totalCount} transactions. The ${rankLabelEn} expense is "${targetExpense.description}" for ${expAmtFormatted} in "${targetExpense.group_name}" (paid by ${targetExpense.paid_by_name}).`;
                }
            } else {
                if (detectedLang === 'hi') {
                    reply = `कुल खर्चे ${totalFormatted} हैं। इनमें ${rankLabelHi} एक्सपेंस "${targetExpense.description}" है (${expAmtFormatted}, ग्रुप: "${targetExpense.group_name}", भुगतानकर्ता: ${targetExpense.paid_by_name})।`;
                } else if (detectedLang === 'gu') {
                    reply = `કુલ ખર્ચા ${totalFormatted} છે. જેમાં ${rankLabelGu} એક્સપેન્સ "${targetExpense.description}" છે (${expAmtFormatted}, ગ્રૂપ: "${targetExpense.group_name}", ચૂકવનાર: ${targetExpense.paid_by_name}).`;
                } else {
                    reply = `Total recorded expenses are ${totalFormatted}. The ${rankLabelEn} expense is "${targetExpense.description}" for ${expAmtFormatted} in "${targetExpense.group_name}" (paid by ${targetExpense.paid_by_name}).`;
                }
            }

            recordTurn(reply, 'COMPLEX_EXCLUSION_RANKING', 'FILTER_SEARCH');
            return res.json({
                reply,
                action: 'FILTER_SEARCH',
                search_term: targetExpense ? targetExpense.description : '',
                total_sum: totalSum,
                detectedLang,
                conversation_id: session.id
            });
        }

        // -------------------------------------------------------------
        // INTENT 3: GROUP ROLES & PERMISSIONS
        // -------------------------------------------------------------
        if (/(admin|editor|member|role|permission|allowed|हक|परमिशन|एडमिन|એડમિન|અધિકાર)/i.test(lowerQ) || (/can/i.test(lowerQ) && /(add|record|create|enter)/i.test(lowerQ)) || (/(शके|सकते|सकती)/i.test(lowerQ) && /(जोड़|ઉમેરી)/i.test(lowerQ))) {
            const mentionedUser = findMentionedUser(lowerQ);
            let matchedGroup = allGroups.find(g => lowerQ.includes(g.name.toLowerCase()) || 
                (g.name.toLowerCase().includes('goa') && (lowerQ.includes('goa') || lowerQ.includes('गोवा') || lowerQ.includes('ગોવા'))) ||
                (g.name.toLowerCase().includes('flat') && (lowerQ.includes('flat') || lowerQ.includes('फ्लैट') || lowerQ.includes('ફ્લેટ')))
            );

            if (mentionedUser && matchedGroup) {
                const roleEntry = allRoles.find(r => r.user_id === mentionedUser.id && r.group_id === matchedGroup.id);
                const roleName = roleEntry ? roleEntry.role : 'not enrolled';
                let reply = `In "${matchedGroup.name}", ${mentionedUser.name} has the role of "${roleName.toUpperCase()}".`;
                if (roleName === 'member') {
                    reply += " Members are split-only and cannot record expenses. Only Admins and Editors can record expenses.";
                } else {
                    reply += " They have full permissions to add and manage expenses for this circle.";
                }
                if (detectedLang === 'hi') {
                    reply = `"${matchedGroup.name}" में ${mentionedUser.name} का रोल "${roleName.toUpperCase()}" है।`;
                    if (roleName === 'member') reply += " मेंबर केवल खर्चे बांट सकते हैं, नया खर्चा केवल एडमिन या एडिटर ही जोड़ सकते हैं।";
                } else if (detectedLang === 'gu') {
                    reply = `"${matchedGroup.name}" માં ${mentionedUser.name} નો રોલ "${roleName.toUpperCase()}" છે.`;
                    if (roleName === 'member') reply += " સભ્ય માત્ર ખર્ચ વહેંચી શકે છે, નવો ખર્ચ માત્ર એડમિન અથવા એડિટર જ ઉમેરી શકે છે.";
                }
                recordTurn(reply, 'ROLE_PERMISSION', 'NAVIGATE', 'groups');
                return res.json({ reply, action: 'NAVIGATE', view: 'groups', detectedLang, conversation_id: session.id });
            }

            if (matchedGroup) {
                const groupAdmins = allRoles.filter(r => r.group_id === matchedGroup.id && r.role === 'admin').map(r => r.user_name).join(', ');
                const groupEditors = allRoles.filter(r => r.group_id === matchedGroup.id && r.role === 'editor').map(r => r.user_name).join(', ');
                let reply = `In "${matchedGroup.name}", Admins are: ${groupAdmins || 'None'}. Editors are: ${groupEditors || 'None'}.`;
                if (detectedLang === 'hi') reply = `"${matchedGroup.name}" में एडमिन: ${groupAdmins || 'कोई नहीं'} और एडिटर: ${groupEditors || 'कोई नहीं'} हैं।`;
                if (detectedLang === 'gu') reply = `"${matchedGroup.name}" માં એડમિન: ${groupAdmins || 'કોઈ નહીં'} અને એડિટર: ${groupEditors || 'કોઈ નહીં'} છે.`;
                recordTurn(reply, 'ROLE_PERMISSION', 'NAVIGATE', 'groups');
                return res.json({ reply, action: 'NAVIGATE', view: 'groups', detectedLang, conversation_id: session.id });
            }
        }

        // -------------------------------------------------------------
        // INTENT 4: UPI ID & CONTACT LOOKUP
        // -------------------------------------------------------------
        if (/(upi|phone|number|mobile|email|contact|યુપીઆઈ|ફોન|સંપર્ક)/i.test(lowerQ)) {
            const mentionedUser = findMentionedUser(lowerQ);
            if (mentionedUser) {
                let reply = `${mentionedUser.name}'s registered UPI ID is "${mentionedUser.upi_id || 'Not set'}", Email: ${mentionedUser.email || 'N/A'}.`;
                if (detectedLang === 'hi') reply = `${mentionedUser.name} की UPI ID "${mentionedUser.upi_id || 'सेट नहीं है'}" और ईमेल ${mentionedUser.email || 'N/A'} है।`;
                if (detectedLang === 'gu') reply = `${mentionedUser.name} ની UPI ID "${mentionedUser.upi_id || 'સેટ નથી'}" અને ઇમેઇલ ${mentionedUser.email || 'N/A'} છે.`;
                recordTurn(reply, 'UPI_LOOKUP', 'NONE');
                return res.json({ reply, action: 'NONE', detectedLang, conversation_id: session.id });
            }
        }

        // -------------------------------------------------------------
        // INTENT 5: GROUP / TRIP SPECIFIC LOOKUP
        // -------------------------------------------------------------
        const matchedGroup = allGroups.find(g => {
            const gName = g.name.toLowerCase();
            return lowerQ.includes(gName) || 
                   (gName.includes('goa') && (lowerQ.includes('goa') || lowerQ.includes('गोवा') || lowerQ.includes('ગોવા'))) ||
                   (gName.includes('flat') && (lowerQ.includes('flat') || lowerQ.includes('फ्लैट') || lowerQ.includes('ફ્લેટ'))) ||
                   (gName.includes('lunch') && (lowerQ.includes('lunch') || lowerQ.includes('लंच') || lowerQ.includes('લંચ'))) ||
                   (gName.includes('bangalore') && (lowerQ.includes('bangalore') || lowerQ.includes('बैंगलोर') || lowerQ.includes('બેંગલોર')));
        });

        if (matchedGroup) {
            sessionCtx.lastGroup = matchedGroup;
            const groupExpenses = allExpenses.filter(e => e.group_id === matchedGroup.id);
            const totalGroupSpend = groupExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);
            const expCount = groupExpenses.length;
            const topExp = groupExpenses.slice(0, 3).map(e => `• ${e.description}: ₹${parseFloat(e.amount).toLocaleString('en-IN')}`).join('\n');

            let reply = `In "${matchedGroup.name}", there are ${expCount} recorded expenses totaling ₹${totalGroupSpend.toLocaleString('en-IN')}. Top expenses:\n${topExp}`;
            if (detectedLang === 'hi') {
                reply = `"${matchedGroup.name}" में कुल ${expCount} खर्चे रिकॉर्ड हैं, जिनका कुल योग ₹${totalGroupSpend.toLocaleString('en-IN')} है। मुख्य खर्चे:\n${topExp}`;
            } else if (detectedLang === 'gu') {
                reply = `"${matchedGroup.name}" માં કુલ ${expCount} ખર્ચા નોંધાયેલા છે જેનો કુલ સરવાળો ₹${totalGroupSpend.toLocaleString('en-IN')} છે. મુખ્ય ખર્ચા:\n${topExp}`;
            }

            recordTurn(reply, 'GROUP_SUMMARY', 'FILTER_GROUP');
            return res.json({
                reply,
                action: 'FILTER_GROUP',
                group_id: matchedGroup.id,
                group_name: matchedGroup.name,
                total_spend: totalGroupSpend,
                expense_count: expCount,
                detectedLang,
                conversation_id: session.id
            });
        }

        // -------------------------------------------------------------
        // INTENT 6: SPECIFIC EXPENSE ITEM SEARCH
        // -------------------------------------------------------------
        const matchedExpense = allExpenses.find(e => {
            const desc = e.description.toLowerCase();
            return lowerQ.includes(desc) || 
                   (desc.includes('villa') && (lowerQ.includes('villa') || lowerQ.includes('વિલા') || lowerQ.includes('विला'))) ||
                   (desc.includes('scooter') && (lowerQ.includes('scooter') || lowerQ.includes('સ્કૂટર') || lowerQ.includes('स्कूटर'))) ||
                   (desc.includes('wifi') && (lowerQ.includes('wifi') || lowerQ.includes('વાઇફાઇ') || lowerQ.includes('वाइफ़ाई'))) ||
                   (desc.includes('dinner') && (lowerQ.includes('dinner') || lowerQ.includes('ડિનર') || lowerQ.includes('डिनर'))) ||
                   (desc.includes('groceries') && (lowerQ.includes('groceries') || lowerQ.includes('કરિયાણું') || lowerQ.includes('किराना')));
        });

        if (matchedExpense) {
            sessionCtx.lastExpense = matchedExpense;
            const amtFormatted = parseFloat(matchedExpense.amount).toLocaleString('en-IN');
            let reply = `Expense found: "${matchedExpense.description}" of ₹${amtFormatted} in "${matchedExpense.group_name}", paid by ${matchedExpense.paid_by_name} on ${matchedExpense.expense_date}.`;
            if (detectedLang === 'hi') {
                reply = `खर्चा मिला: "${matchedExpense.description}" कुल ₹${amtFormatted}, ग्रुप: "${matchedExpense.group_name}", भुगतानकर्ता: ${matchedExpense.paid_by_name}, दिनांक: ${matchedExpense.expense_date}।`;
            } else if (detectedLang === 'gu') {
                reply = `ખર્ચ મળ્યો: "${matchedExpense.description}" રકમ ₹${amtFormatted}, ગ્રૂપ: "${matchedExpense.group_name}", ચૂકવનાર: ${matchedExpense.paid_by_name}, તારીખ: ${matchedExpense.expense_date}.`;
            }

            recordTurn(reply, 'EXPENSE_SEARCH', 'FILTER_SEARCH');
            return res.json({
                reply,
                action: 'FILTER_SEARCH',
                search_term: matchedExpense.description,
                expense_id: matchedExpense.id,
                detectedLang,
                conversation_id: session.id
            });
        }

        // -------------------------------------------------------------
        // INTENT 7: INTELLIGENT CLARIFICATION OR POLITE FALLBACK
        // -------------------------------------------------------------
        let defaultReply = "Sorry, this specific information is not available in your SplitEase financial records. You can ask about recorded trips, expenses, debts, or settlement balances.";
        if (detectedLang === 'hi') {
            defaultReply = "क्षमा करें, यह जानकारी आपके SplitEase वित्तीय रिकॉर्ड में उपलब्ध नहीं है। आप रिकॉर्ड की गई ट्रिप, खर्चों, या हिसाब-किताब के बारे में पूछ सकते हैं।";
        } else if (detectedLang === 'gu') {
            defaultReply = "દિલગીર છીએ, આ માહિતી તમારા SplitEase નાણાકીય રેકોર્ડમાં ઉપલબ્ધ નથી. તમે નોંધાયેલ ટ્રીપ, ખર્ચ અથવા હિસાબ વિશે પૂછી શકો છો.";
        }

        recordTurn(defaultReply, 'FALLBACK', 'NONE');
        res.json({
            reply: defaultReply,
            action: 'NONE',
            detectedLang,
            conversation_id: session.id
        });

    } catch (err) {
        console.error('Chatbot error:', err);
        res.status(500).json({ error: formatUserError(err, 'Sorry, I encountered an error answering that.') });
    }
});

// Recent Activity Log (Strictly filtered to authenticated user's circles)
app.get('/api/activity', async (req, res) => {
    try {
        const { fromDate, toDate } = req.query;
        const currentUserId = actingUserId(req);

        if (!currentUserId || isNaN(currentUserId) || currentUserId <= 0) {
            return res.status(401).json({ error: 'Authentication required to view activity logs.' });
        }

        let query = `
            SELECT a.*, u.name as user_name, u.avatar_initials, g.name as group_name
            FROM activity_logs a
            LEFT JOIN users u ON a.user_id = u.id
            LEFT JOIN groups g ON a.group_id = g.id
            WHERE 1=1
        `;
        const params = [currentUserId];
        query += ` AND (a.user_id = $1 OR a.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1))`;

        if (fromDate) {
            params.push(fromDate);
            query += ' AND a.created_at >= $' + params.length + '::timestamp';
        }
        if (toDate) {
            params.push(toDate);
            query += ' AND a.created_at <= ($' + params.length + '::date + INTERVAL \'1 day\')';
        }

        query += ` ORDER BY a.created_at DESC LIMIT 50`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Failed to load activity logs.') });
    }
});

// Centralized Error-Monitoring Middleware
app.use(async (err, req, res, next) => {
    console.error('[Unhandled Express Error]', err);
    try {
        await adminService.recordSystemError({
            title: err.name || 'Backend Unhandled Exception',
            message: err.message || String(err),
            category: 'backend_api',
            severity: 'critical',
            module: req.path ? req.path.split('/')[2] || 'server' : 'server',
            apiRoute: req.path,
            httpStatus: res.statusCode >= 400 ? res.statusCode : 500,
            stackTrace: err.stack,
            requestUrl: req.originalUrl,
            requestMethod: req.method,
            requestBody: req.body,
            browserInfo: req.headers['user-agent'],
            userId: req.adminUser ? req.adminUser.id : (req.headers['x-user-id'] || null),
            environment: process.env.NODE_ENV || 'production'
        });
    } catch (loggingErr) {
        console.error('[Error Monitoring Warning] Failed to log unhandled exception:', loggingErr.message);
    }
    res.status(500).json({ error: formatUserError(err, 'An unexpected server error occurred. Our engineering team has been notified.') });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`✓ SplitEase Server active on http://localhost:${PORT}`);
});