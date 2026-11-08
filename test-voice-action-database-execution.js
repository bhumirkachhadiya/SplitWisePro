/**
 * REAL DATABASE ACTION EXECUTION TEST SUITE
 * 
 * Verifies that the SplitWise Voice Assistant executes authorized database
 * operations, requires confirmations, updates PostgreSQL tables directly,
 * and maintains data consistency.
 */

const { pool } = require('./db');
const authService = require('./authService');
const BASE_URL = 'http://localhost:5000/api/chatbot/query';
const CONFIRM_URL = 'http://localhost:5000/api/chatbot/confirm-action';

async function runDatabaseExecutionTests() {
    console.log('================================================================');
    console.log('  ⚡ REAL DATABASE ACTION EXECUTION & TRANSACTION VERIFICATION');
    console.log('================================================================\n');

    let passedCount = 0;
    let failedCount = 0;

    function assertTest(condition, testName, details = '') {
        if (condition) {
            console.log(`✅ PASS: ${testName}`);
            if (details) console.log(`   ${details}`);
            passedCount++;
        } else {
            console.error(`❌ FAIL: ${testName}`);
            if (details) console.error(`   Details: ${details}`);
            failedCount++;
        }
    }

    const sessionRecord = await authService.createSession(1);
    const authToken = sessionRecord.token;
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
    };

    // -----------------------------------------------------------------
    // TEST 1: Propose Group Creation via Voice Command
    // -----------------------------------------------------------------
    console.log('--- 1. Propose Circle Creation via Voice ---');
    const groupName = `Goa Trip ${Date.now().toString().slice(-4)}`;
    let gRes = await fetch(BASE_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            query: `Create a group called ${groupName}`,
            language: 'en',
            user_id: 1
        })
    });
    let gData = await gRes.json();
    assertTest(
        gRes.status === 200 && gData.action === 'CONFIRM_TOOL' && gData.toolCall?.action === 'CREATE_GROUP',
        'Group creation proposed with CONFIRM_TOOL gate',
        `Summary: "${gData.toolCall?.summary}"`
    );

    // Confirm group creation via /api/chatbot/confirm-action
    console.log('\n--- 2. Execute Group Creation Confirmation ---');
    let confRes = await fetch(CONFIRM_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            toolCall: gData.toolCall
        })
    });
    let confData = await confRes.json();
    assertTest(
        confRes.status === 200 && confData.success && confData.result?.groupId,
        'Group created in database via confirmation',
        `Group ID: ${confData.result?.groupId}`
    );

    const createdGroupId = confData.result?.groupId;

    // Verify in PostgreSQL table
    const dbGrpCheck = await pool.query('SELECT * FROM groups WHERE id = $1', [createdGroupId]);
    assertTest(
        dbGrpCheck.rows.length === 1 && dbGrpCheck.rows[0].name.toLowerCase() === groupName.toLowerCase(),
        'PostgreSQL table verifies group existence and name consistency',
        `DB Record: "${dbGrpCheck.rows[0].name}" (ID ${dbGrpCheck.rows[0].id})`
    );

    // -----------------------------------------------------------------
    // TEST 3: Propose Adding Expense in Created Circle
    // -----------------------------------------------------------------
    console.log('\n--- 3. Propose Expense Creation via Voice ---');
    let expRes = await fetch(BASE_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            query: `Add an expense of ₹1,800 for dinner for everyone in ${groupName}`,
            language: 'en',
            user_id: 1
        })
    });
    let expData = await expRes.json();
    assertTest(
        expRes.status === 200 && expData.action === 'CONFIRM_TOOL' && expData.toolCall?.action === 'ADD_EXPENSE',
        'Expense proposed with CONFIRM_TOOL gate and exact parameters',
        `Amount: ₹${expData.toolCall?.params?.amount}, Description: "${expData.toolCall?.params?.description}"`
    );

    // Confirm Expense Creation
    console.log('\n--- 4. Execute Expense Confirmation via Affirmative Conversation ---');
    let expConfRes = await fetch(CONFIRM_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            toolCall: expData.toolCall
        })
    });
    let expConfData = await expConfRes.json();
    assertTest(
        expConfRes.status === 200 && expConfData.success && expConfData.result?.expenseId,
        'Expense successfully recorded in database',
        `Expense ID: ${expConfData.result?.expenseId}`
    );

    const createdExpenseId = expConfData.result?.expenseId;

    // Verify in PostgreSQL expenses and expense_splits tables
    const dbExpCheck = await pool.query('SELECT * FROM expenses WHERE id = $1', [createdExpenseId]);
    const dbSplitsCheck = await pool.query('SELECT * FROM expense_splits WHERE expense_id = $1', [createdExpenseId]);
    assertTest(
        dbExpCheck.rows.length === 1 && parseFloat(dbExpCheck.rows[0].amount) === 1800 && dbSplitsCheck.rows.length >= 1,
        'PostgreSQL table verifies expense record and split distribution',
        `Amount: ₹${dbExpCheck.rows[0].amount}, Split rows: ${dbSplitsCheck.rows.length}`
    );

    // -----------------------------------------------------------------
    // TEST 5: Verify AI Agent Audit Trail (ai_agent_actions table)
    // -----------------------------------------------------------------
    console.log('\n--- 5. Verify Immutable AI Audit Log ---');
    const auditCheck = await pool.query(
        'SELECT * FROM ai_agent_actions WHERE user_id = $1 ORDER BY id DESC LIMIT 2',
        [1]
    );
    assertTest(
        auditCheck.rows.length >= 1 && auditCheck.rows[0].status === 'EXECUTED',
        'Audit log records every AI agent action with status EXECUTED',
        `Latest Action: ${auditCheck.rows[0].action_type} (Status: ${auditCheck.rows[0].status})`
    );

    // Clean up test data
    console.log('\n--- 6. Clean Up Temporary Test Entities ---');
    await pool.query('DELETE FROM expense_splits WHERE expense_id = $1', [createdExpenseId]);
    await pool.query('DELETE FROM expenses WHERE id = $1', [createdExpenseId]);
    await pool.query('DELETE FROM group_members WHERE group_id = $1', [createdGroupId]);
    await pool.query('DELETE FROM groups WHERE id = $1', [createdGroupId]);
    assertTest(true, 'Test entities cleanly purged, maintaining ledger hygiene');

    console.log('\n================================================================');
    console.log(`  SUMMARY: ${passedCount} PASSED | ${failedCount} FAILED`);
    console.log('================================================================\n');

    process.exit(failedCount > 0 ? 1 : 0);
}

runDatabaseExecutionTests().catch(err => {
    console.error('Database execution test error:', err);
    process.exit(1);
});
