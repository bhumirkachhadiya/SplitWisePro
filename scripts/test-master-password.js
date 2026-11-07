/**
 * ==============================================================================
 * MASTER PASSWORD AUTHENTICATION & SECURITY AUDIT TEST SUITE
 * ==============================================================================
 * Tests:
 *  1. Normal user login with their original credentials
 *  2. Master Password login to User A (Rahul Sharma)
 *  3. Master Password login to User B (Priya Patel)
 *  4. Verify separate user identities, permissions, and sessions loaded
 *  5. Verify original passwords and password hashes in users table remain unchanged
 *  6. Verify audit records in master_password_audit table
 *  7. Master Admin configuration API (GET config, step-up authorized POST update)
 *  8. Verify new master password works and old master password is invalidated
 *  9. Verify account suspension/deactivation guard (403 Forbidden)
 *  10. Verify rate limiting / lockout protections (429 status)
 *  11. Verify rejection in Production / Staging environments
 * ==============================================================================
 */

const http = require('http');
const { Pool } = require('pg');
require('dotenv').config();

const PORT = 5000;
const HOST = 'localhost';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

function request(method, pathUrl, headers = {}, body = null) {
    return new Promise((resolve, reject) => {
        const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
        const reqHeaders = { ...headers };
        if (payload) {
            reqHeaders['Content-Type'] = 'application/json';
            reqHeaders['Content-Length'] = Buffer.byteLength(payload);
        }

        const req = http.request({
            hostname: HOST,
            port: PORT,
            path: pathUrl,
            method,
            headers: reqHeaders
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    parsed = data;
                }
                resolve({ status: res.statusCode, headers: res.headers, body: parsed });
            });
        });

        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  ✓ PASS: ${message}`);
    } else {
        failedTests++;
        console.error(`  ✗ FAIL: ${message}`);
    }
}

async function runTestSuite() {
    console.log('======================================================================');
    console.log('   SPLITWISE MASTER PASSWORD & SECURITY AUDIT TEST SUITE             ');
    console.log('======================================================================\n');

    // -------------------------------------------------------------------------
    // TEST SECTION 1: MASTER ADMIN LOGIN & BASELINE CREDENTIALS
    // -------------------------------------------------------------------------
    console.log('--- [SECTION 1] MASTER ADMIN & BASELINE DATA ---');

    // Fetch user records directly from DB to preserve hashes for comparison
    const dbUsers = await pool.query('SELECT id, name, email, username, role, password_hash, is_active FROM users ORDER BY id ASC LIMIT 5');
    const adminUser = dbUsers.rows.find(u => u.role === 'master_admin');
    const userRahul = dbUsers.rows.find(u => u.username === 'rahul');
    const userPriya = dbUsers.rows.find(u => u.username === 'priya');

    assert(adminUser && userRahul && userPriya, 'Baseline accounts (Alex, Rahul, Priya) found in database');

    const rahulOriginalHash = userRahul.password_hash;
    const priyaOriginalHash = userPriya.password_hash;

    // -------------------------------------------------------------------------
    // TEST SECTION 2: NORMAL USER LOGIN WITH ORIGINAL PASSWORD
    // -------------------------------------------------------------------------
    console.log('\n--- [SECTION 2] NORMAL USER AUTHENTICATION ---');

    // Login Rahul with normal password
    // First let's check normal login for Rahul
    const normalLoginRes = await request('POST', '/api/users/login', {}, {
        username: 'rahul',
        password: 'password123'
    });

    assert(normalLoginRes.status === 200 && normalLoginRes.body.user && normalLoginRes.body.user.id === userRahul.id,
        `Normal login for Rahul succeeds with original password (User ID: ${normalLoginRes.body.user?.id})`);

    // -------------------------------------------------------------------------
    // TEST SECTION 3: MASTER PASSWORD CONFIGURATION & METADATA
    // -------------------------------------------------------------------------
    console.log('\n--- [SECTION 3] MASTER ADMIN CONFIGURATION APIS ---');

    // 3.1 Unauthenticated request rejected
    const unauthConfig = await request('GET', '/api/admin/master-password/config');
    assert(unauthConfig.status === 401, 'Unauthenticated config request rejected with 401');

    // 3.2 Non-admin user request rejected
    const nonAdminConfig = await request('GET', '/api/admin/master-password/config', {
        'x-user-id': userRahul.id.toString()
    });
    assert(nonAdminConfig.status === 403, 'Non-admin user rejected from master password config with 403 Forbidden');

    // 3.3 Master Admin request succeeds
    const adminConfig = await request('GET', '/api/admin/master-password/config', {
        'x-user-id': adminUser.id.toString()
    });
    assert(adminConfig.status === 200 && adminConfig.body.is_configured === true,
        'Master Admin successfully fetches config (is_configured: true, enabled: true)');
    assert(!adminConfig.body.value_hash && !adminConfig.body.password,
        'Security boundary: Master Password hash and plaintext are NEVER exposed in API responses');

    // -------------------------------------------------------------------------
    // TEST SECTION 4: LOGIN VIA MASTER PASSWORD TO MULTIPLE ACCOUNTS
    // -------------------------------------------------------------------------
    console.log('\n--- [SECTION 4] MASTER PASSWORD AUTHENTICATION ---');

    const defaultMasterPassword = 'SplitWiseMaster@2026';

    // 4.1 Login as User A (Rahul) using Master Password
    const rahulMasterLogin = await request('POST', '/api/users/login', {}, {
        identifier: 'rahul',
        password: defaultMasterPassword
    });

    assert(rahulMasterLogin.status === 200 && rahulMasterLogin.body.user.id === userRahul.id,
        `Master Password login to User A (Rahul) succeeds (Returned User ID: ${rahulMasterLogin.body.user?.id})`);
    assert(rahulMasterLogin.body.user.email === userRahul.email,
        `User A session correctly loaded email: ${rahulMasterLogin.body.user?.email}`);
    assert(!rahulMasterLogin.body.used_master_password && !rahulMasterLogin.body.is_master_auth,
        'Client response is completely neutral with zero disclosure of master password usage');

    // 4.2 Login as User B (Priya) using Master Password
    const priyaMasterLogin = await request('POST', '/api/auth/login', {}, {
        email: 'priya@example.com',
        password: defaultMasterPassword
    });

    assert(priyaMasterLogin.status === 200 && priyaMasterLogin.body.user.id === userPriya.id,
        `Master Password login to User B (Priya) succeeds (Returned User ID: ${priyaMasterLogin.body.user?.id})`);
    assert(priyaMasterLogin.body.user.name === userPriya.name,
        `User B session correctly loaded name: ${priyaMasterLogin.body.user?.name}`);

    // 4.3 Verify User A and User B received distinct, isolated accounts
    assert(rahulMasterLogin.body.user.id !== priyaMasterLogin.body.user.id,
        'Distinct sessions generated: User A ID !== User B ID');

    // -------------------------------------------------------------------------
    // TEST SECTION 5: INTEGRITY OF ORIGINAL PASSWORDS & HASHES
    // -------------------------------------------------------------------------
    console.log('\n--- [SECTION 5] ORIGINAL CREDENTIAL INTEGRITY ---');

    const verifyHashes = await pool.query('SELECT id, password_hash FROM users WHERE id IN ($1, $2)', [userRahul.id, userPriya.id]);
    const rahulCurrentHash = verifyHashes.rows.find(u => u.id === userRahul.id).password_hash;
    const priyaCurrentHash = verifyHashes.rows.find(u => u.id === userPriya.id).password_hash;

    assert(rahulCurrentHash === rahulOriginalHash,
        'User A password_hash in database is 100% UNTOUCHED and identical');
    assert(priyaCurrentHash === priyaOriginalHash,
        'User B password_hash in database is 100% UNTOUCHED and identical');

    // Verify User A can still log in with their original password
    const rahulReLogin = await request('POST', '/api/users/login', {}, {
        username: 'rahul',
        password: 'password123'
    });
    assert(rahulReLogin.status === 200,
        'User A original password continues to authenticate flawlessly');

    // -------------------------------------------------------------------------
    // TEST SECTION 6: MASTER PASSWORD AUDIT TRAIL
    // -------------------------------------------------------------------------
    console.log('\n--- [SECTION 6] AUDIT TRAIL & LOGGING ---');

    const auditRes = await request('GET', '/api/admin/master-password/audit', {
        'x-user-id': adminUser.id.toString()
    });

    assert(auditRes.status === 200 && Array.isArray(auditRes.body),
        `Audit trail fetched successfully (${auditRes.body.length} records)`);

    const latestRahulAudit = auditRes.body.find(a => a.target_user_id === userRahul.id);
    assert(latestRahulAudit && latestRahulAudit.login_method === 'master_password',
        `Audit record logged for Rahul: Target ID=${latestRahulAudit?.target_user_id}, Method=${latestRahulAudit?.login_method}`);
    assert(latestRahulAudit.ip_address && latestRahulAudit.created_at,
        `Audit record contains IP address (${latestRahulAudit?.ip_address}) and timestamp (${latestRahulAudit?.created_at})`);

    const latestPriyaAudit = auditRes.body.find(a => a.target_user_id === userPriya.id);
    assert(latestPriyaAudit && latestPriyaAudit.login_method === 'master_password',
        `Audit record logged for Priya: Target ID=${latestPriyaAudit?.target_user_id}, Method=${latestPriyaAudit?.login_method}`);

    // -------------------------------------------------------------------------
    // TEST SECTION 7: STEP-UP ADMIN UPDATE OF MASTER PASSWORD
    // -------------------------------------------------------------------------
    console.log('\n--- [SECTION 7] MASTER ADMIN CONFIGURATION UPDATE & STEP-UP ---');

    // 7.1 Rejection without Master Admin password
    const updateWithoutAdminPass = await request('POST', '/api/admin/master-password/config', {
        'x-user-id': adminUser.id.toString()
    }, {
        new_master_password: 'NewDevSecret@2026',
        confirm_master_password: 'NewDevSecret@2026',
        admin_password: ''
    });
    assert(updateWithoutAdminPass.status === 400,
        'Configuration update rejected without current Master Admin password verification');

    // 7.2 Rejection with mismatched confirm password
    const updateMismatch = await request('POST', '/api/admin/master-password/config', {
        'x-user-id': adminUser.id.toString()
    }, {
        new_master_password: 'NewDevSecret@2026',
        confirm_master_password: 'DifferentPassword123',
        admin_password: 'password123'
    });
    assert(updateMismatch.status === 400,
        'Configuration update rejected when confirm password does not match');

    // 7.3 Success with valid Master Admin password and matching new master password
    const updateSuccess = await request('POST', '/api/admin/master-password/config', {
        'x-user-id': adminUser.id.toString()
    }, {
        new_master_password: 'UpdatedMaster@999',
        confirm_master_password: 'UpdatedMaster@999',
        admin_password: 'password123',
        enabled: true
    });
    assert(updateSuccess.status === 200 && updateSuccess.body.success === true,
        'Master Password successfully updated via Master Admin API');

    // 7.4 Verify old master password no longer works
    const oldPassLogin = await request('POST', '/api/users/login', {}, {
        username: 'rahul',
        password: defaultMasterPassword
    });
    assert(oldPassLogin.status === 400,
        'Old master password is immediately revoked and rejected with 400');

    // 7.5 Verify new master password works
    const newPassLogin = await request('POST', '/api/users/login', {}, {
        username: 'rahul',
        password: 'UpdatedMaster@999'
    });
    assert(newPassLogin.status === 200 && newPassLogin.body.user.id === userRahul.id,
        'New master password ("UpdatedMaster@999") authenticates successfully');

    // Restore default for ongoing consistency
    await request('POST', '/api/admin/master-password/config', {
        'x-user-id': adminUser.id.toString()
    }, {
        new_master_password: defaultMasterPassword,
        confirm_master_password: defaultMasterPassword,
        admin_password: 'password123',
        enabled: true
    });

    // -------------------------------------------------------------------------
    // TEST SECTION 8: ACCOUNT SUSPENSION & AUTHORIZATION RESTRICTIONS
    // -------------------------------------------------------------------------
    console.log('\n--- [SECTION 8] ACCOUNT SUSPENSION & STATUS GUARD ---');

    // Create a temporary suspended test account
    const testDeactivatedUser = await pool.query(`
        INSERT INTO users (name, email, username, password_hash, is_active)
        VALUES ('Suspended Test User', 'suspended_test@example.com', 'suspended_user', $1, FALSE)
        RETURNING id, username, is_active
    `, [rahulOriginalHash]);

    const suspendedId = testDeactivatedUser.rows[0].id;

    // Attempt login with normal password
    const suspendedNormalLogin = await request('POST', '/api/users/login', {}, {
        username: 'suspended_user',
        password: 'password123'
    });
    assert(suspendedNormalLogin.status === 403,
        'Suspended account rejected with 403 on normal login');

    // Attempt login with Master Password
    const suspendedMasterLogin = await request('POST', '/api/users/login', {}, {
        username: 'suspended_user',
        password: defaultMasterPassword
    });
    assert(suspendedMasterLogin.status === 403,
        'Master Password strictly CANNOT bypass account suspension (Rejected with 403 Forbidden)');

    // Clean up temporary user
    await pool.query('DELETE FROM users WHERE id = $1', [suspendedId]);

    // -------------------------------------------------------------------------
    // TEST SECTION 9: RATE LIMITING & ACCOUNT LOCKOUT
    // -------------------------------------------------------------------------
    console.log('\n--- [SECTION 9] RATE LIMITING & BRUTE FORCE LOCKOUT ---');

    const lockoutTarget = 'lockout_test_target_' + Math.floor(Math.random() * 10000);
    let hitRateLimit = false;
    for (let i = 0; i < 7; i++) {
        const attempt = await request('POST', '/api/users/login', {}, {
            username: lockoutTarget,
            password: 'wrong_password_' + i
        });
        if (attempt.status === 429) {
            hitRateLimit = true;
            break;
        }
    }
    assert(hitRateLimit === true,
        'Brute-force lockout protection active: Repeated failed logins trigger HTTP 429');

    // -------------------------------------------------------------------------
    // TEST SECTION 10: PRODUCTION ENVIRONMENT GATING
    // -------------------------------------------------------------------------
    console.log('\n--- [SECTION 10] ENVIRONMENT GATING & PRODUCTION DISABLING ---');

    const adminService = require('../adminService');
    const originalEnv = process.env.NODE_ENV;

    // 10.1 NODE_ENV = 'production'
    process.env.NODE_ENV = 'production';
    assert(adminService.isMasterPasswordAllowed() === false,
        'adminService.isMasterPasswordAllowed() strictly returns FALSE when NODE_ENV="production"');

    // 10.2 NODE_ENV = 'staging'
    process.env.NODE_ENV = 'staging';
    assert(adminService.isMasterPasswordAllowed() === false,
        'adminService.isMasterPasswordAllowed() strictly returns FALSE when NODE_ENV="staging"');

    // 10.3 APP_ENV = 'production'
    process.env.NODE_ENV = 'development';
    process.env.APP_ENV = 'production';
    assert(adminService.isMasterPasswordAllowed() === false,
        'adminService.isMasterPasswordAllowed() strictly returns FALSE when APP_ENV="production"');

    // 10.4 ASPNETCORE_ENVIRONMENT = 'Production'
    delete process.env.APP_ENV;
    process.env.ASPNETCORE_ENVIRONMENT = 'Production';
    assert(adminService.isMasterPasswordAllowed() === false,
        'adminService.isMasterPasswordAllowed() strictly returns FALSE when ASPNETCORE_ENVIRONMENT="Production"');

    // 10.5 Restore Development
    process.env.NODE_ENV = originalEnv || 'development';
    delete process.env.ASPNETCORE_ENVIRONMENT;
    assert(adminService.isMasterPasswordAllowed() === true,
        'adminService.isMasterPasswordAllowed() correctly returns TRUE in development environment');

    // -------------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------------
    console.log('\n======================================================================');
    console.log(`TOTAL TESTS:  ${totalTests}`);
    console.log(`PASSED:       ${passedTests}`);
    console.log(`FAILED:       ${failedTests}`);
    console.log(`SUCCESS RATE: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
    console.log('======================================================================');

    await pool.end();
    process.exit(failedTests > 0 ? 1 : 0);
}

runTestSuite().catch(async (err) => {
    console.error('CRITICAL TEST RUNNER EXCEPTION:', err);
    await pool.end();
    process.exit(1);
});
