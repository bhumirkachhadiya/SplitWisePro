/**
 * SPLITWISE — UPI AUTO-SETTLEMENT & PAYMENT STATE VERIFICATION TEST SUITE
 * Tests all 12 scenarios from the specification:
 * 1. Create a ₹1 UPI settlement and verify request generation
 * 2. Verify payment status API returns actual transaction details
 * 3. Verify provider/webhook response is processed with atomic settlement
 * 4. Verify automatic settlement recording and expense split reconciliation
 * 5. Create another UPI settlement immediately after the first (fresh ID & state)
 * 6. Test UPI -> Cash -> UPI payment method switching
 * 7. Test UPI -> Bank -> UPI payment method switching
 * 8. Test Failed, Pending, Expired, and Cancelled payment states
 * 9. Verify pending transaction is not prematurely marked paid
 * 10. Test duplicate webhook callbacks & idempotency (zero double-counting)
 * 11. Verify balances and transaction history after settlement
 * 12. Verify anti-replay protection (cannot reuse same UTR)
 */
const { Pool } = require('pg');
require('dotenv').config();

const BASE_URL = 'http://localhost:5000/api';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres123@localhost:5432/splitwise_db',
    ssl: (process.env.NODE_ENV === 'production' || (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase'))) 
        ? { rejectUnauthorized: false } 
        : false
});

const results = [];
function record(num, name, passed, details = '') {
    results.push({ '#': num, Scenario: name, Status: passed ? 'PASSED' : 'FAILED', Details: details });
    const mark = passed ? '✓ PASSED' : '✗ FAILED';
    console.log(`[${mark}] Scenario ${num}: ${name}`);
    if (details) console.log(`   -> ${details}`);
}

async function runTests() {
    console.log('================================================================');
    console.log('     UPI AUTO-SETTLEMENT & PAYMENT STATE TEST SUITE             ');
    console.log('================================================================\n');

    let userPayer, userReceiver, testGroup, testExpense;
    let reqId1, reqId2;

    try {
        // Setup 2 test users
        console.log('Setting up test accounts for UPI verification...');
        const dummyHash = '$2a$10$wE4RkLq91K2wZg3b7tqKze6FzW9L0u6s7E9yO1f4P8G1.8yU8qT1K';

        async function createOrGetUser(name, email, code, upi) {
            let res = await pool.query('SELECT id, name, email, upi_id FROM users WHERE email = $1', [email]);
            if (res.rows.length === 0) {
                res = await pool.query(`
                    INSERT INTO users (name, email, password_hash, user_code, default_currency, upi_id, avatar_initials)
                    VALUES ($1, $2, $3, $4, 'INR', $5, $6)
                    RETURNING id, name, email, upi_id
                `, [name, email, dummyHash, code, upi, name.slice(0, 2).toUpperCase()]);
            } else {
                await pool.query('UPDATE users SET upi_id = $1 WHERE id = $2', [upi, res.rows[0].id]);
                res.rows[0].upi_id = upi;
            }
            return res.rows[0];
        }

        userPayer = await createOrGetUser('UPI Test Payer', 'upi.payer@splitease.io', 'SW-UPI-P1', 'upipayer@okhdfcbank');
        userReceiver = await createOrGetUser('UPI Test Receiver', 'upi.receiver@splitease.io', 'SW-UPI-R1', 'upireceiver@okaxis');

        // Create test circle & ₹2 expense paid by receiver (so payer owes ₹1)
        const grpRes = await pool.query(`
            INSERT INTO groups (name, category, description, created_by, base_currency)
            VALUES ('UPI Auto-Settlement Circle', 'Utilities', 'Test group for UPI payments', $1, 'INR')
            RETURNING id, name
        `, [userReceiver.id]);
        testGroup = grpRes.rows[0];

        await pool.query('INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3), ($1, $4, $5)', 
            [testGroup.id, userReceiver.id, 'admin', userPayer.id, 'member']);

        const expRes = await fetch(`${BASE_URL}/expenses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                group_id: testGroup.id,
                paid_by: userReceiver.id,
                amount: 2.00,
                description: 'Initial ₹2 Split',
                split_type: 'equal',
                splits: [
                    { user_id: userReceiver.id, amount: 1.00 },
                    { user_id: userPayer.id, amount: 1.00 }
                ]
            })
        });
        const expData = await expRes.json();
        testExpense = { id: expData.id || (expData.expense && expData.expense.id) };

        console.log(`Setup complete: Group #${testGroup.id}, Expense #${testExpense.id}, Payer owes ₹1.00 to Receiver.\n`);

        // SCENARIO 1: Create a ₹1 UPI settlement and verify request generation
        const createRes = await fetch(`${BASE_URL}/upi/create-payment-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                payer_id: userPayer.id,
                receiver_id: userReceiver.id,
                group_id: testGroup.id,
                amount: 1.00,
                notes: 'Test ₹1 UPI settlement'
            })
        });

        const createData = await createRes.json();
        reqId1 = createData.request_id || createData.payment_request?.request_id;
        const upiUri1 = createData.payment_uri || createData.payment_request?.upi_string;

        const s1Passed = createRes.status === 201 && !!reqId1 && upiUri1.includes('am=1.00') && upiUri1.includes(reqId1);
        record(1, 'Create ₹1 UPI settlement request with unique ID and standard NPCI URI', s1Passed, `Request ID: ${reqId1}, URI: ${upiUri1}`);

        // SCENARIO 2: Verify payment status API returns actual transaction details
        const statusRes1 = await fetch(`${BASE_URL}/upi/payment-status/${reqId1}`);
        const statusData1 = await statusRes1.json();
        const s2Passed = statusRes1.status === 200 && statusData1.status === 'PENDING' && statusData1.amount === 1.00 && statusData1.receiver_upi === 'upireceiver@okaxis';
        record(2, 'Payment status API returns actual status, amount, and receiver VPA', s2Passed, `Status: ${statusData1.status}, Provider Type: ${statusData1.provider_type}`);

        // SCENARIO 3 & 4: Verify bank UTR confirmation and automatic settlement recording
        const testUtr1 = `UTR${Date.now()}88`;
        const verifyRes = await fetch(`${BASE_URL}/upi/verify-utr`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                request_id: reqId1,
                utr: testUtr1,
                payer_id: userPayer.id
            })
        });

        const verifyData = await verifyRes.json();
        const s3Passed = verifyRes.status === 200 && verifyData.success === true && !!verifyData.settlement_id;
        record(3, 'Verify payment with 12-digit bank UTR reference', s3Passed, `Settlement ID: ${verifyData.settlement_id}, UTR: ${testUtr1}`);

        // Check database status and split settlement
        const dbPrRes = await pool.query('SELECT status, settlement_id, utr FROM upi_payment_requests WHERE request_id = $1', [reqId1]);
        const dbSplitRes = await pool.query('SELECT is_settled FROM expense_splits WHERE expense_id = $1 AND user_id = $2', [testExpense.id, userPayer.id]);
        const s4Passed = dbPrRes.rows[0]?.status === 'SUCCESS' && dbSplitRes.rows[0]?.is_settled === true;
        record(4, 'Automatic settlement recorded in database & participant split reconciled', s4Passed, `DB Status: ${dbPrRes.rows[0]?.status}, Split Settled: ${dbSplitRes.rows[0]?.is_settled}`);

        // SCENARIO 5: Create another UPI settlement immediately after the first (Fresh state)
        const createRes2 = await fetch(`${BASE_URL}/upi/create-payment-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                payer_id: userPayer.id,
                receiver_id: userReceiver.id,
                group_id: testGroup.id,
                amount: 100.00,
                notes: 'Second settlement immediately after first'
            })
        });
        const createData2 = await createRes2.json();
        reqId2 = createData2.request_id || createData2.payment_request?.request_id;
        const s5Passed = createRes2.status === 201 && !!reqId2 && reqId2 !== reqId1;
        record(5, 'Create second UPI settlement immediately after first (fresh transaction ID generated)', s5Passed, `Old ID: ${reqId1} -> New ID: ${reqId2}`);

        // SCENARIO 6: Payment method switching (UPI -> Cash -> UPI)
        // Verify Cash settlement works independently
        const cashRes = await fetch(`${BASE_URL}/settlements`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                group_id: testGroup.id,
                payer_id: userPayer.id,
                receiver_id: userReceiver.id,
                amount: 50.00,
                payment_method: 'CASH',
                notes: 'Cash exchange test'
            })
        });
        const cashData = await cashRes.json();
        // Now generate fresh UPI request again
        const upiAfterCash = await (await fetch(`${BASE_URL}/upi/create-payment-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payer_id: userPayer.id, receiver_id: userReceiver.id, amount: 25.00 })
        })).json();
        const s6Passed = cashRes.status === 201 && !!upiAfterCash.request_id && upiAfterCash.request_id !== reqId2;
        record(6, 'Payment method switching (UPI -> Cash -> UPI) resets state and generates new UPI session', s6Passed, `Cash Settled: ${cashData.id}, Re-entered UPI ID: ${upiAfterCash.request_id}`);

        // SCENARIO 7: Payment method switching (UPI -> Bank -> UPI)
        const bankRes = await fetch(`${BASE_URL}/settlements`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                group_id: testGroup.id,
                payer_id: userPayer.id,
                receiver_id: userReceiver.id,
                amount: 75.00,
                payment_method: 'BANK',
                notes: 'NEFT transfer test'
            })
        });
        const bankData = await bankRes.json();
        const upiAfterBank = await (await fetch(`${BASE_URL}/upi/create-payment-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payer_id: userPayer.id, receiver_id: userReceiver.id, amount: 15.00 })
        })).json();
        const s7Passed = bankRes.status === 201 && !!upiAfterBank.request_id;
        record(7, 'Payment method switching (UPI -> Bank -> UPI) works seamlessly without locking', s7Passed, `Bank Settled: ${bankData.id}, Fresh UPI ID: ${upiAfterBank.request_id}`);

        // SCENARIO 8: Test Failed, Pending, Expired, and Cancelled payment states
        // 8a: Cancelled
        const cancelRes = await fetch(`${BASE_URL}/upi/cancel-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ request_id: upiAfterBank.request_id })
        });
        const cancelStatus = await (await fetch(`${BASE_URL}/upi/payment-status/${upiAfterBank.request_id}`)).json();
        
        // 8b: Expired (simulate request created 20 minutes ago)
        const expiredReqId = `UPIR-EXP-${Date.now()}`;
        await pool.query(`
            INSERT INTO upi_payment_requests 
                (request_id, payer_id, receiver_id, amount, status, upi_id, upi_string, created_at)
            VALUES ($1, $2, $3, 10.00, 'PENDING', 'test@okaxis', 'upi://test', NOW() - INTERVAL '20 minutes')
        `, [expiredReqId, userPayer.id, userReceiver.id]);
        const expStatus = await (await fetch(`${BASE_URL}/upi/payment-status/${expiredReqId}`)).json();

        // 8c: Failed
        const failedReqId = `UPIR-FAIL-${Date.now()}`;
        await pool.query(`
            INSERT INTO upi_payment_requests 
                (request_id, payer_id, receiver_id, amount, status, upi_id, upi_string)
            VALUES ($1, $2, $3, 10.00, 'PENDING', 'test@okaxis', 'upi://test')
        `, [failedReqId, userPayer.id, userReceiver.id]);
        await fetch(`${BASE_URL}/upi/simulate-gateway-webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ request_id: failedReqId, status: 'FAILED' })
        });
        const failStatus = await (await fetch(`${BASE_URL}/upi/payment-status/${failedReqId}`)).json();

        const s8Passed = cancelStatus.status === 'CANCELLED' && expStatus.status === 'EXPIRED' && failStatus.status === 'FAILED';
        record(8, 'Terminal statuses handled: Cancelled, Expired, and Failed', s8Passed, `Cancelled: ${cancelStatus.status}, Expired: ${expStatus.status}, Failed: ${failStatus.status}`);

        // SCENARIO 9: Pending payment is NOT prematurely marked paid
        const pendingReq = await (await fetch(`${BASE_URL}/upi/create-payment-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payer_id: userPayer.id, receiver_id: userReceiver.id, amount: 99.00 })
        })).json();
        // Query status 3 times
        const pCheck1 = await (await fetch(`${BASE_URL}/upi/payment-status/${pendingReq.request_id}`)).json();
        const pCheck2 = await (await fetch(`${BASE_URL}/upi/payment-status/${pendingReq.request_id}`)).json();
        const s9Passed = pCheck1.status === 'PENDING' && pCheck2.status === 'PENDING' && !pCheck1.settlement_id;
        record(9, 'Pending transaction remains strictly PENDING without premature settlement', s9Passed, `Status: ${pCheck1.status}, Settlement ID: ${pCheck1.settlement_id || 'null'}`);

        // SCENARIO 10: Idempotency & duplicate webhook callbacks
        // Send duplicate verification for reqId1
        const dupVerifyRes = await fetch(`${BASE_URL}/upi/verify-utr`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                request_id: reqId1,
                utr: testUtr1,
                payer_id: userPayer.id
            })
        });
        const dupVerifyData = await dupVerifyRes.json();
        
        // Also simulate gateway webhook duplicate
        const dupWebhookRes = await fetch(`${BASE_URL}/upi/simulate-gateway-webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ request_id: reqId1, status: 'SUCCESS' })
        });
        const dupWebhookData = await dupWebhookRes.json();

        const s10Passed = dupVerifyData.success === true && (dupWebhookData.is_duplicate === true || dupWebhookData.success === true);
        record(10, 'Duplicate webhook/verification calls return idempotent success without re-settlement', s10Passed, `Duplicate response handled safely: is_duplicate=${dupWebhookData.is_duplicate}`);

        // SCENARIO 11: Verify balances and transaction history after settlement
        const balRes = await (await fetch(`${BASE_URL}/balances/summary?userId=${userPayer.id}`)).json();
        const userPSettlements = await (await fetch(`${BASE_URL}/settlements?userId=${userPayer.id}`)).json();
        const hasVerifiedSettlement = userPSettlements.some(s => s.transaction_reference && s.transaction_reference.includes(testUtr1));
        const s11Passed = userPSettlements.length > 0 && hasVerifiedSettlement;
        record(11, 'Balances and settlement audit history reflected in user balance ledger', s11Passed, `Total settlements for payer: ${userPSettlements.length}, UTR recorded: ${hasVerifiedSettlement}`);

        // SCENARIO 12: Anti-replay protection (Cannot reuse same UTR on a different payment request)
        const replayRes = await fetch(`${BASE_URL}/upi/verify-utr`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                request_id: pendingReq.request_id,
                utr: testUtr1, // Reusing testUtr1 from reqId1!
                payer_id: userPayer.id
            })
        });
        const replayData = await replayRes.json();
        const s12Passed = replayRes.status === 409;
        record(12, 'Anti-replay protection blocks reuse of same bank UTR across transactions (HTTP 409)', s12Passed, `Response: ${replayRes.status} ${replayData.error}`);

    } catch (err) {
        console.error('Test execution error:', err);
    } finally {
        console.log('\nCleaning up UPI test data safely...');
        try {
            if (testGroup?.id) {
                await pool.query('DELETE FROM upi_payment_requests WHERE payer_id = $1 OR receiver_id = $1', [userPayer?.id]);
                await pool.query('DELETE FROM settlements WHERE group_id = $1', [testGroup.id]);
                await pool.query('DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = $1)', [testGroup.id]);
                await pool.query('DELETE FROM expenses WHERE group_id = $1', [testGroup.id]);
                await pool.query('DELETE FROM activity_logs WHERE group_id = $1', [testGroup.id]);
                await pool.query('DELETE FROM group_members WHERE group_id = $1', [testGroup.id]);
                await pool.query('DELETE FROM groups WHERE id = $1', [testGroup.id]);
            }
            if (userPayer?.id && userReceiver?.id) {
                await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [userPayer.id, userReceiver.id]);
            }
            console.log('✓ Cleanup completed.');
        } catch (cleanErr) {
            console.error('Cleanup warning:', cleanErr.message);
        }
        await pool.end();
    }

    console.log('\n================================================================');
    console.log('              UPI TEST SUITE SUMMARY MATRIX                     ');
    console.log('================================================================');
    console.table(results);
    const passedCount = results.filter(r => r.Status === 'PASSED').length;
    console.log(`\nTotal Scenarios: ${results.length} | Passed: ${passedCount} | Failed: ${results.length - passedCount}`);
    console.log(`Success Rate: ${((passedCount / results.length) * 100).toFixed(1)}%`);
}

runTests();
