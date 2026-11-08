/**
 * Comprehensive End-to-End Test Suite for Multi-Payer Expenses in SplitEase
 * 
 * Tests:
 * 1. Single-payer expense creation & balances (Zero regression check)
 * 2. Multi-payer expense creation (Charlie ₹2,000, Bob ₹1,000, Total ₹3,000)
 * 3. Proportional debt allocation & Net balance accuracy
 * 4. Debt simplification with multi-payer expense
 * 5. Multi-payer settlement execution & split clearing
 * 6. Multi-payer expense update (PUT /api/expenses/:id)
 * 7. AI Voice Assistant multi-payer command parsing & execution
 * 8. Cleanup and state hygiene
 */

const http = require('http');
const { Pool } = require('pg');
require('dotenv').config();
const authService = require('./authService');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const BASE_URL = 'http://localhost:5000';

function apiRequest(method, path, data = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                let parsed;
                try {
                    parsed = JSON.parse(body);
                } catch (e) {
                    parsed = body;
                }
                resolve({ status: res.statusCode, data: parsed, headers: res.headers });
            });
        });

        req.on('error', reject);
        if (data) {
            req.write(typeof data === 'string' ? data : JSON.stringify(data));
        }
        req.end();
    });
}

async function runTests() {
    console.log('===============================================================');
    console.log('   STARTING COMPREHENSIVE MULTI-PAYER EXPENSE TEST SUITE       ');
    console.log('===============================================================\n');

    let passedCount = 0;
    let failedCount = 0;

    function assert(condition, message) {
        if (condition) {
            console.log(`  [PASS] ${message}`);
            passedCount++;
        } else {
            console.error(`  [FAIL] ${message}`);
            failedCount++;
        }
    }

    let charlieId = null;
    let bobId = null;
    let aliceId = null;
    let charlieHeaders = {};
    let aliceHeaders = {};
    let testGroupId = null;
    let singlePayerExpId = null;
    let multiPayerExpId = null;

    try {
        // --- PRE-CHECK: Verify Master Admin Charlie ---
        console.log('--- TEST 1: Verifying Master Admin User ---');
        const masterRes = await pool.query("SELECT id, name, email, role FROM users WHERE email = 'nxtcharlie20@gmail.com'");
        assert(masterRes.rows.length === 1, 'Master admin Charlie exists');
        assert(masterRes.rows[0].role === 'master_admin', 'Charlie has master_admin role');
        charlieId = masterRes.rows[0].id;

        const charlieSession = await authService.createSession(charlieId);
        charlieHeaders = { 'Authorization': `Bearer ${charlieSession.token}` };

        // Create temporary test users Bob and Alice
        console.log('\n--- SETUP: Creating Test Users and Test Circle ---');
        const bobRes = await pool.query(`
            INSERT INTO users (name, email, password_hash, default_currency, role)
            VALUES ('Bob TestPayer', 'bob_test_payer@example.com', 'dummy_hash', 'INR', 'user')
            RETURNING id, name
        `);
        bobId = bobRes.rows[0].id;

        const aliceRes = await pool.query(`
            INSERT INTO users (name, email, password_hash, default_currency, role)
            VALUES ('Alice TestPayer', 'alice_test_payer@example.com', 'dummy_hash', 'INR', 'user')
            RETURNING id, name
        `);
        aliceId = aliceRes.rows[0].id;

        const aliceSession = await authService.createSession(aliceId);
        aliceHeaders = { 'Authorization': `Bearer ${aliceSession.token}` };

        // Create test group
        const grpRes = await pool.query(`
            INSERT INTO groups (name, category, created_by, base_currency)
            VALUES ('Multi-Payer Test Trip', 'Trip', $1, 'INR')
            RETURNING id, name
        `, [charlieId]);
        testGroupId = grpRes.rows[0].id;

        // Add members: Charlie (admin), Bob (editor), Alice (member)
        await pool.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'admin')`, [testGroupId, charlieId]);
        await pool.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'editor')`, [testGroupId, bobId]);
        await pool.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')`, [testGroupId, aliceId]);
        console.log(`  Group created: #${testGroupId} with Charlie (#${charlieId}), Bob (#${bobId}), Alice (#${aliceId})`);

        // --- TEST 2: Single-Payer Expense (Zero Regression) ---
        console.log('\n--- TEST 2: Single-Payer Expense Creation (Zero Regression) ---');
        const singlePayerRes = await apiRequest('POST', '/api/expenses', {
            group_id: testGroupId,
            paid_by: charlieId,
            description: 'Single-Payer Lunch',
            amount: 900,
            currency: 'INR',
            split_type: 'equal',
            split_user_ids: [charlieId, bobId, aliceId]
        }, charlieHeaders);

        assert(singlePayerRes.status === 200 || singlePayerRes.status === 201, `Single-payer expense created (HTTP ${singlePayerRes.status})`);
        singlePayerExpId = singlePayerRes.data.id || singlePayerRes.data.expense?.id;
        assert(Boolean(singlePayerExpId), `Expense ID returned: #${singlePayerExpId}`);

        // Verify expense_payers table has 1 record for single-payer
        const singlePayersDb = await pool.query('SELECT * FROM expense_payers WHERE expense_id = $1', [singlePayerExpId]);
        assert(singlePayersDb.rows.length === 1, `expense_payers has exactly 1 row`);
        assert(parseFloat(singlePayersDb.rows[0].amount) === 900, `expense_payers amount is 900.00`);
        assert(singlePayersDb.rows[0].user_id === charlieId, `expense_payers user_id matches Charlie`);

        // Check group balances
        const balSingle = await apiRequest('GET', `/api/groups/${testGroupId}/balances`, null, charlieHeaders);
        assert(balSingle.status === 200, 'Group balances returned 200');
        const charlieNet = balSingle.data.find(b => b.user_id === charlieId)?.net_balance || 0;
        const bobNet = balSingle.data.find(b => b.user_id === bobId)?.net_balance || 0;
        const aliceNet = balSingle.data.find(b => b.user_id === aliceId)?.net_balance || 0;
        assert(Math.abs(charlieNet - 600) < 0.01, `Charlie net is +₹600 (actual: ${charlieNet})`);
        assert(Math.abs(bobNet - (-300)) < 0.01, `Bob net is -₹300 (actual: ${bobNet})`);
        assert(Math.abs(aliceNet - (-300)) < 0.01, `Alice net is -₹300 (actual: ${aliceNet})`);

        // Clean up single-payer expense for pristine multi-payer test
        await pool.query('DELETE FROM expenses WHERE id = $1', [singlePayerExpId]);

        // --- TEST 3: Multi-Payer Expense Creation ---
        console.log('\n--- TEST 3: Multi-Payer Expense Creation ---');
        // Total: ₹3,000. Charlie pays ₹2,000, Bob pays ₹1,000.
        // Split equally 3 ways: Charlie ₹1,000, Bob ₹1,000, Alice ₹1,000.
        const multiPayerRes = await apiRequest('POST', '/api/expenses', {
            group_id: testGroupId,
            paid_by: charlieId, // Primary payer (highest)
            description: 'Multi-Payer Resort Stay',
            amount: 3000,
            currency: 'INR',
            split_type: 'equal',
            split_user_ids: [charlieId, bobId, aliceId],
            payers: [
                { user_id: charlieId, amount: 2000 },
                { user_id: bobId, amount: 1000 }
            ]
        }, charlieHeaders);

        assert(multiPayerRes.status === 200 || multiPayerRes.status === 201, `Multi-payer expense created (HTTP ${multiPayerRes.status})`);
        multiPayerExpId = multiPayerRes.data.id || multiPayerRes.data.expense?.id;
        assert(Boolean(multiPayerExpId), `Multi-payer Expense ID: #${multiPayerExpId}`);

        // Verify expense_payers table
        const multiPayersDb = await pool.query('SELECT * FROM expense_payers WHERE expense_id = $1 ORDER BY amount DESC', [multiPayerExpId]);
        assert(multiPayersDb.rows.length === 2, `expense_payers has 2 rows for multi-payer expense`);
        assert(multiPayersDb.rows[0].user_id === charlieId && parseFloat(multiPayersDb.rows[0].amount) === 2000, 'Payer 1 is Charlie with ₹2,000');
        assert(multiPayersDb.rows[1].user_id === bobId && parseFloat(multiPayersDb.rows[1].amount) === 1000, 'Payer 2 is Bob with ₹1,000');

        // Check GET /api/expenses/:id returns payers metadata
        const getExpRes = await apiRequest('GET', `/api/expenses/${multiPayerExpId}`, null, charlieHeaders);
        assert(getExpRes.status === 200, 'GET /api/expenses/:id returned 200');
        assert(getExpRes.data.is_multi_payer === true, 'Expense flag is_multi_payer is true');
        assert(Array.isArray(getExpRes.data.payers) && getExpRes.data.payers.length === 2, 'payers array returned in expense response');
        assert(typeof getExpRes.data.paid_by_display === 'string' && getExpRes.data.paid_by_display.includes('Charlie'), 'paid_by_display formatted with payer names');

        // --- TEST 4: Mathematical Accuracy of Multi-Payer Balances ---
        console.log('\n--- TEST 4: Proportional Balance & Debt Calculation ---');
        // Expected:
        // Charlie: Paid ₹2,000, owes ₹1,000 -> Net: +₹1,000
        // Bob: Paid ₹1,000, owes ₹1,000 -> Net: ₹0.00
        // Alice: Paid ₹0, owes ₹1,000 -> Net: -₹1,000
        const balMulti = await apiRequest('GET', `/api/groups/${testGroupId}/balances`, null, charlieHeaders);
        const cNet = balMulti.data.find(b => b.user_id === charlieId)?.net_balance || 0;
        const bNet = balMulti.data.find(b => b.user_id === bobId)?.net_balance || 0;
        const aNet = balMulti.data.find(b => b.user_id === aliceId)?.net_balance || 0;

        assert(Math.abs(cNet - 1000) < 0.01, `Charlie net is +₹1,000 (actual: ${cNet})`);
        assert(Math.abs(bNet - 0) < 0.01, `Bob net is ₹0.00 (actual: ${bNet})`);
        assert(Math.abs(aNet - (-1000)) < 0.01, `Alice net is -₹1,000 (actual: ${aNet})`);

        // Check Debt Simplification
        console.log('\n--- TEST 5: Debt Simplification with Multi-Payer ---');
        const simpRes = await apiRequest('GET', `/api/groups/${testGroupId}/simplified-debts`, null, charlieHeaders);
        assert(simpRes.status === 200, 'GET simplified-debts returned 200');
        const debts = simpRes.data.simplified_debts || simpRes.data || [];
        console.log('  Simplified debts:', JSON.stringify(debts));
        // There should be exactly 1 debt transaction: Alice pays Charlie ₹1,000!
        assert(debts.length === 1, `Exactly 1 simplified transaction generated (count: ${debts.length})`);
        if (debts.length > 0) {
            const d = debts[0];
            assert(d.from_user_id === aliceId || d.from === aliceId || d.from_name?.includes('Alice'), 'Debtor is Alice');
            assert(d.to_user_id === charlieId || d.to === charlieId || d.to_name?.includes('Charlie'), 'Creditor is Charlie');
            assert(Math.abs(parseFloat(d.amount) - 1000) < 0.01, 'Amount is exactly ₹1,000');
        }

        // --- TEST 6: Multi-Payer Settlement Execution ---
        console.log('\n--- TEST 6: Settlement Allocation Against Multi-Payer Splits ---');
        // Alice pays Charlie ₹1,000
        const settleRes = await apiRequest('POST', '/api/settlements', {
            group_id: testGroupId,
            payer_id: aliceId,
            receiver_id: charlieId,
            amount: 1000,
            currency: 'INR',
            notes: 'Settling multi-payer resort share'
        }, aliceHeaders);

        assert(settleRes.status === 200 || settleRes.status === 201, `Settlement recorded (HTTP ${settleRes.status})`);

        // Check balances after settlement
        const postSettleBal = await apiRequest('GET', `/api/groups/${testGroupId}/balances`, null, charlieHeaders);
        const postC = postSettleBal.data.find(b => b.user_id === charlieId)?.net_balance || 0;
        const postB = postSettleBal.data.find(b => b.user_id === bobId)?.net_balance || 0;
        const postA = postSettleBal.data.find(b => b.user_id === aliceId)?.net_balance || 0;

        assert(Math.abs(postC) < 0.01, `Charlie net balance is ₹0.00 after settlement (actual: ${postC})`);
        assert(Math.abs(postB) < 0.01, `Bob net balance is ₹0.00 (actual: ${postB})`);
        assert(Math.abs(postA) < 0.01, `Alice net balance is ₹0.00 after settlement (actual: ${postA})`);

        // Clean up settlement and reset for PUT test
        await pool.query('DELETE FROM settlements WHERE group_id = $1', [testGroupId]);
        await pool.query('UPDATE expense_splits SET is_settled = false, settled_amount = 0, settled_amount_base = 0 WHERE expense_id = $1', [multiPayerExpId]);

        // --- TEST 7: Multi-Payer Expense Edit (PUT /api/expenses/:id) ---
        console.log('\n--- TEST 7: Updating Multi-Payer Expense (PUT) ---');
        // Change total to ₹4,500: Charlie ₹3,000, Bob ₹1,500
        const putRes = await apiRequest('PUT', `/api/expenses/${multiPayerExpId}`, {
            group_id: testGroupId,
            paid_by: charlieId,
            description: 'Updated Resort Stay',
            amount: 4500,
            currency: 'INR',
            split_type: 'equal',
            split_user_ids: [charlieId, bobId, aliceId],
            payers: [
                { user_id: charlieId, amount: 3000 },
                { user_id: bobId, amount: 1500 }
            ]
        }, charlieHeaders);

        assert(putRes.status === 200, `Expense updated via PUT (HTTP ${putRes.status})`);
        const putPayersDb = await pool.query('SELECT * FROM expense_payers WHERE expense_id = $1 ORDER BY amount DESC', [multiPayerExpId]);
        assert(putPayersDb.rows.length === 2, `expense_payers has 2 rows after PUT`);
        assert(parseFloat(putPayersDb.rows[0].amount) === 3000, `Charlie updated amount is ₹3,000`);
        assert(parseFloat(putPayersDb.rows[1].amount) === 1500, `Bob updated amount is ₹1,500`);

        // Check updated balances:
        // Total 4500 / 3 = 1500 each.
        // Charlie: +1500 (3000 - 1500)
        // Bob: 0 (1500 - 1500)
        // Alice: -1500 (0 - 1500)
        const putBal = await apiRequest('GET', `/api/groups/${testGroupId}/balances`, null, charlieHeaders);
        const putC = putBal.data.find(b => b.user_id === charlieId)?.net_balance || 0;
        const putA = putBal.data.find(b => b.user_id === aliceId)?.net_balance || 0;
        assert(Math.abs(putC - 1500) < 0.01, `Charlie net after PUT is +₹1,500 (actual: ${putC})`);
        assert(Math.abs(putA - (-1500)) < 0.01, `Alice net after PUT is -₹1,500 (actual: ${putA})`);

        // --- TEST 8: AI Voice Assistant Multi-Payer Command Parsing & Execution ---
        console.log('\n--- TEST 8: AI Voice Assistant Multi-Payer Command Execution ---');
        // Clean up previous expense
        await pool.query('DELETE FROM expenses WHERE id = $1', [multiPayerExpId]);

        const voiceRes = await apiRequest('POST', '/api/chatbot/query', {
            query: 'Add expense of 3000 for dinner in Multi-Payer Test Trip for everyone where Charlie paid 2000 and Bob paid 1000',
            language: 'en'
        }, charlieHeaders);

        console.log('  voiceRes.data:', JSON.stringify(voiceRes.data, null, 2));
        assert(voiceRes.status === 200, `Voice query returned 200`);
        assert(voiceRes.data.action === 'CONFIRM_TOOL', `Action is CONFIRM_TOOL`);
        assert(voiceRes.data.toolCall?.action === 'ADD_EXPENSE', `Tool call is ADD_EXPENSE`);
        const tcParams = voiceRes.data.toolCall?.params || {};
        assert(Array.isArray(tcParams.payers) && tcParams.payers.length === 2, `Voice extracted 2 payers in toolCall`);
        console.log('  Voice payers extracted:', JSON.stringify(tcParams.payers));
        assert(voiceRes.data.reply?.includes('Multiple Payers') || voiceRes.data.toolCall?.summary?.includes('Multi-Payer'), 'Voice reply / summary mentions Multi-Payer');

        // Confirm the action via /api/chatbot/confirm-action
        const confirmRes = await apiRequest('POST', '/api/chatbot/confirm-action', {
            toolCall: voiceRes.data.toolCall
        }, charlieHeaders);

        assert(confirmRes.status === 200, `Action confirmed successfully (HTTP ${confirmRes.status})`);
        const confirmedExpId = confirmRes.data.expenseId || confirmRes.data.result?.expenseId;
        assert(Boolean(confirmedExpId), `Confirmed Expense ID returned: #${confirmedExpId}`);

        // Verify in database
        const voiceDbPayers = await pool.query('SELECT * FROM expense_payers WHERE expense_id = $1 ORDER BY amount DESC', [confirmedExpId]);
        assert(voiceDbPayers.rows.length === 2, `Database recorded 2 payers from voice action`);
        assert(parseFloat(voiceDbPayers.rows[0].amount) === 2000, `Charlie paid ₹2,000 from voice action`);
        assert(parseFloat(voiceDbPayers.rows[1].amount) === 1000, `Bob paid ₹1,000 from voice action`);

        // Clean up confirmed expense
        await pool.query('DELETE FROM expenses WHERE id = $1', [confirmedExpId]);

    } catch (err) {
        console.error('Test execution failed with error:', err);
        failedCount++;
    } finally {
        // --- CLEANUP: Clean up test artifacts ---
        console.log('\n--- CLEANUP: Removing Test Users and Groups ---');
        try {
            if (testGroupId) {
                await pool.query('DELETE FROM activity_logs WHERE group_id = $1', [testGroupId]);
                await pool.query('DELETE FROM group_members WHERE group_id = $1', [testGroupId]);
                await pool.query('DELETE FROM expenses WHERE group_id = $1', [testGroupId]);
                await pool.query('DELETE FROM groups WHERE id = $1', [testGroupId]);
                console.log(`  Cleaned up test group #${testGroupId}`);
            }
            if (bobId) {
                await pool.query('DELETE FROM users WHERE id = $1', [bobId]);
                console.log(`  Cleaned up test user Bob #${bobId}`);
            }
            if (aliceId) {
                await pool.query('DELETE FROM users WHERE id = $1', [aliceId]);
                console.log(`  Cleaned up test user Alice #${aliceId}`);
            }

            // Verify Master User Charlie is pristine
            const masterCheck = await pool.query("SELECT id, name, email, role FROM users WHERE email = 'nxtcharlie20@gmail.com'");
            assert(masterCheck.rows.length === 1 && masterCheck.rows[0].role === 'master_admin', 'Master user Charlie preserved with master_admin role');
        } catch (cleanupErr) {
            console.error('Error during cleanup:', cleanupErr);
        }

        await pool.end();

        console.log('\n===============================================================');
        console.log(`   TEST RUN COMPLETE: ${passedCount} PASSED, ${failedCount} FAILED`);
        console.log('===============================================================');

        if (failedCount > 0) {
            process.exit(1);
        } else {
            process.exit(0);
        }
    }
}

runTests();
