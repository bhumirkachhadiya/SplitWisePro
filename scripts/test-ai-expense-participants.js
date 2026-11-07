const http = require('http');
const { Pool } = require('pg');
require('dotenv').config();

const BASE_URL = 'http://127.0.0.1:5000';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function post(endpoint, data, headers = {}) {
    try {
        const res = await fetch(BASE_URL + endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...headers
            },
            body: JSON.stringify(data)
        });
        const body = await res.json().catch(() => ({}));
        return { status: res.status, body };
    } catch (err) {
        console.error(`Fetch error on ${endpoint}:`, err.message);
        throw err;
    }
}

async function runRegressionSuite() {
    console.log('================================================================');
    console.log('   AI ASSISTANT EXPENSE PARTICIPANT SELECTION REGRESSION SUITE');
    console.log('================================================================\n');

    let passed = 0;
    let failed = 0;

    function assert(desc, condition, details = '') {
        if (condition) {
            console.log(`  ✓ PASS: ${desc}`);
            passed++;
        } else {
            console.error(`  ✗ FAIL: ${desc} ${details ? '(' + details + ')' : ''}`);
            failed++;
        }
    }

    try {
        // Fetch test users
        const usersRes = await pool.query('SELECT id, name, email FROM users ORDER BY id ASC');
        const allUsers = usersRes.rows;
        const alex = allUsers.find(u => u.name === 'Alex Sharma');
        const rahul = allUsers.find(u => u.name === 'Rahul Sharma');
        const priya = allUsers.find(u => u.name === 'Priya Patel');
        const aman = allUsers.find(u => u.name === 'Aman Verma');
        const charlie = allUsers.find(u => u.name === 'Charlie');

        console.log(`[Test Environment Context]`);
        console.log(`  Alex Sharma:  ID ${alex.id}`);
        console.log(`  Rahul Sharma: ID ${rahul.id}`);
        console.log(`  Priya Patel:  ID ${priya.id}`);
        console.log(`  Aman Verma:   ID ${aman.id}`);
        console.log(`  Charlie:      ID ${charlie.id}\n`);

        const authRahul = { 'x-user-id': String(rahul.id) };
        const authAlex = { 'x-user-id': String(alex.id) };

        // -------------------------------------------------------------------------
        // TEST 1: The Core Reported Bug: "Add an expense of ₹4,000 for me and Alex Sharma."
        // -------------------------------------------------------------------------
        console.log('--- TEST 1: Core Reported Bug ("for me and Alex Sharma") ---');
        const conv1 = 'conv_test1_' + Date.now();
        const q1 = await post('/api/chatbot/query', {
            query: 'Add an expense of ₹4,000 for me and Alex Sharma.',
            conversation_id: conv1
        }, authRahul);

        assert('Proposal status is 200 OK', q1.status === 200);
        assert('Action is CONFIRM_TOOL', q1.body.action === 'CONFIRM_TOOL');
        assert('ToolCall action is ADD_EXPENSE', q1.body.toolCall?.action === 'ADD_EXPENSE');
        assert('Total amount is 4000', q1.body.toolCall?.params?.amount === 4000);
        assert('Participants array has exactly 2 members', q1.body.toolCall?.params?.participants?.length === 2);

        const p1 = q1.body.toolCall?.params?.participants || [];
        const hasRahul1 = p1.some(p => p.id === rahul.id && p.amount === 2000);
        const hasAlex1 = p1.some(p => p.id === alex.id && p.amount === 2000);
        assert('Includes Rahul Sharma with ₹2,000 share', hasRahul1);
        assert('Includes Alex Sharma with ₹2,000 share', hasAlex1);
        assert('Does NOT include unmentioned group members (e.g. Priya, Aman)', !p1.some(p => p.id === priya.id || p.id === aman.id));

        assert('Reply states only 2 participants will be included', q1.body.reply?.includes('Only these 2 participants will be included'));

        // Execute Tool Action and verify DB
        console.log('  -> Executing confirmed expense creation in DB...');
        const exec1 = await post('/api/chatbot/confirm-action', {
            toolCall: q1.body.toolCall
        }, authRahul);

        assert('Confirm execution returns 200 OK', exec1.status === 200);
        const expId1 = exec1.body.result?.expenseId;
        assert('Expense created with ID > 0', expId1 > 0);

        // Verify Database Records
        const expRow1 = (await pool.query('SELECT * FROM expenses WHERE id = $1', [expId1])).rows[0];
        assert('Expense in DB has amount 4000.00', parseFloat(expRow1.amount) === 4000);
        assert('Expense paid_by is Rahul Sharma', expRow1.paid_by === rahul.id);

        const splits1 = (await pool.query('SELECT * FROM expense_splits WHERE expense_id = $1 ORDER BY user_id', [expId1])).rows;
        assert('Database expense_splits has EXACTLY 2 rows', splits1.length === 2);

        const rahulSplit1 = splits1.find(s => s.user_id === rahul.id);
        const alexSplit1 = splits1.find(s => s.user_id === alex.id);
        assert('Rahul split in DB is ₹2000.00 and is_settled = FALSE (unsettled until settlement)', parseFloat(rahulSplit1?.amount) === 2000 && rahulSplit1?.is_settled === false);
        assert('Alex split in DB is ₹2000.00 and is_settled = FALSE (unsettled until settlement)', parseFloat(alexSplit1?.amount) === 2000 && alexSplit1?.is_settled === false);

        // Verify unselected group members have NO splits
        const unselectedSplits1 = splits1.filter(s => s.user_id !== rahul.id && s.user_id !== alex.id);
        assert('Unselected group members have 0 split records in DB', unselectedSplits1.length === 0);

        // -------------------------------------------------------------------------
        // TEST 2: 3 Explicit Participants: "Add ₹2,000 for me, Alex and Priya"
        // -------------------------------------------------------------------------
        console.log('\n--- TEST 2: 3 Explicit Participants ("for me, Alex and Priya") ---');
        const conv2 = 'conv_test2_' + Date.now();
        const q2 = await post('/api/chatbot/query', {
            query: 'Add ₹2,000 for me, Alex and Priya in Goa Trip 2024',
            conversation_id: conv2
        }, authRahul);

        assert('Proposal status 200 OK', q2.status === 200);
        const p2 = q2.body.toolCall?.params?.participants || [];
        assert('Participants count is exactly 3', p2.length === 3);
        const sum2 = p2.reduce((s, p) => s + p.amount, 0);
        assert('Sum of participant shares equals exactly ₹2,000.00', Math.abs(sum2 - 2000) < 0.01);
        assert('Participants contain Rahul, Alex, and Priya only', p2.every(p => [rahul.id, alex.id, priya.id].includes(p.id)));

        const exec2 = await post('/api/chatbot/confirm-action', { toolCall: q2.body.toolCall }, authRahul);
        assert('Execution succeeded', exec2.status === 200);
        const expId2 = exec2.body.result?.expenseId;
        const splitsCount2 = (await pool.query('SELECT COUNT(*)::int as count FROM expense_splits WHERE expense_id = $1', [expId2])).rows[0].count;
        assert('DB has exactly 3 split rows for this expense', splitsCount2 === 3);

        // -------------------------------------------------------------------------
        // TEST 3: "Alex and Priya only" (Logged-in user excluded)
        // -------------------------------------------------------------------------
        console.log('\n--- TEST 3: "Alex and Priya only" (Excluding logged-in user) ---');
        const conv3 = 'conv_test3_' + Date.now();
        const q3 = await post('/api/chatbot/query', {
            query: 'Add ₹5,000 for Alex and Priya only in Goa Trip 2024',
            conversation_id: conv3
        }, authRahul);

        assert('Proposal status 200 OK', q3.status === 200);
        const p3 = q3.body.toolCall?.params?.participants || [];
        assert('Participants count is exactly 2', p3.length === 2);
        assert('Logged-in user (Rahul) is NOT in participants', !p3.some(p => p.id === rahul.id));
        assert('Alex and Priya each have ₹2,500 share', p3.every(p => p.amount === 2500));

        const exec3 = await post('/api/chatbot/confirm-action', { toolCall: q3.body.toolCall }, authRahul);
        assert('Execution succeeded', exec3.status === 200);
        const expId3 = exec3.body.result?.expenseId;
        const splits3 = (await pool.query('SELECT user_id, amount FROM expense_splits WHERE expense_id = $1', [expId3])).rows;
        assert('DB splits contain only Alex and Priya', splits3.length === 2 && splits3.every(s => [alex.id, priya.id].includes(s.user_id)));

        // -------------------------------------------------------------------------
        // TEST 4: "for everyone in this group" (All group members included)
        // -------------------------------------------------------------------------
        console.log('\n--- TEST 4: "for everyone in this group" (All group members) ---');
        const conv4 = 'conv_test4_' + Date.now();
        const q4 = await post('/api/chatbot/query', {
            query: 'Add ₹1,000 for everyone in this group in Goa Trip 2024',
            conversation_id: conv4
        }, authRahul);

        assert('Proposal status 200 OK', q4.status === 200);
        const p4 = q4.body.toolCall?.params?.participants || [];
        assert('All 5 circle members included', p4.length === 5);
        assert('Each member share is ₹200.00', p4.every(p => p.amount === 200));

        // -------------------------------------------------------------------------
        // TEST 5: "for me only" (Logged-in user single participant)
        // -------------------------------------------------------------------------
        console.log('\n--- TEST 5: "for me only" (Personal expense in circle) ---');
        const conv5 = 'conv_test5_' + Date.now();
        const q5 = await post('/api/chatbot/query', {
            query: 'Add an expense of ₹1,000 for me only in Goa Trip 2024',
            conversation_id: conv5
        }, authRahul);

        assert('Proposal status 200 OK', q5.status === 200);
        const p5 = q5.body.toolCall?.params?.participants || [];
        assert('Exactly 1 participant (Rahul)', p5.length === 1 && p5[0].id === rahul.id && p5[0].amount === 1000);

        // -------------------------------------------------------------------------
        // TEST 6: Custom / Unequal Split Amounts
        // -------------------------------------------------------------------------
        console.log('\n--- TEST 6: Custom Unequal Split ("₹2,000 for me and ₹1,000 for Alex") ---');
        const conv6 = 'conv_test6_' + Date.now();
        const q6 = await post('/api/chatbot/query', {
            query: 'Add ₹3,000: ₹2,000 for me and ₹1,000 for Alex in Goa Trip 2024',
            conversation_id: conv6
        }, authRahul);

        assert('Proposal status 200 OK', q6.status === 200);
        const p6 = q6.body.toolCall?.params?.participants || [];
        assert('Participants count is 2', p6.length === 2);
        const rahulP6 = p6.find(p => p.id === rahul.id);
        const alexP6 = p6.find(p => p.id === alex.id);
        assert('Rahul has custom share ₹2,000', rahulP6?.amount === 2000);
        assert('Alex has custom share ₹1,000', alexP6?.amount === 1000);

        const exec6 = await post('/api/chatbot/confirm-action', { toolCall: q6.body.toolCall }, authRahul);
        assert('Custom split execution succeeded', exec6.status === 200);

        // -------------------------------------------------------------------------
        // TEST 7: Different Payer ("Alex paid ₹3,000 for me and Priya")
        // -------------------------------------------------------------------------
        console.log('\n--- TEST 7: Different Payer ("Alex paid ₹3,000 for me and Priya") ---');
        const conv7 = 'conv_test7_' + Date.now();
        const q7 = await post('/api/chatbot/query', {
            query: 'Alex paid ₹3,000 for me and Priya in Goa Trip 2024',
            conversation_id: conv7
        }, authRahul);

        assert('Proposal status 200 OK', q7.status === 200);
        assert('Payer resolved as Alex Sharma', q7.body.toolCall?.params?.paidBy === alex.id);
        const p7 = q7.body.toolCall?.params?.participants || [];
        assert('Participants includes Rahul, Alex and Priya (3 members)', p7.length === 3);

        const exec7 = await post('/api/chatbot/confirm-action', { toolCall: q7.body.toolCall }, authRahul);
        assert('Execution succeeded with third-party payer', exec7.status === 200);
        const expId7 = exec7.body.result?.expenseId;
        const expRow7 = (await pool.query('SELECT paid_by FROM expenses WHERE id = $1', [expId7])).rows[0];
        assert('Expense paid_by in DB is Alex Sharma', expRow7.paid_by === alex.id);

        // -------------------------------------------------------------------------
        // TEST 8: Non-Group Member Error Protection
        // -------------------------------------------------------------------------
        console.log('\n--- TEST 8: Non-Group Member Protection ("Charlie in Goa Trip 2024") ---');
        const conv8 = 'conv_test8_' + Date.now();
        const q8 = await post('/api/chatbot/query', {
            query: 'Add ₹1,000 for me and Charlie in Goa Trip 2024',
            conversation_id: conv8
        }, authRahul);

        assert('Proposal status 200 OK', q8.status === 200);
        assert('Action is NONE (blocked)', q8.body.action === 'NONE');
        assert('Reply explains Charlie is not a member of the group', q8.body.reply?.includes('Charlie is not a member of the group'));

        // -------------------------------------------------------------------------
        // TEST 9: Multi-Turn Amount Refinement Keeps Participant Shares Accurate
        // -------------------------------------------------------------------------
        console.log('\n--- TEST 9: Multi-Turn Refinement of Participants ---');
        const conv9 = 'conv_test9_' + Date.now();
        const t1 = await post('/api/chatbot/query', {
            query: 'Add an expense of ₹4,000 for me and Alex Sharma in Goa Trip 2024',
            conversation_id: conv9
        }, authRahul);
        assert('Turn 1 created 4000 proposal for 2 members', t1.body.toolCall?.params?.participants?.length === 2);

        const t2 = await post('/api/chatbot/query', {
            query: 'Change amount to 6,000',
            conversation_id: conv9
        }, authRahul);
        assert('Turn 2 updated amount to 6000', t2.body.toolCall?.params?.amount === 6000);
        const p9 = t2.body.toolCall?.params?.participants || [];
        assert('Participants recalculated to ₹3,000 each', p9.every(p => p.amount === 3000));

        // -------------------------------------------------------------------------
        // TEST 10: Manual Expense API vs AI Assistant Parity Check
        // -------------------------------------------------------------------------
        console.log('\n--- TEST 10: Manual Expense API vs AI Assistant Parity ---');
        const manualRes = await post('/api/expenses', {
            group_id: 1,
            paid_by: rahul.id,
            amount: 4000,
            description: 'Manual Parity Test',
            split_user_ids: [rahul.id, alex.id]
        }, authRahul);

        assert('Manual expense creation returns success status', manualRes.status === 200 || manualRes.status === 201);
        const manualExpId = manualRes.body?.id;
        const manualSplits = (await pool.query('SELECT user_id, amount FROM expense_splits WHERE expense_id = $1', [manualExpId])).rows;
        assert('Manual expense created exactly 2 splits in DB (parity verified)', manualSplits.length === 2 && manualSplits.every(s => [rahul.id, alex.id].includes(s.user_id)));

        // Clean up test expenses to keep database pristine
        const testExpIds = [expId1, expId2, expId3, expId7, manualExpId].filter(id => id > 0);
        if (testExpIds.length > 0) {
            await pool.query('UPDATE expense_splits SET is_settled = FALSE WHERE expense_id = ANY($1)', [testExpIds]);
            await pool.query('DELETE FROM expense_splits WHERE expense_id = ANY($1)', [testExpIds]);
            await pool.query('DELETE FROM expenses WHERE id = ANY($1)', [testExpIds]);
            console.log(`\n  (Cleaned up ${testExpIds.length} test expenses from database)`);
        }

        console.log('\n================================================================');
        console.log(`TOTAL CHECKS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
        console.log('================================================================');

        process.exit(failed > 0 ? 1 : 0);
    } catch (err) {
        console.error('Fatal error in regression suite:', err);
        process.exit(1);
    }
}

runRegressionSuite();
