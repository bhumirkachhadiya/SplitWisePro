const { pool } = require('./db');

const API = 'http://localhost:5000/api';
let passed = 0;
let total = 0;

function assert(cond, msg) {
    total++;
    if (!cond) {
        console.error(`  FAIL: ${msg}`);
        throw new Error(msg);
    }
    passed++;
    console.log(`  PASS: ${msg}`);
}

async function runAuthFlowTests() {
    console.log('=============================================================');
    console.log(' STARTING AUTH & EMAIL FLOW AUTOMATED VERIFICATION');
    console.log('=============================================================');

    const testEmail = `authtest_${Date.now()}@example.com`;
    const initialPassword = 'Password123!';
    const updatedPassword = 'NewSecretPassword456!';

    try {
        // -----------------------------------------------------------------
        // STEP 1: SIGNUP FLOW (Send OTP -> Verify OTP -> Create Account)
        // -----------------------------------------------------------------
        console.log('\n[STEP 1] Testing Signup Flow with Email OTP');

        const sendSignupRes = await fetch(`${API}/auth/send-signup-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Auth Test User',
                email: testEmail,
                password: initialPassword,
                phone: '+919988776655',
                upi_id: 'authtest@upi'
            })
        });
        const sendSignupData = await sendSignupRes.json();
        assert(sendSignupRes.ok, `POST /api/auth/send-signup-otp returned 200 (${sendSignupData.message})`);
        assert(Boolean(sendSignupData.verification_id), 'Returned verification_id');

        // Retrieve generated OTP from database verification record for testing
        const verifRow = await pool.query(`
            SELECT id, otp_hash FROM email_verifications 
            WHERE LOWER(email) = LOWER($1) AND purpose = 'signup' AND is_used = FALSE
            ORDER BY created_at DESC LIMIT 1
        `, [testEmail]);
        assert(verifRow.rows.length === 1, 'Verification record found in email_verifications');

        // If dev_otp was returned (when SMTP times out or in dev mode), use it, otherwise match hash
        let signupOtp = sendSignupData.dev_otp;
        const OTP_SECRET = process.env.OTP_SECRET || 'splitwise-secure-otp-secret-key-2026';
        if (!signupOtp) {
            const crypto = require('crypto');
            for (let i = 100000; i <= 999999; i++) {
                const h = crypto.createHmac('sha256', OTP_SECRET)
                    .update(`${testEmail.toLowerCase()}:signup:${i}`)
                    .digest('hex');
                if (h === verifRow.rows[0].otp_hash) {
                    signupOtp = String(i);
                    break;
                }
            }
        }
        assert(Boolean(signupOtp), `Retrieved valid signup OTP: ${signupOtp}`);

        // Verify signup OTP
        const verifySignupRes = await fetch(`${API}/auth/verify-signup-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: testEmail,
                otp: signupOtp,
                verification_id: sendSignupData.verification_id
            })
        });
        const verifySignupData = await verifySignupRes.json();
        assert(verifySignupRes.ok, 'POST /api/auth/verify-signup-otp returned 200');
        assert(Boolean(verifySignupData.user), 'User account created and returned');
        const signupToken = verifySignupData.session_token || verifySignupData.token;
        assert(Boolean(signupToken), 'Session token generated upon signup');
        const createdUserId = verifySignupData.user.id;

        // -----------------------------------------------------------------
        // STEP 2: LOGIN FLOW & SESSION VALIDATION
        // -----------------------------------------------------------------
        console.log('\n[STEP 2] Testing User Login & Session Resolution');

        const loginRes = await fetch(`${API}/users/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: testEmail,
                password: initialPassword
            })
        });
        const loginData = await loginRes.json();
        assert(loginRes.ok, 'POST /api/users/login returned 200');
        const loginToken = loginData.session_token || loginData.token;
        assert(Boolean(loginToken), 'Session token returned on login');

        // Validate session resolution endpoint
        const sessionRes = await fetch(`${API}/auth/session`, {
            headers: { 'Authorization': `Bearer ${loginToken}` }
        });
        const sessionData = await sessionRes.json();
        assert(sessionRes.ok, 'GET /api/auth/session returned 200 with Bearer token');
        assert(sessionData.user.id === createdUserId, 'Session resolves to correct user ID');

        // -----------------------------------------------------------------
        // STEP 3: FORGOT PASSWORD FLOW (Send OTP -> Verify -> Reset Password)
        // -----------------------------------------------------------------
        console.log('\n[STEP 3] Testing Forgot Password OTP & Reset Flow');

        // Need to wait out the 30-sec cooldown between email sends on the same email if needed,
        // or clear recent email verification for password reset test
        await pool.query(`DELETE FROM email_verifications WHERE LOWER(email) = LOWER($1)`, [testEmail]);

        const forgotRes = await fetch(`${API}/auth/forgot-password-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail })
        });
        const forgotData = await forgotRes.json();
        assert(forgotRes.ok, `POST /api/auth/forgot-password-otp returned 200 (${forgotData.message})`);

        // Retrieve reset OTP from database
        const resetRow = await pool.query(`
            SELECT id, otp_hash FROM email_verifications 
            WHERE LOWER(email) = LOWER($1) AND purpose = 'password_reset' AND is_used = FALSE
            ORDER BY created_at DESC LIMIT 1
        `, [testEmail]);
        assert(resetRow.rows.length === 1, 'Password reset verification row found');

        let resetOtp = forgotData.dev_otp;
        if (!resetOtp) {
            const crypto = require('crypto');
            for (let i = 100000; i <= 999999; i++) {
                const h = crypto.createHmac('sha256', OTP_SECRET)
                    .update(`${testEmail.toLowerCase()}:password_reset:${i}`)
                    .digest('hex');
                if (h === resetRow.rows[0].otp_hash) {
                    resetOtp = String(i);
                    break;
                }
            }
        }
        assert(Boolean(resetOtp), `Retrieved valid reset OTP: ${resetOtp}`);

        // Verify Reset OTP
        const verifyResetRes = await fetch(`${API}/auth/verify-reset-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: testEmail,
                otp: resetOtp
            })
        });
        const verifyResetData = await verifyResetRes.json();
        assert(verifyResetRes.ok, 'POST /api/auth/verify-reset-otp returned 200');
        assert(Boolean(verifyResetData.reset_token), 'Received single-use reset_token');

        // Complete Password Reset
        const completeResetRes = await fetch(`${API}/auth/complete-password-reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: testEmail,
                reset_token: verifyResetData.reset_token,
                new_password: updatedPassword
            })
        });
        const completeResetData = await completeResetRes.json();
        assert(completeResetRes.ok, 'POST /api/auth/complete-password-reset returned 200');

        // Verify Old Password Fails
        const oldLoginRes = await fetch(`${API}/users/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, password: initialPassword })
        });
        assert(!oldLoginRes.ok && oldLoginRes.status === 400, 'Old password correctly rejected after reset');

        // Verify New Password Succeeds
        const newLoginRes = await fetch(`${API}/users/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, password: updatedPassword })
        });
        const newLoginData = await newLoginRes.json();
        assert(newLoginRes.ok, 'New password successfully logs in');
        const newTok = newLoginData.session_token || newLoginData.token;
        assert(Boolean(newTok), 'New session token issued for new password login');

        console.log('\n=============================================================');
        console.log(`✓ ALL AUTH & EMAIL FLOW TESTS PASSED: ${passed} / ${total} assertions passed!`);
        console.log('=============================================================');

    } finally {
        // Cleanup test user records
        await pool.query(`DELETE FROM email_verifications WHERE LOWER(email) = LOWER($1)`, [testEmail]);
        await pool.query(`DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE LOWER(email) = LOWER($1))`, [testEmail]);
        await pool.query(`DELETE FROM users WHERE LOWER(email) = LOWER($1)`, [testEmail]);
        await pool.end();
        console.log(`✓ Test artifacts for ${testEmail} cleaned up from database.`);
    }
}

runAuthFlowTests().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
