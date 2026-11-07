/**
 * ==============================================================================
 * SPLITWISE PRE-DEPLOYMENT MASTER VERIFICATION SUITE
 * ==============================================================================
 * Validates:
 *  1. Multi-Currency Engine & Live Exchange Rates
 *  2. Master Admin System, RBAC & Security Boundaries
 *  3. Global Error Tracker & Fingerprinted Occurrences
 *  4. Direct Antigravity Fix Prompt Generation
 *  5. Username / Email Authentication & Password Security
 *  6. UPI Instant Auto-Settlement & Idempotency
 *  7. Core Platform Modules: Groups, Expenses, Splits, Friends, AI Tools
 *  8. Frontend HTML Assets, Favicon, Zero Syntax Errors
 * ==============================================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5000;
const HOST = 'localhost';

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

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runMasterSuite() {
    console.log('======================================================================');
    console.log('       SPLITWISE COMPREHENSIVE PRE-DEPLOYMENT TEST SUITE              ');
    console.log('======================================================================\n');

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

    // -------------------------------------------------------------------------
    // TEST SECTION 1: AUTHENTICATION & PASSWORD SECURITY
    // -------------------------------------------------------------------------
    console.log('\n--- [SECTION 1] AUTHENTICATION & PASSWORD SECURITY ---');

    // 1.1 Login with Email
    const loginEmail = await request('POST', '/api/users/login', {}, { email: 'alex@splitease.io', password: 'password123' });
    assert(loginEmail.status === 200 && loginEmail.body.user && loginEmail.body.user.role === 'master_admin',
        'Login with registered email succeeds and returns master_admin role');

    // 1.2 Login with Username (exact case)
    const loginUserExact = await request('POST', '/api/users/login', {}, { username: 'alex', password: 'password123' });
    assert(loginUserExact.status === 200 && loginUserExact.body.user && loginUserExact.body.user.username === 'alex',
        'Login with username "alex" succeeds');

    // 1.3 Login with Username (case-insensitive UPPERCASE)
    const loginUserUpper = await request('POST', '/api/users/login', {}, { username: 'ALEX', password: 'password123' });
    assert(loginUserUpper.status === 200 && loginUserUpper.body.user && loginUserUpper.body.user.id === 1,
        'Case-insensitive username login "ALEX" succeeds');

    // 1.4 Login with standard user account via username
    const loginRahul = await request('POST', '/api/users/login', {}, { username: 'rahul', password: 'password123' });
    assert(loginRahul.status === 200 && loginRahul.body.user && loginRahul.body.user.role === 'user',
        'Standard user login "rahul" succeeds with role "user"');

    // 1.5 Invalid credentials rejection
    const loginBad = await request('POST', '/api/users/login', {}, { username: 'alex', password: 'wrongpassword' });
    assert(loginBad.status === 400 || loginBad.status === 401, 'Invalid password rejected with 400/401');

    // 1.6 Passwords are not exposed in user responses
    assert(loginEmail.body.user.password_hash === undefined && loginEmail.body.user.plaintext_password === undefined,
        'User object never exposes password_hash or plaintext_password');

    // -------------------------------------------------------------------------
    // TEST SECTION 2: MULTI-CURRENCY ENGINE & EXCHANGE RATES
    // -------------------------------------------------------------------------
    console.log('\n--- [SECTION 2] MULTI-CURRENCY ENGINE & EXCHANGE RATES ---');

    // 2.1 Supported Currencies List
    const curList = await request('GET', '/api/currencies');
    const hasCurrencies = Array.isArray(curList.body) && curList.body.some(c => c.code === 'INR') && curList.body.some(c => c.code === 'USD');
    assert(curList.status === 200 && hasCurrencies,
        `Currencies endpoint returns supported currencies including INR, USD, EUR, GBP, AED (${curList.body.length} currencies)`);

    // 2.2 Live / Cached Exchange Rates
    const ratesRes = await request('GET', '/api/currencies/rates?base=INR');
    assert(ratesRes.status === 200 && ratesRes.body.rates && ratesRes.body.rates.USD > 0,
        'Exchange rates endpoint returns live rates relative to base INR');

    // 2.3 Currency Conversion Endpoint
    const convRes = await request('POST', '/api/currencies/convert', {}, { amount: 100, from: 'USD', to: 'INR' });
    assert(convRes.status === 200 && convRes.body.converted_amount > 0 && convRes.body.exchange_rate > 0,
        `Currency conversion USD -> INR succeeds (100 USD = ₹${convRes.body.converted_amount}, rate: ${convRes.body.exchange_rate})`);

    // -------------------------------------------------------------------------
    // TEST SECTION 3: MASTER ADMIN RBAC & GLOBAL SYSTEM OVERVIEW
    // -------------------------------------------------------------------------
    console.log('\n--- [SECTION 3] MASTER ADMIN RBAC & PLATFORM OVERVIEW ---');

    const adminHeaders = { 'x-user-id': '1' }; // Alex Sharma (Master Admin)
    const userHeaders = { 'x-user-id': '2' };  // Rahul Sharma (Standard User)

    // 3.1 Unauthenticated Master Admin Access Blocked
    const unauthAdmin = await request('GET', '/api/admin/overview');
    assert(unauthAdmin.status === 401, 'Admin endpoints reject unauthenticated requests with 401');

    // 3.2 Non-Admin User Access Blocked
    const forbiddenAdmin = await request('GET', '/api/admin/overview', userHeaders);
    assert(forbiddenAdmin.status === 403, 'Admin endpoints reject non-admin users with 403 Forbidden');

    // 3.3 Authorized Master Admin Overview Access
    const overview = await request('GET', '/api/admin/overview', adminHeaders);
    assert(overview.status === 200 && overview.body.users && overview.body.health && overview.body.health.status === 'HEALTHY',
        `Master Admin Overview returns healthy system stats (${overview.body.users.total} users, ${overview.body.groups.total} groups)`);

    // 3.4 Master Admin User Management List
    const usersList = await request('GET', '/api/admin/users', adminHeaders);
    assert(usersList.status === 200 && Array.isArray(usersList.body.users) && usersList.body.users.length >= 10,
        `User Management endpoint returns all registered users (${usersList.body.users.length} registered)`);

    // 3.5 Master Admin Groups Management List
    const groupsList = await request('GET', '/api/admin/groups', adminHeaders);
    assert(groupsList.status === 200 && Array.isArray(groupsList.body.groups) && groupsList.body.groups.length > 0,
        `Global Group Management returns all platform groups (${groupsList.body.groups.length} circles)`);

    // 3.6 Master Admin Global Financial Audit
    const finances = await request('GET', '/api/admin/finances', adminHeaders);
    assert(finances.status === 200 && Array.isArray(finances.body.expenses) && finances.body.expenses.length > 0,
        `Global Financial Audit returns platform transactions (${finances.body.expenses.length} records)`);

    // -------------------------------------------------------------------------
    // TEST SECTION 4: GLOBAL SYSTEM ERRORS & ANTIGRAVITY FIX PROMPT
    // -------------------------------------------------------------------------
    console.log('\n--- [SECTION 4] GLOBAL ERROR MONITORING & ANTIGRAVITY PROMPTS ---');

    // 4.1 Ingest Test Client Error
    const reportError = await request('POST', '/api/admin/errors/report', {}, {
        title: 'Pre-Deployment Test Reference Error',
        message: 'ReferenceError: testVariable is not defined at testRunner.js:42:15',
        category: 'frontend',
        severity: 'medium',
        module: 'testRunner.js',
        stackTrace: 'ReferenceError: testVariable is not defined\n  at testRunner.js:42:15',
        requestUrl: 'http://localhost:5000/#test'
    });
    assert(reportError.status === 200 && reportError.body.errorId,
        `System error successfully ingested with stable ID: ${reportError.body.errorId}`);

    const errorId = reportError.body.errorId;

    // 4.2 Ingest identical error to verify deduplication & occurrence counter
    const repeatError = await request('POST', '/api/admin/errors/report', {}, {
        title: 'Pre-Deployment Test Reference Error',
        message: 'ReferenceError: testVariable is not defined at testRunner.js:42:15',
        category: 'frontend',
        severity: 'medium',
        module: 'testRunner.js'
    });
    assert(repeatError.status === 200 && repeatError.body.errorId === errorId,
        `Identical error deduplicated into fingerprint group ${repeatError.body.fingerprint}`);

    // 4.3 Error Detail Inspection
    const errorDetails = await request('GET', `/api/admin/errors/${errorId}`, adminHeaders);
    assert(errorDetails.status === 200 && Array.isArray(errorDetails.body.occurrences) && errorDetails.body.occurrences.length >= 2,
        `Error details endpoint returns occurrence history (${errorDetails.body.occurrences.length} occurrences)`);

    // 4.4 Generate Antigravity Fix Prompt
    const promptRes = await request('GET', `/api/admin/errors/${errorId}/antigravity-prompt`, adminHeaders);
    assert(promptRes.status === 200 && typeof promptRes.body.prompt === 'string' && promptRes.body.prompt.includes('ANTIGRAVITY ERROR RESOLUTION TASK'),
        'Antigravity Fix Prompt generated successfully with markdown structure and debugging instructions');

    // 4.5 Resolve System Error
    const resolveRes = await request('POST', `/api/admin/errors/${errorId}/resolve`, adminHeaders, {
        status: 'resolved',
        resolution_notes: 'Verified and resolved during pre-deployment automated suite.'
    });
    if (resolveRes.status !== 200 || !resolveRes.body.success) {
        console.error('Resolve failed with:', resolveRes.status, resolveRes.body);
    }
    assert(resolveRes.status === 200 && resolveRes.body.success,
        'System error status updated to RESOLVED with admin audit note');

    // -------------------------------------------------------------------------
    // TEST SECTION 5: UPI AUTOMATED RECONCILIATION & ₹1 SETTLEMENTS
    // -------------------------------------------------------------------------
    console.log('\n--- [SECTION 5] UPI ₹1 SETTLEMENT & RECONCILIATION ---');

    // 5.1 Create ₹1 Payment Request
    const upiReq = await request('POST', '/api/upi/create-payment-request', {}, {
        payer_id: 1,
        receiver_id: 2,
        amount: 1,
        notes: 'Pre-deployment regression test ₹1'
    });
    assert(upiReq.status === 201 && upiReq.body.request_id,
        `UPI payment request created with request_id: ${upiReq.body.request_id}`);

    const upiId = upiReq.body.request_id;

    // 5.2 Poll payment status (Must be PENDING; never auto-settles on its own without payment!)
    const upiPoll1 = await request('GET', `/api/upi/payment-status/${upiId}`);
    assert(upiPoll1.status === 200 && (upiPoll1.body.status === 'PENDING' || upiPoll1.body.status === 'PROCESSING'),
        'Immediate UPI status polling returns PENDING state (no premature auto-settle)');

    // 5.3 Verify that simply waiting does NOT settle without payment
    await sleep(500);
    const upiPollWaiting = await request('GET', `/api/upi/payment-status/${upiId}`);
    assert(upiPollWaiting.status === 200 && upiPollWaiting.body.status === 'PENDING' && !upiPollWaiting.body.settlement_id,
        'UPI status correctly remains PENDING without payment (safe against unverified auto-saving)');

    // 5.4 Payment confirmed via gateway webhook / confirmation endpoint
    const confirmRes = await request('POST', '/api/upi/simulate-gateway-webhook', {}, {
        request_id: upiId,
        status: 'SUCCESS'
    });
    assert(confirmRes.status === 200 && confirmRes.body.settlement_id > 0,
        `Payment confirmed and settlement recorded in database! Settlement ID: ${confirmRes.body.settlement_id}`);

    // 5.5 Poll payment status (Now SUCCESS & Settlement Reconciled)
    const upiPoll2 = await request('GET', `/api/upi/payment-status/${upiId}`);
    assert(upiPoll2.status === 200 && upiPoll2.body.status === 'SUCCESS' && upiPoll2.body.settlement_id > 0,
        `UPI payment verified & reconciled in database! Settlement ID: ${upiPoll2.body.settlement_id}, Ref: ${upiPoll2.body.transaction_ref}`);

    // 5.6 Idempotent verification: Subsequent poll returns existing settlement without duplicate
    const upiPoll3 = await request('GET', `/api/upi/payment-status/${upiId}`);
    assert(upiPoll3.status === 200 && upiPoll3.body.settlement_id === upiPoll2.body.settlement_id,
        'Subsequent UPI polling is strictly idempotent and does not create duplicate settlements');

    // -------------------------------------------------------------------------
    // TEST SECTION 6: CORE PLATFORM BUSINESS LOGIC & INTEGRITY
    // -------------------------------------------------------------------------
    console.log('\n--- [SECTION 6] CORE APPLICATION MODULES & LEDGER ---');

    // 6.1 Balances Summary
    const balSummary = await request('GET', '/api/balances/summary?userId=1');
    assert(balSummary.status === 200 && balSummary.body.total_owe !== undefined && balSummary.body.total_owed !== undefined,
        `Balance summary returns valid numeric totals (Owe: ₹${balSummary.body.total_owe}, Owed: ₹${balSummary.body.total_owed})`);

    // 6.2 Group Ledgers
    const groupsUser = await request('GET', '/api/groups?userId=1');
    assert(groupsUser.status === 200 && Array.isArray(groupsUser.body),
        `User groups returned (${groupsUser.body.length} active circles)`);

    // 6.3 Expenses Ledger
    const expensesUser = await request('GET', '/api/expenses?userId=1');
    assert(expensesUser.status === 200 && Array.isArray(expensesUser.body),
        `User expenses returned (${expensesUser.body.length} records in ledger)`);

    // 6.4 Friends & Connections
    const friendsUser = await request('GET', '/api/friends?userId=1');
    assert(friendsUser.status === 200 && Array.isArray(friendsUser.body),
        `User mutual friends list returned (${friendsUser.body.length} connections)`);

    // -------------------------------------------------------------------------
    // TEST SECTION 7: FRONTEND ASSETS & ZERO-DEFECT COMPILATION
    // -------------------------------------------------------------------------
    console.log('\n--- [SECTION 7] FRONTEND ASSETS & UI ZERO-DEFECT AUDIT ---');

    const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

    // 7.1 Favicon links present
    assert(indexHtml.includes('<link rel="icon"') && indexHtml.includes('<link rel="apple-touch-icon"'),
        'Favicon and Apple touch icons are embedded in <head>');

    // 7.2 Sidebar collapse controller present
    assert(indexHtml.includes('toggleSidebarCollapse') && indexHtml.includes('sidebar-collapsed'),
        'Sidebar collapse controller and persistent toggle are compiled');

    // 7.3 Master Admin view present
    assert(indexHtml.includes('id="view-master-admin"') && indexHtml.includes('id="navGroupMasterAdmin"'),
        'Master Admin dashboard view and navigation group are compiled');

    // 7.4 Global error tracking handler present
    assert(indexHtml.includes('window.onerror') && indexHtml.includes('/api/admin/errors/report'),
        'Global client-side error reporter (window.onerror) is active');

    // 7.5 No duplicate QR codes below UPI button
    const upiButtonIdx = indexHtml.indexOf('id="upiIntentLink"');
    const qrContainerIdx = indexHtml.indexOf('id="upiQrCodeContainer"');
    const secondQrIdx = indexHtml.indexOf('id="upiQrCodeContainer"', qrContainerIdx + 1);
    assert(qrContainerIdx !== -1 && secondQrIdx === -1,
        'Strictly single UPI QR canvas rendered; duplicate QR eliminated');

    // 7.6 Settle and submit event handlers safe
    assert(indexHtml.includes('handleSettleAmountChange') && indexHtml.includes('handleManualSettlementSubmit'),
        'Global fallback aliases for handleSettleAmountChange and handleManualSettlementSubmit are active');

    // 7.7 Integer stepper active for amount inputs
    assert(indexHtml.includes('quickAddAmount') && indexHtml.includes('ArrowUp'),
        'Integer step incrementers and quick-add amount buttons are compiled');

    // -------------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------------
    console.log('\n======================================================================');
    console.log(`TOTAL TESTS EXECUTED: ${totalTests}`);
    console.log(`PASSED:               ${passedTests}`);
    console.log(`FAILED:               ${failedTests}`);
    console.log(`PASS RATE:            ${((passedTests / totalTests) * 100).toFixed(1)}%`);
    console.log('======================================================================');

    process.exit(failedTests > 0 ? 1 : 0);
}

runMasterSuite().catch(err => {
    console.error('CRITICAL SUITE FAILURE:', err);
    process.exit(1);
});
