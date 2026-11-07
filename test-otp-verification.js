const http = require('http');
const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config();

const pool = new Pool(
    process.env.DATABASE_URL
        ? {
            connectionString: process.env.DATABASE_URL,
            ssl: (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL.includes('supabase')) ? { rejectUnauthorized: false } : false
          }
        : {
            user: process.env.DB_USER || 'postgres',
            host: process.env.DB_HOST || 'localhost',
            database: process.env.DB_NAME || 'splitwise_db',
            password: process.env.DB_PASSWORD || 'postgres123',
            port: parseInt(process.env.DB_PORT || '5432')
          }
);

function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request({
            hostname: 'localhost',
            port: 5000,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch(e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function assert(condition, message) {
    if (!condition) {
        console.error(`❌ FAIL: ${message}`);
        throw new Error(message);
    }
    console.log(`✓ PASS: ${message}`);
}

async function runOtpTests() {
    console.log('====================================================');
    console.log('🧪 SPLITWISE EMAIL OTP VERIFICATION COMPREHENSIVE SUITE');
    console.log('====================================================\n');

    const testTimestamp = Date.now();
    const testSignupEmail = `test.otp.user.${testTimestamp}@example.com`;
    const testPassword = 'Password123!';
    const testName = 'OTP Test User';

    try {
        // ----------------------------------------------------
        // TEST 1: Already registered email conflict
        // ----------------------------------------------------
        console.log('--- TEST 1: Already registered email conflict ---');
        const conflictRes = await request('POST', '/api/auth/send-signup-otp', {
            name: 'Alex Duplicate',
            email: 'alex@splitease.io',
            password: 'Password123!'
        });
        assert(conflictRes.status === 409, 'Conflict detected (409) for existing email');
        assert(conflictRes.data.error.includes('already registered'), 'Friendly already registered message returned');

        // ----------------------------------------------------
        // TEST 2: Signup OTP Generation & Dispatch
        // ----------------------------------------------------
        console.log('\n--- TEST 2: Signup OTP Generation & Dispatch ---');
        const sendOtpRes = await request('POST', '/api/auth/send-signup-otp', {
            name: testName,
            email: testSignupEmail,
            password: testPassword
        });
        assert(sendOtpRes.status === 200, 'Signup OTP requested successfully with 200');
        assert(sendOtpRes.data.success === true, 'Response marked success');
        assert(sendOtpRes.data.verification_id, 'Verification ID returned');
        assert(sendOtpRes.data.otp === undefined, 'CRITICAL: OTP is NEVER exposed in API response');

        // Verify stored in DB with secure hash (not plaintext)
        const verifRow = await pool.query(
            'SELECT * FROM email_verifications WHERE LOWER(email) = LOWER($1) AND purpose = $2 AND is_used = FALSE',
            [testSignupEmail, 'signup']
        );
        assert(verifRow.rows.length === 1, 'Verification record created in email_verifications table');
        assert(verifRow.rows[0].otp_hash && verifRow.rows[0].otp_hash.length === 64, 'OTP stored as 64-char HMAC-SHA256 hex hash');
        assert(verifRow.rows[0].payload.name === testName, 'Registration payload preserved in database');
        assert(verifRow.rows[0].payload.password_hash !== testPassword, 'Password stored only as bcrypt hash, never plaintext');

        // ----------------------------------------------------
        // TEST 3: Rate Limiting & 30-Sec Cooldown Enforcement
        // ----------------------------------------------------
        console.log('\n--- TEST 3: Rate Limiting & Cooldown ---');
        const cooldownRes = await request('POST', '/api/auth/send-signup-otp', {
            name: testName,
            email: testSignupEmail,
            password: testPassword
        });
        assert(cooldownRes.status === 429, 'Immediate duplicate request rejected with 429 Too Many Requests');
        assert(cooldownRes.data.cooldown > 0, 'Remaining cooldown seconds returned');

        // ----------------------------------------------------
        // TEST 4: Incorrect OTP Rejection & Attempt Counter
        // ----------------------------------------------------
        console.log('\n--- TEST 4: Incorrect OTP Rejection ---');
        const wrongOtpRes = await request('POST', '/api/auth/verify-signup-otp', {
            email: testSignupEmail,
            otp: '000000',
            verification_id: sendOtpRes.data.verification_id
        });
        assert(wrongOtpRes.status === 400, 'Incorrect OTP rejected with 400');
        assert(wrongOtpRes.data.error.includes('incorrect'), 'Friendly error message returned');

        const attemptsRow = await pool.query('SELECT attempts FROM email_verifications WHERE id = $1', [verifRow.rows[0].id]);
        assert(attemptsRow.rows[0].attempts === 1, 'Attempt counter incremented in database to 1');

        // ----------------------------------------------------
        // TEST 5: User cannot login before OTP verification
        // ----------------------------------------------------
        console.log('\n--- TEST 5: Prevention of Unverified Login ---');
        const preLoginRes = await request('POST', '/api/users/login', {
            email: testSignupEmail,
            password: testPassword
        });
        assert(preLoginRes.status === 400, 'Unverified user cannot log in');

        // ----------------------------------------------------
        // TEST 6: Correct OTP Verification & Account Creation
        // ----------------------------------------------------
        console.log('\n--- TEST 6: Correct OTP Verification & Account Creation ---');
        // Retrieve actual generated OTP hash and find matching OTP (100000 - 999999) using secret
        const OTP_SECRET = process.env.OTP_SECRET || 'splitwise-secure-otp-secret-key-2026';
        let foundOtp = null;
        for (let code = 100000; code <= 999999; code++) {
            const h = crypto.createHmac('sha256', OTP_SECRET).update(`${testSignupEmail.toLowerCase()}:signup:${code}`).digest('hex');
            if (h === verifRow.rows[0].otp_hash) {
                foundOtp = code.toString();
                break;
            }
        }
        assert(foundOtp !== null, 'Found genuine cryptographically issued OTP from DB hash');

        const verifyRes = await request('POST', '/api/auth/verify-signup-otp', {
            email: testSignupEmail,
            otp: foundOtp,
            verification_id: sendOtpRes.data.verification_id
        });
        assert(verifyRes.status === 200, 'Valid OTP accepted with 200');
        assert(verifyRes.data.success === true, 'Success flag true');
        assert(verifyRes.data.user && verifyRes.data.user.email.toLowerCase() === testSignupEmail.toLowerCase(), 'New user created with verified email');

        // Verify user in DB
        const dbUser = await pool.query('SELECT id, name, email, is_verified FROM users WHERE LOWER(email) = LOWER($1)', [testSignupEmail]);
        assert(dbUser.rows.length === 1, 'User persisted in users table');
        assert(dbUser.rows[0].is_verified === true, 'User is marked is_verified = TRUE');

        // Verify verification record marked used
        const usedVerif = await pool.query('SELECT is_used, used_at FROM email_verifications WHERE id = $1', [verifRow.rows[0].id]);
        assert(usedVerif.rows[0].is_used === true, 'Verification record marked is_used = TRUE');
        assert(usedVerif.rows[0].used_at !== null, 'Used timestamp recorded');

        // ----------------------------------------------------
        // TEST 7: OTP Reuse Prevention
        // ----------------------------------------------------
        console.log('\n--- TEST 7: OTP Reuse Prevention ---');
        const reuseRes = await request('POST', '/api/auth/verify-signup-otp', {
            email: testSignupEmail,
            otp: foundOtp,
            verification_id: sendOtpRes.data.verification_id
        });
        assert(reuseRes.status === 400, 'Reused OTP strictly rejected');

        // ----------------------------------------------------
        // TEST 8: Login with newly verified account
        // ----------------------------------------------------
        console.log('\n--- TEST 8: Login with Newly Verified Account ---');
        const postLoginRes = await request('POST', '/api/users/login', {
            email: testSignupEmail,
            password: testPassword
        });
        assert(postLoginRes.status === 200, 'Successfully logged in with verified credentials');
        assert(postLoginRes.data.user.name === testName, 'Returned authenticated user profile');

        // ----------------------------------------------------
        // TEST 9: Forgot Password - Request OTP (Registered Email)
        // ----------------------------------------------------
        console.log('\n--- TEST 9: Forgot Password - Request OTP ---');
        const forgotRes = await request('POST', '/api/auth/forgot-password-otp', {
            email: testSignupEmail
        });
        assert(forgotRes.status === 200, 'Forgot password request returned 200');
        assert(forgotRes.data.message.includes('If an account exists'), 'Neutral security message returned (prevents enumeration)');

        // Retrieve reset OTP from database
        const resetVerifRow = await pool.query(
            'SELECT * FROM email_verifications WHERE LOWER(email) = LOWER($1) AND purpose = $2 AND is_used = FALSE ORDER BY created_at DESC LIMIT 1',
            [testSignupEmail, 'password_reset']
        );
        assert(resetVerifRow.rows.length === 1, 'Password reset verification record stored in database');

        let resetOtp = null;
        for (let code = 100000; code <= 999999; code++) {
            const h = crypto.createHmac('sha256', OTP_SECRET).update(`${testSignupEmail.toLowerCase()}:password_reset:${code}`).digest('hex');
            if (h === resetVerifRow.rows[0].otp_hash) {
                resetOtp = code.toString();
                break;
            }
        }
        assert(resetOtp !== null, 'Found genuine reset OTP from hash');

        // ----------------------------------------------------
        // TEST 10: Forgot Password - Unknown Email Privacy
        // ----------------------------------------------------
        console.log('\n--- TEST 10: Unknown Email Privacy ---');
        const unknownRes = await request('POST', '/api/auth/forgot-password-otp', {
            email: 'unknown.nonexistent.user.999@example.com'
        });
        assert(unknownRes.status === 200, 'Unknown email returns 200 neutral message (zero account enumeration)');
        assert(unknownRes.data.message.includes('If an account exists'), 'Identical neutral message returned');

        // ----------------------------------------------------
        // TEST 11: Cross-Purpose Protection (Signup OTP on Password Reset)
        // ----------------------------------------------------
        console.log('\n--- TEST 11: Cross-Purpose Protection ---');
        const crossPurposeRes = await request('POST', '/api/auth/verify-reset-otp', {
            email: testSignupEmail,
            otp: foundOtp // Old signup OTP
        });
        assert(crossPurposeRes.status === 400, 'Signup OTP cannot verify Password Reset (purpose-bound HMAC)');

        // ----------------------------------------------------
        // TEST 12: Verify Password Reset OTP & Receive Single-Use Reset Token
        // ----------------------------------------------------
        console.log('\n--- TEST 12: Verify Password Reset OTP ---');
        const verifyResetRes = await request('POST', '/api/auth/verify-reset-otp', {
            email: testSignupEmail,
            otp: resetOtp
        });
        assert(verifyResetRes.status === 200, 'Password reset OTP successfully verified');
        assert(verifyResetRes.data.reset_token, 'Single-use reset token issued');
        const resetToken = verifyResetRes.data.reset_token;

        // ----------------------------------------------------
        // TEST 13: Password Mismatch Rejection
        // ----------------------------------------------------
        console.log('\n--- TEST 13: Password Mismatch Rejection ---');
        const mismatchRes = await request('POST', '/api/auth/complete-password-reset', {
            email: testSignupEmail,
            reset_token: resetToken,
            new_password: 'BrandNewPassword1!',
            confirm_password: 'MismatchPassword2!'
        });
        assert(mismatchRes.status === 400, 'Password mismatch rejected with 400');

        // ----------------------------------------------------
        // TEST 14: Complete Password Reset with Valid Token
        // ----------------------------------------------------
        console.log('\n--- TEST 14: Complete Password Reset ---');
        const completeResetRes = await request('POST', '/api/auth/complete-password-reset', {
            email: testSignupEmail,
            reset_token: resetToken,
            new_password: 'BrandNewPassword1!',
            confirm_password: 'BrandNewPassword1!'
        });
        assert(completeResetRes.status === 200, 'Password changed successfully');
        assert(completeResetRes.data.message.includes('successfully'), 'Success message returned');

        // ----------------------------------------------------
        // TEST 15: Single-Use Reset Token Invalidation
        // ----------------------------------------------------
        console.log('\n--- TEST 15: Single-Use Reset Token Invalidation ---');
        const secondResetRes = await request('POST', '/api/auth/complete-password-reset', {
            email: testSignupEmail,
            reset_token: resetToken,
            new_password: 'AnotherPassword3!',
            confirm_password: 'AnotherPassword3!'
        });
        assert(secondResetRes.status === 400, 'Reused reset token rejected (single-use enforced)');

        // ----------------------------------------------------
        // TEST 16: Login with New Password & Rejection of Old Password
        // ----------------------------------------------------
        console.log('\n--- TEST 16: Login with New vs Old Password ---');
        const oldPassLoginRes = await request('POST', '/api/users/login', {
            email: testSignupEmail,
            password: testPassword // old password
        });
        assert(oldPassLoginRes.status === 400, 'Old password no longer works');

        const newPassLoginRes = await request('POST', '/api/users/login', {
            email: testSignupEmail,
            password: 'BrandNewPassword1!' // new password
        });
        assert(newPassLoginRes.status === 200, 'Login with new password succeeds with 200');

        // ----------------------------------------------------
        // TEST 17: Brute-Force Lockout (5 incorrect attempts)
        // ----------------------------------------------------
        console.log('\n--- TEST 17: Brute-Force Lockout (Max 5 Attempts) ---');
        // Request fresh OTP for another user
        const bfEmail = `bf.user.${testTimestamp}@example.com`;
        const bfSendRes = await request('POST', '/api/auth/send-signup-otp', {
            name: 'Brute Force Test',
            email: bfEmail,
            password: 'SecurePassword123!'
        });
        assert(bfSendRes.status === 200, 'Sent OTP for brute-force lockout test');

        for (let i = 1; i <= 5; i++) {
            const attemptRes = await request('POST', '/api/auth/verify-signup-otp', {
                email: bfEmail,
                otp: '111111'
            });
            if (i < 5) {
                assert(attemptRes.status === 400, `Attempt ${i} rejected with 400`);
            } else {
                assert(attemptRes.status === 429, 'Attempt 5 exceeded limit, rejected with 429 Too Many Requests');
            }
        }

        // Even with correct OTP, it should now be locked
        const lockedVerifRow = await pool.query('SELECT is_used FROM email_verifications WHERE LOWER(email) = LOWER($1)', [bfEmail]);
        assert(lockedVerifRow.rows[0].is_used === true, 'Verification record locked and invalidated');

        console.log('\n====================================================');
        console.log('🎉 ALL 17 EMAIL OTP & AUTH VERIFICATION TESTS PASSED (100%)');
        console.log('====================================================');

    } finally {
        await pool.end();
    }
}

runOtpTests().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
