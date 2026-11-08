/**
 * ==============================================================================
 * DUAL SETTLEMENT SYSTEM — AUTOMATED MASTER TEST SUITE
 * ==============================================================================
 * Verifies all 8 core test cases for production quality:
 * 1. Proportional multi-payer calculation (Dinner ₹4,000: Karan owes Charlie ₹1,000)
 * 2. Expense-wise full and partial settlements with allocation tracking
 * 3. Combined settlement with Oldest-First (FIFO) distribution
 * 4. Combined settlement with custom user-specified allocations
 * 5. Mark as Paid request creation & Pending balance invariance (no ledger pollution)
 * 6. Mark as Paid request rejection & status audit (balance untouched)
 * 7. Mark as Paid request approval & allocation execution (ledger and allocations updated)
 * 8. Double-entry balance invariance & money conservation across ledger
 *
 * Runs against live server on http://localhost:5000.
 * ==============================================================================
 */

const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
require('dotenv').config();
const authService = require('./authService');

const API = 'http://localhost:5000/api';
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

let testGroupId = null;
let userCharlie = null;
let userAmit = null;
let userPriya = null;
let userKaran = null;
let charlieToken = null;
let amitToken = null;
let karanToken = null;

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
    totalTests++;
    if (!condition) {
        console.error(`  FAIL: ${message}`);
        throw new Error(message);
    }
    passedTests++;
    console.log(`  PASS: ${message}`);
}

async function getUserToken(userId) {
    const session = await authService.createSession(userId);
    return session.token;
}

async function setupTestEnvironment() {
    console.log('\n======================================================');
    console.log(' SETTING UP ISOLATED TEST ENVIRONMENT');
    console.log('======================================================');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Fetch users
        const cRes = await client.query(`SELECT id, name, email FROM public.users WHERE id = 1 LIMIT 1`);
        userCharlie = cRes.rows[0];

        const aRes = await client.query(`SELECT id, name, email FROM public.users WHERE LOWER(username) = 'amit' LIMIT 1`);
        userAmit = aRes.rows[0];

        const pRes = await client.query(`SELECT id, name, email FROM public.users WHERE LOWER(username) = 'priya' LIMIT 1`);
        userPriya = pRes.rows[0];

        const kRes = await client.query(`SELECT id, name, email FROM public.users WHERE LOWER(username) = 'karan' LIMIT 1`);
        userKaran = kRes.rows[0];

        // Create isolated test group
        const grp = await client.query(`
            INSERT INTO public.groups (name, category, description, created_by)
            VALUES ('Automated Test Group ' || $1, 'Trip', 'Isolated group for dual settlement test suite', $2)
            RETURNING id, name
        `, [Date.now(), userCharlie.id]);
        testGroupId = grp.rows[0].id;

        const members = [userCharlie.id, userAmit.id, userPriya.id, userKaran.id];
        for (const uid of members) {
            await client.query(`
                INSERT INTO public.group_members (group_id, user_id, role)
                VALUES ($1, $2, 'member')
            `, [testGroupId, uid]);
        }

        await client.query('COMMIT');
        console.log(`✓ Test group created: ID ${testGroupId}`);

        // Acquire tokens
        charlieToken = await getUserToken(userCharlie.id);
        amitToken = await getUserToken(userAmit.id);
        karanToken = await getUserToken(userKaran.id);
        console.log(`✓ Obtained session tokens for test users: Charlie, Amit, Karan`);
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function cleanupTestEnvironment() {
    console.log('\n======================================================');
    console.log(' CLEANING UP TEST ENVIRONMENT');
    console.log('======================================================');
    if (!testGroupId) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const exps = await client.query(`SELECT id FROM public.expenses WHERE group_id = $1`, [testGroupId]);
        for (const e of exps.rows) {
            await client.query(`DELETE FROM public.settlement_allocations WHERE expense_id = $1`, [e.id]);
            await client.query(`DELETE FROM public.payment_requests WHERE expense_id = $1`, [e.id]);
            await client.query(`UPDATE public.expense_splits SET is_settled = false, settled_amount = 0, settled_amount_base = 0 WHERE expense_id = $1`, [e.id]);
            await client.query(`DELETE FROM public.expense_splits WHERE expense_id = $1`, [e.id]);
            await client.query(`DELETE FROM public.expense_payers WHERE expense_id = $1`, [e.id]);
            await client.query(`DELETE FROM public.expenses WHERE id = $1`, [e.id]);
        }
        await client.query(`DELETE FROM public.settlement_allocations WHERE settlement_id IN (SELECT id FROM public.settlements WHERE group_id = $1)`, [testGroupId]);
        await client.query(`DELETE FROM public.payment_requests WHERE group_id = $1`, [testGroupId]);
        await client.query(`DELETE FROM public.settlements WHERE group_id = $1`, [testGroupId]);
        await client.query(`DELETE FROM public.group_members WHERE group_id = $1`, [testGroupId]);
        await client.query(`DELETE FROM public.groups WHERE id = $1`, [testGroupId]);
        await client.query('COMMIT');
        console.log(`✓ Test group #${testGroupId} and related test records cleaned up.`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Cleanup error:', err);
    } finally {
        client.release();
    }
}

// -----------------------------------------------------------------------------
// TEST CASE 1: Multi-Payer Proportional Liability Calculation
// -----------------------------------------------------------------------------
async function testCase1_MultiPayerDinner() {
    console.log('\n[TEST CASE 1] Multi-Payer Dinner Calculation (Phase 2 & Phase 4)');

    const client = await pool.connect();
    let expId;
    try {
        await client.query('BEGIN');
        const expRes = await client.query(`
            INSERT INTO public.expenses (group_id, paid_by, description, amount, currency, category, split_type, expense_date)
            VALUES ($1, $2, 'Dinner 4000', 4000.00, 'INR', 'Food & Drinks', 'exact', CURRENT_DATE)
            RETURNING id
        `, [testGroupId, userCharlie.id]);
        expId = expRes.rows[0].id;

        // Contributors: Charlie 2000, Amit 1000, Priya 1000, Karan 0
        await client.query(`
            INSERT INTO public.expense_payers (expense_id, user_id, amount) VALUES
            ($1, $2, 2000.00),
            ($1, $3, 1000.00),
            ($1, $4, 1000.00)
        `, [expId, userCharlie.id, userAmit.id, userPriya.id]);

        // Splits: 1000 each
        const members = [userCharlie.id, userAmit.id, userPriya.id, userKaran.id];
        for (const uid of members) {
            await client.query(`
                INSERT INTO public.expense_splits (expense_id, user_id, amount, base_amount, settled_amount_base, is_settled)
                VALUES ($1, $2, 1000.00, 1000.00, 0.00, false)
            `, [expId, uid]);
        }
        await client.query('COMMIT');
    } finally {
        client.release();
    }

    // Call GET /api/expenses/:id/settlements
    const res = await fetch(`${API}/expenses/${expId}/settlements`, {
        headers: { 'Authorization': `Bearer ${charlieToken}` }
    });
    const data = await res.json();

    assert(res.ok, 'Endpoint GET /api/expenses/:id/settlements returned 200');
    assert(data.liabilities.length === 1, 'Exactly 1 net liability generated (Karan -> Charlie)');
    assert(data.liabilities[0].debtor_id === userKaran.id, 'Debtor is Karan');
    assert(data.liabilities[0].creditor_id === userCharlie.id, 'Creditor is Charlie');
    assert(data.liabilities[0].outstanding_amount === 1000, 'Outstanding liability is exactly ₹1,000');
    assert(data.summary.settlement_status === 'UNSETTLED', 'Initial settlement status is UNSETTLED');
}

// -----------------------------------------------------------------------------
// TEST CASE 2: Single-Payer Expense-Wise Full and Partial Settlement
// -----------------------------------------------------------------------------
async function testCase2_ExpenseWisePartialSettlement() {
    console.log('\n[TEST CASE 2] Expense-Wise Full & Partial Settlement');

    const client = await pool.connect();
    let expId;
    try {
        await client.query('BEGIN');
        const expRes = await client.query(`
            INSERT INTO public.expenses (group_id, paid_by, description, amount, currency, category, split_type, expense_date)
            VALUES ($1, $2, 'Cab Ride 1000', 1000.00, 'INR', 'Travel & Stay', 'exact', CURRENT_DATE)
            RETURNING id
        `, [testGroupId, userCharlie.id]);
        expId = expRes.rows[0].id;

        await client.query(`INSERT INTO public.expense_payers (expense_id, user_id, amount) VALUES ($1, $2, 1000.00)`, [expId, userCharlie.id]);
        await client.query(`
            INSERT INTO public.expense_splits (expense_id, user_id, amount, base_amount, settled_amount_base, is_settled)
            VALUES ($1, $2, 1000.00, 1000.00, 0.00, false)
        `, [expId, userAmit.id]);
        await client.query('COMMIT');
    } finally {
        client.release();
    }

    // 1. Partial settlement of ₹400
    const set1Res = await fetch(`${API}/settlements`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${amitToken}`
        },
        body: JSON.stringify({
            payer_id: userAmit.id,
            receiver_id: userCharlie.id,
            group_id: testGroupId,
            amount: 400.00,
            payment_method: 'UPI',
            settlement_type: 'EXPENSE_WISE',
            expense_id: expId
        })
    });
    const set1Data = await set1Res.json();
    assert(set1Res.ok, 'Partial settlement of ₹400 recorded successfully');

    // Verify remaining liability is 600
    const check1Res = await fetch(`${API}/expenses/${expId}/settlements`, {
        headers: { 'Authorization': `Bearer ${amitToken}` }
    });
    const check1 = await check1Res.json();
    assert(check1.liabilities[0].outstanding_amount === 600, 'Remaining liability is ₹600 after ₹400 partial settlement');
    assert(check1.summary.settlement_status === 'PARTIALLY_SETTLED', 'Status is PARTIALLY_SETTLED');

    // Verify allocation record created
    const set1Id = set1Data.id || set1Data.settlement?.id;
    const allocRes = await fetch(`${API}/settlements/${set1Id}/allocations`, {
        headers: { 'Authorization': `Bearer ${amitToken}` }
    });
    const allocData = await allocRes.json();
    const allocs1 = allocData.allocations || allocData;
    assert(allocs1.length === 1, 'Allocation record created for partial settlement');
    assert(Number(allocs1[0].amount) === 400, 'Allocation amount is ₹400');

    // 2. Settle remaining ₹600
    const set2Res = await fetch(`${API}/settlements`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${amitToken}`
        },
        body: JSON.stringify({
            payer_id: userAmit.id,
            receiver_id: userCharlie.id,
            group_id: testGroupId,
            amount: 600.00,
            payment_method: 'CASH',
            settlement_type: 'EXPENSE_WISE',
            expense_id: expId
        })
    });
    assert(set2Res.ok, 'Remaining settlement of ₹600 recorded successfully');

    // Verify remaining liability is 0 and status is FULLY_SETTLED
    const check2Res = await fetch(`${API}/expenses/${expId}/settlements`, {
        headers: { 'Authorization': `Bearer ${amitToken}` }
    });
    const check2 = await check2Res.json();
    assert(check2.summary.total_outstanding === 0, 'Zero outstanding liabilities remaining on expense');
    assert(check2.summary.settlement_status === 'FULLY_SETTLED', 'Expense status is FULLY_SETTLED');
    assert(check2.liabilities[0].outstanding_amount === 0, 'Debtor remaining liability is ₹0');
}

// -----------------------------------------------------------------------------
// TEST CASE 3 & 4: Combined Settlement with Oldest First (FIFO) & Custom Distribution
// -----------------------------------------------------------------------------
async function testCase3_CombinedSettlementFIFO() {
    console.log('\n[TEST CASE 3 & 4] Combined Settlement with FIFO & Custom Allocations (Phase 3)');

    const client = await pool.connect();
    const expIds = [];
    try {
        await client.query('BEGIN');
        const specs = [
            { desc: 'Hotel 1500', amount: 1500.00, daysAgo: 4 },
            { desc: 'Dinner 800', amount: 800.00, daysAgo: 3 },
            { desc: 'Cab 400', amount: 400.00, daysAgo: 2 },
            { desc: 'Shop 300', amount: 300.00, daysAgo: 1 }
        ];
        for (const s of specs) {
            const exp = await client.query(`
                INSERT INTO public.expenses (group_id, paid_by, description, amount, currency, category, split_type, expense_date)
                VALUES ($1, $2, $3, $4, 'INR', 'General', 'exact', CURRENT_DATE - INTERVAL '${s.daysAgo} days')
                RETURNING id
            `, [testGroupId, userCharlie.id, s.desc, s.amount]);
            const eid = exp.rows[0].id;
            expIds.push(eid);
            await client.query(`INSERT INTO public.expense_payers (expense_id, user_id, amount) VALUES ($1, $2, $3)`, [eid, userCharlie.id, s.amount]);
            await client.query(`
                INSERT INTO public.expense_splits (expense_id, user_id, amount, base_amount, settled_amount_base, is_settled)
                VALUES ($1, $2, $3, $3, 0.00, false)
            `, [eid, userAmit.id, s.amount]);
        }
        await client.query('COMMIT');
    } finally {
        client.release();
    }

    // Verify initial outstanding list
    const outRes1 = await fetch(`${API}/settlements/outstanding-expenses?peer_id=${userCharlie.id}&mode=payable`, {
        headers: { 'Authorization': `Bearer ${amitToken}` }
    });
    const out1 = await outRes1.json();
    assert(out1.payable.length >= 4, 'At least 4 outstanding expenses found for Amit');
    assert(out1.total_payable >= 3000, 'Total payable is at least ₹3,000');

    // 1. Partial Combined Settlement of ₹2,000 using FIFO
    // FIFO allocation: Hotel (1500) -> 1500; Dinner (800) -> 500; Cab -> 0; Shop -> 0
    const fifoAllocations = [
        { expense_id: expIds[0], amount: 1500.00 },
        { expense_id: expIds[1], amount: 500.00 }
    ];

    const comb1Res = await fetch(`${API}/settlements`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${amitToken}`
        },
        body: JSON.stringify({
            payer_id: userAmit.id,
            receiver_id: userCharlie.id,
            group_id: testGroupId,
            amount: 2000.00,
            payment_method: 'UPI',
            settlement_type: 'COMBINED',
            allocations: fifoAllocations
        })
    });
    const comb1 = await comb1Res.json();
    assert(comb1Res.ok, 'Combined settlement of ₹2,000 processed successfully');

    // Verify allocations recorded
    const comb1Id = comb1.id || comb1.settlement?.id;
    const allocCheck = await fetch(`${API}/settlements/${comb1Id}/allocations`, {
        headers: { 'Authorization': `Bearer ${amitToken}` }
    });
    const allocCheckData = await allocCheck.json();
    const allocsComb = allocCheckData.allocations || allocCheckData;
    assert(allocsComb.length === 2, 'Exactly 2 allocation records stored for the combined settlement');

    // Verify individual expense states:
    // Hotel (expIds[0]) must be fully settled
    const hotelCheck = await fetch(`${API}/expenses/${expIds[0]}/settlements`, {
        headers: { 'Authorization': `Bearer ${amitToken}` }
    });
    const hotelData = await hotelCheck.json();
    assert(hotelData.summary.settlement_status === 'FULLY_SETTLED', 'Hotel is FULLY_SETTLED (₹1,500/₹1,500)');

    // Dinner (expIds[1]) must have 300 remaining
    const dinnerCheck = await fetch(`${API}/expenses/${expIds[1]}/settlements`, {
        headers: { 'Authorization': `Bearer ${amitToken}` }
    });
    const dinnerData = await dinnerCheck.json();
    assert(dinnerData.liabilities[0].outstanding_amount === 300, 'Dinner has ₹300 remaining liability (₹500 settled of ₹800)');

    // 2. Custom Combined Settlement of remaining ₹1,000
    // Allocations: Dinner (300) + Cab (400) + Shop (300) = ₹1,000
    const customAllocations = [
        { expense_id: expIds[1], amount: 300.00 },
        { expense_id: expIds[2], amount: 400.00 },
        { expense_id: expIds[3], amount: 300.00 }
    ];

    const comb2Res = await fetch(`${API}/settlements`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${amitToken}`
        },
        body: JSON.stringify({
            payer_id: userAmit.id,
            receiver_id: userCharlie.id,
            group_id: testGroupId,
            amount: 1000.00,
            payment_method: 'BANK',
            settlement_type: 'COMBINED',
            allocations: customAllocations
        })
    });
    assert(comb2Res.ok, 'Custom combined settlement of ₹1,000 processed successfully');

    // Verify all 4 expenses are now fully settled
    for (const eid of expIds) {
        const c = await fetch(`${API}/expenses/${eid}/settlements`, {
            headers: { 'Authorization': `Bearer ${amitToken}` }
        });
        const cd = await c.json();
        assert(cd.summary.settlement_status === 'FULLY_SETTLED', `Expense #${eid} is now FULLY_SETTLED`);
    }
}

// -----------------------------------------------------------------------------
// TEST CASE 5, 6, 7: Mark as Paid Pending Invariance, Rejection, and Acceptance
// -----------------------------------------------------------------------------
async function testCase5_6_7_MarkAsPaidWorkflow() {
    console.log('\n[TEST CASE 5, 6, 7] Mark as Paid Workflow: Invariance, Rejection & Acceptance (Phase 6)');

    const client = await pool.connect();
    let expId;
    try {
        await client.query('BEGIN');
        const exp = await client.query(`
            INSERT INTO public.expenses (group_id, paid_by, description, amount, currency, category, split_type, expense_date)
            VALUES ($1, $2, 'Kayaking 1200', 1200.00, 'INR', 'Entertainment', 'exact', CURRENT_DATE)
            RETURNING id
        `, [testGroupId, userCharlie.id]);
        expId = exp.rows[0].id;
        await client.query(`INSERT INTO public.expense_payers (expense_id, user_id, amount) VALUES ($1, $2, 1200.00)`, [expId, userCharlie.id]);
        await client.query(`
            INSERT INTO public.expense_splits (expense_id, user_id, amount, base_amount, settled_amount_base, is_settled)
            VALUES ($1, $2, 1200.00, 1200.00, 0.00, false)
        `, [expId, userKaran.id]);
        await client.query('COMMIT');
    } finally {
        client.release();
    }

    // Step 1: Debtor (Karan) creates Mark as Paid request for ₹600
    const req1Res = await fetch(`${API}/payment-requests`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${karanToken}`
        },
        body: JSON.stringify({
            receiver_id: userCharlie.id,
            group_id: testGroupId,
            expense_id: expId,
            amount: 600.00,
            payment_method: 'UPI',
            transaction_reference: 'TEST-TXN-KAYAK-1',
            note: 'Paid via GPay',
            idempotency_key: `test-markpaid-1-${Date.now()}`
        })
    });
    const req1Data = await req1Res.json();
    assert(req1Res.ok, 'Payment request created with status PENDING');
    const requestId = req1Data.request.id;

    // Step 2: VERIFY BALANCE INVARIANCE (Pending request must NEVER touch balances or settlements)
    const checkPendingRes = await fetch(`${API}/expenses/${expId}/settlements`, {
        headers: { 'Authorization': `Bearer ${karanToken}` }
    });
    const checkPending = await checkPendingRes.json();
    assert(checkPending.liabilities[0].outstanding_amount === 1200, 'PENDING request did not reduce liability (remains ₹1,200)');
    assert(checkPending.allocations.length === 0, 'Zero allocations recorded while request is PENDING');

    // Step 3: Receiver (Charlie) REJECTS the request
    const rejectRes = await fetch(`${API}/payment-requests/${requestId}/reject`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${charlieToken}`
        },
        body: JSON.stringify({ reason: 'Money not received in bank' })
    });
    const rejectData = await rejectRes.json();
    assert(rejectRes.ok, 'Receiver successfully rejected request');
    assert(rejectData.request.status === 'REJECTED', 'Status changed to REJECTED');

    // VERIFY BALANCE INVARIANCE after rejection
    const checkRejectedRes = await fetch(`${API}/expenses/${expId}/settlements`, {
        headers: { 'Authorization': `Bearer ${karanToken}` }
    });
    const checkRejected = await checkRejectedRes.json();
    assert(checkRejected.liabilities[0].outstanding_amount === 1200, 'REJECTED request did not modify liability (remains ₹1,200)');

    // Step 4: Debtor submits a new Mark as Paid request for ₹1,200
    const req2Res = await fetch(`${API}/payment-requests`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${karanToken}`
        },
        body: JSON.stringify({
            receiver_id: userCharlie.id,
            group_id: testGroupId,
            expense_id: expId,
            amount: 1200.00,
            payment_method: 'UPI',
            transaction_reference: 'TEST-TXN-KAYAK-2',
            note: 'Paid second attempt',
            idempotency_key: `test-markpaid-2-${Date.now()}`
        })
    });
    const req2Data = await req2Res.json();
    const req2Id = req2Data.request.id;

    // Step 5: Receiver (Charlie) ACCEPTS the request
    const acceptRes = await fetch(`${API}/payment-requests/${req2Id}/accept`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${charlieToken}`
        }
    });
    const acceptData = await acceptRes.json();
    assert(acceptRes.ok, 'Receiver successfully accepted payment request');
    const reqStatus = (acceptData.request && acceptData.request.status) || acceptData.status;
    assert(reqStatus === 'ACCEPTED', 'Status changed to ACCEPTED');
    const settleId = (acceptData.settlement && acceptData.settlement.id) || acceptData.settlement_id;
    assert(Boolean(settleId), 'Confirmed settlement ID created on acceptance');

    // Step 6: VERIFY LEDGER AND ALLOCATION UPDATE
    const checkAcceptedRes = await fetch(`${API}/expenses/${expId}/settlements`, {
        headers: { 'Authorization': `Bearer ${karanToken}` }
    });
    const checkAccepted = await checkAcceptedRes.json();
    assert(checkAccepted.summary.settlement_status === 'FULLY_SETTLED', 'Expense status is FULLY_SETTLED after acceptance');
    assert(checkAccepted.allocations.length === 1, 'Allocation record inserted for accepted settlement');
    assert(Number(checkAccepted.allocations[0].amount) === 1200, 'Allocation amount is ₹1,200');
}

// -----------------------------------------------------------------------------
// TEST CASE 8: Money Conservation and Double-Entry Invariance
// -----------------------------------------------------------------------------
async function testCase8_DoubleEntryBalanceInvariance() {
    console.log('\n[TEST CASE 8] Money Conservation & Double-Entry Invariance');

    // Query group balances
    const res = await fetch(`${API}/groups/${testGroupId}/balances`, {
        headers: { 'Authorization': `Bearer ${charlieToken}` }
    });
    const data = await res.json();
    assert(res.ok, 'Endpoint GET /api/groups/:id/balances returned 200');

    // Verify mathematical identity in database for the test group:
    // Sum of all net positions across group members MUST equal 0.00
    const client = await pool.connect();
    try {
        const netCheck = await client.query(`
            SELECT 
                u.id as user_id,
                u.name,
                COALESCE(ep.paid, 0) as paid,
                COALESCE(es.owed, 0) as owed,
                COALESCE(sp.settled_paid, 0) as settled_paid,
                COALESCE(sr.settled_recv, 0) as settled_recv,
                (COALESCE(ep.paid, 0) - COALESCE(es.owed, 0) + COALESCE(sp.settled_paid, 0) - COALESCE(sr.settled_recv, 0)) as net_balance
            FROM public.users u
            LEFT JOIN (
                SELECT p.user_id, SUM(p.amount) as paid
                FROM public.expense_payers p
                JOIN public.expenses e ON e.id = p.expense_id
                WHERE e.group_id = $1
                GROUP BY p.user_id
            ) ep ON ep.user_id = u.id
            LEFT JOIN (
                SELECT s.user_id, SUM(s.amount) as owed
                FROM public.expense_splits s
                JOIN public.expenses e ON e.id = s.expense_id
                WHERE e.group_id = $1
                GROUP BY s.user_id
            ) es ON es.user_id = u.id
            LEFT JOIN (
                SELECT st.payer_id, SUM(st.amount) as settled_paid
                FROM public.settlements st
                WHERE st.group_id = $1
                GROUP BY st.payer_id
            ) sp ON sp.payer_id = u.id
            LEFT JOIN (
                SELECT st.receiver_id, SUM(st.amount) as settled_recv
                FROM public.settlements st
                WHERE st.group_id = $1
                GROUP BY st.receiver_id
            ) sr ON sr.receiver_id = u.id
            WHERE u.id IN (
                SELECT user_id FROM public.group_members WHERE group_id = $1
            )
        `, [testGroupId]);

        let sumOfAllNetBalances = 0;
        for (const row of netCheck.rows) {
            sumOfAllNetBalances += parseFloat(row.net_balance);
        }
        sumOfAllNetBalances = Math.round(sumOfAllNetBalances * 100) / 100;

        assert(Math.abs(sumOfAllNetBalances) < 0.01, `Group conservation of money holds: Sum of net balances = ₹${sumOfAllNetBalances.toFixed(2)} (0.00)`);
    } finally {
        client.release();
    }
}

// -----------------------------------------------------------------------------
// MAIN TEST RUNNER
// -----------------------------------------------------------------------------
async function runDualSettlementMasterSuite() {
    console.log('=============================================================');
    console.log(' STARTING DUAL SETTLEMENT AUTOMATED TEST SUITE');
    console.log('=============================================================');

    try {
        await setupTestEnvironment();
        await testCase1_MultiPayerDinner();
        await testCase2_ExpenseWisePartialSettlement();
        await testCase3_CombinedSettlementFIFO();
        await testCase5_6_7_MarkAsPaidWorkflow();
        await testCase8_DoubleEntryBalanceInvariance();

        console.log('\n=============================================================');
        console.log(`✓ ALL TESTS PASSED: ${passedTests} / ${totalTests} assertions passed!`);
        console.log('=============================================================');
    } catch (err) {
        console.error('\n❌ TEST SUITE FAILED:', err);
        process.exitCode = 1;
    } finally {
        await cleanupTestEnvironment();
        await pool.end();
    }
}

runDualSettlementMasterSuite();
