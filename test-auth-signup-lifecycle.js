const http = require('http');
const crypto = require('crypto');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const OTP_SECRET = process.env.OTP_SECRET || 'splitwise-secure-otp-secret-key-2026';

function findOtpFromHash(email, purpose, targetHash) {
    const normalizedEmail = email.trim().toLowerCase();
    for (let i = 100000; i <= 999999; i++) {
        const h = crypto.createHmac('sha256', OTP_SECRET)
            .update(`${normalizedEmail}:${purpose}:${i}`)
            .digest('hex');
        if (h === targetHash) return i.toString();
    }
    return null;
}

function request(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request({
            hostname: 'localhost',
            port: 5000,
            path,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
                ...headers
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch(e) {
                    parsed = data;
                }
                resolve({ status: res.statusCode, body: parsed });
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function runTests() {
    console.log('====================================================');
    console.log('STARTING SPLITWISE AUTH & OTP LIFECYCLE TEST SUITE');
    console.log('====================================================\n');

    const testEmail = `qa_test_${Date.now()}@splitwise.internal`;
    const testPassword = 'Password123!';
    const newPassword = 'NewSecurePassword456!';
    const testName = 'QA Production Test User';
    const testUpi = 'qa_test@okaxis';

    let testResults = [];

    function record(name, passed, detail) {
        testResults.push({ name, passed, detail });
        console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}: ${detail}`);
    }

    try {
        // TEST 1: Request Signup OTP
        console.log('\n--- 1. Testing Signup OTP Dispatch ---');
        const sendOtpRes = await request('POST', '/api/auth/send-signup-otp', {
            name: testName,
            email: testEmail,
            password: testPassword,
            upi_id: testUpi
        });
        record(
            'Signup OTP Request Dispatched',
            sendOtpRes.status === 200 && sendOtpRes.body.success === true,
            `Status: ${sendOtpRes.status}, Message: ${sendOtpRes.body.message}`
        );

        // Fetch OTP hash from database
        const otpRow = await pool.query(
            "SELECT verification_id, otp_hash, expires_at, is_used, attempts FROM public.email_verifications WHERE LOWER(email) = LOWER($1) AND purpose = 'signup' ORDER BY id DESC LIMIT 1",
            [testEmail]
        );
        const storedHash = otpRow.rows[0]?.otp_hash;
        record(
            'OTP Securely Hashed (HMAC-SHA256) in Database',
            Boolean(storedHash && storedHash.length === 64),
            `SHA-256 HMAC: ${storedHash ? storedHash.substring(0, 16) + '...' : 'None'}, No plaintext stored`
        );

        // Solve the OTP from hash for testing
        const otp = findOtpFromHash(testEmail, 'signup', storedHash);
        record(
            'OTP Value Verified as 6-digit number',
            Boolean(otp && otp.length === 6),
            `6-digit OTP code verified`
        );

        // TEST 2: Reject Invalid OTP
        console.log('\n--- 2. Testing Invalid OTP Rejection ---');
        const invalidOtpRes = await request('POST', '/api/auth/verify-signup-otp', {
            email: testEmail,
            otp: '000000'
        });
        record(
            'Invalid OTP Rejection',
            invalidOtpRes.status === 400 && Boolean(invalidOtpRes.body.error),
            `Status: ${invalidOtpRes.status}, Error: ${invalidOtpRes.body.error}`
        );

        // TEST 3: Verify Valid OTP & Create Account
        console.log('\n--- 3. Testing Account Creation via Valid OTP ---');
        const verifyOtpRes = await request('POST', '/api/auth/verify-signup-otp', {
            email: testEmail,
            otp: otp
        });
        record(
            'Valid OTP Account Creation',
            (verifyOtpRes.status === 200 || verifyOtpRes.status === 201) && verifyOtpRes.body.success === true && Boolean(verifyOtpRes.body.user?.auth_id),
            `Status: ${verifyOtpRes.status}, User ID: ${verifyOtpRes.body.user?.id}, Auth ID: ${verifyOtpRes.body.user?.auth_id}`
        );

        // TEST 4: Reject Reusing the Same OTP
        console.log('\n--- 4. Testing OTP Reuse Prevention ---');
        const reuseOtpRes = await request('POST', '/api/auth/verify-signup-otp', {
            email: testEmail,
            otp: otp
        });
        record(
            'OTP Reuse Prevention',
            reuseOtpRes.status === 400 && Boolean(reuseOtpRes.body.error),
            `Status: ${reuseOtpRes.status}, Error: ${reuseOtpRes.body.error}`
        );

        // TEST 5: Verify Supabase Database Records (auth.users, auth.identities, public.profiles, public.users)
        console.log('\n--- 5. Verifying Supabase Database Consistency ---');
        const authUserRow = await pool.query(
            "SELECT id, email, created_at, encrypted_password FROM auth.users WHERE LOWER(email) = LOWER($1)",
            [testEmail]
        );
        record(
            'User Record Exists in auth.users (UUID)',
            authUserRow.rowCount === 1,
            `Found: ${authUserRow.rowCount}, UUID: ${authUserRow.rows[0]?.id}`
        );

        const authIdentityRow = await pool.query(
            "SELECT id, user_id, provider FROM auth.identities WHERE user_id = $1::uuid",
            [authUserRow.rows[0]?.id]
        );
        record(
            'Identity Record Exists in auth.identities',
            authIdentityRow.rowCount >= 1,
            `Found: ${authIdentityRow.rowCount}, Provider: ${authIdentityRow.rows[0]?.provider}`
        );

        const profileRow = await pool.query(
            "SELECT id, email, name, upi_id FROM public.profiles WHERE id = $1::uuid",
            [authUserRow.rows[0]?.id]
        );
        record(
            'Profile Record in public.profiles (Profile ID matches Auth UUID)',
            profileRow.rowCount === 1 && profileRow.rows[0]?.email.toLowerCase() === testEmail.toLowerCase(),
            `Profile ID: ${profileRow.rows[0]?.id}, Name: ${profileRow.rows[0]?.name}, Matches Auth UUID: ${profileRow.rows[0]?.id === authUserRow.rows[0]?.id}`
        );

        const publicUserRow = await pool.query(
            "SELECT id, email, name, auth_id, upi_id FROM public.users WHERE LOWER(email) = LOWER($1)",
            [testEmail]
        );
        record(
            'User Record in public.users (auth_id matches Auth UUID)',
            publicUserRow.rowCount === 1 && publicUserRow.rows[0]?.auth_id === authUserRow.rows[0]?.id,
            `Integer ID: ${publicUserRow.rows[0]?.id}, auth_id: ${publicUserRow.rows[0]?.auth_id}`
        );

        // TEST 6: Reject Duplicate Signup with Same Email
        console.log('\n--- 6. Testing Duplicate Signup Prevention ---');
        const dupSignupRes = await request('POST', '/api/auth/send-signup-otp', {
            name: 'Duplicate Guy',
            email: testEmail,
            password: 'AnyPassword123'
        });
        record(
            'Duplicate Email Signup Rejection (409 Conflict)',
            dupSignupRes.status === 409 && dupSignupRes.body.error.includes('already registered'),
            `Status: ${dupSignupRes.status}, Error: ${dupSignupRes.body.error}`
        );

        // TEST 7: Login with Newly Created User
        console.log('\n--- 7. Testing User Login ---');
        const loginRes = await request('POST', '/api/users/login', {
            email: testEmail,
            password: testPassword
        });
        record(
            'Login with Created Credentials',
            loginRes.status === 200 && Boolean(loginRes.body.user) && loginRes.body.user?.email.toLowerCase() === testEmail.toLowerCase(),
            `Status: ${loginRes.status}, User ID: ${loginRes.body.user?.id}, Profile ID: ${loginRes.body.user?.profile_id}`
        );

        // TEST 8: Forgot Password Flow
        console.log('\n--- 8. Testing Forgot Password Flow ---');
        // Clear recent OTP cooldown for reset
        await pool.query("DELETE FROM public.email_verifications WHERE LOWER(email) = LOWER($1) AND purpose = 'password_reset'", [testEmail]);

        const sendResetOtpRes = await request('POST', '/api/auth/forgot-password-otp', {
            email: testEmail
        });
        record(
            'Forgot Password OTP Request Dispatched',
            sendResetOtpRes.status === 200 && sendResetOtpRes.body.success === true,
            `Status: ${sendResetOtpRes.status}, Message: ${sendResetOtpRes.body.message}`
        );

        const resetOtpRow = await pool.query(
            "SELECT otp_hash, is_used FROM public.email_verifications WHERE LOWER(email) = LOWER($1) AND purpose = 'password_reset' ORDER BY id DESC LIMIT 1",
            [testEmail]
        );
        const resetHash = resetOtpRow.rows[0]?.otp_hash;
        const resetOtp = findOtpFromHash(testEmail, 'password_reset', resetHash);
        record(
            'Password Reset OTP Generated & Hashed in DB',
            Boolean(resetOtp && resetOtp.length === 6),
            `Reset OTP Verified: 6 digits`
        );

        // Verify Reset OTP
        const verifyResetOtpRes = await request('POST', '/api/auth/verify-reset-otp', {
            email: testEmail,
            otp: resetOtp
        });
        record(
            'Verify Password Reset OTP & Receive Reset Token',
            verifyResetOtpRes.status === 200 && verifyResetOtpRes.body.success === true && Boolean(verifyResetOtpRes.body.reset_token),
            `Status: ${verifyResetOtpRes.status}, Reset Token Received: ${Boolean(verifyResetOtpRes.body.reset_token)}`
        );

        // Complete Password Reset
        const completeResetRes = await request('POST', '/api/auth/complete-password-reset', {
            email: testEmail,
            reset_token: verifyResetOtpRes.body.reset_token,
            new_password: newPassword
        });
        record(
            'Complete Password Reset (Updates public.users and auth.users)',
            completeResetRes.status === 200 && completeResetRes.body.success === true,
            `Status: ${completeResetRes.status}, Message: ${completeResetRes.body.message}`
        );

        // Verify Old Password Rejected
        const oldLoginRes = await request('POST', '/api/users/login', {
            email: testEmail,
            password: testPassword
        });
        record(
            'Old Password Rejected After Reset (400/401)',
            (oldLoginRes.status === 400 || oldLoginRes.status === 401) && Boolean(oldLoginRes.body.error),
            `Status: ${oldLoginRes.status}, Error: ${oldLoginRes.body.error}`
        );

        // Verify New Password Accepted
        const newLoginRes = await request('POST', '/api/users/login', {
            email: testEmail,
            password: newPassword
        });
        record(
            'New Password Accepted After Reset',
            newLoginRes.status === 200 && Boolean(newLoginRes.body.user),
            `Status: ${newLoginRes.status}, User ID: ${newLoginRes.body.user?.id}`
        );

        // TEST 9: Clean up test user
        console.log('\n--- 9. Cleaning Up QA Test User ---');
        await pool.query('DELETE FROM public.users WHERE LOWER(email) = LOWER($1)', [testEmail]);
        await pool.query('DELETE FROM auth.users WHERE LOWER(email) = LOWER($1)', [testEmail]);
        await pool.query('DELETE FROM public.email_verifications WHERE LOWER(email) = LOWER($1)', [testEmail]);
        console.log('✓ QA Test user cleaned up cleanly from auth.users, public.profiles, public.users, and email_verifications.');

    } catch(err) {
        console.error('Test Suite Error:', err);
    } finally {
        await pool.end();
        console.log('\n====================================================');
        console.log('AUTH & OTP LIFECYCLE TEST RESULTS:');
        const passCount = testResults.filter(r => r.passed).length;
        console.log(`Passed: ${passCount} / ${testResults.length}`);
        console.log('====================================================');
    }
}

runTests();
