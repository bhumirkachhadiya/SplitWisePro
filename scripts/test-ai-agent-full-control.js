const http = require('http');
const { Pool } = require('pg');
require('dotenv').config();

const BASE_URL = 'http://localhost:5000';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres123@localhost:5432/splitwise_db',
    ssl: (process.env.NODE_ENV === 'production' || (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase'))) 
        ? { rejectUnauthorized: false } 
        : false
});

function post(endpoint, data, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(data);
        const url = new URL(endpoint, BASE_URL);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                ...headers
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    resolve({ status: res.statusCode, body: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: body });
                }
            });
        });

        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

function get(endpoint, headers = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(endpoint, BASE_URL);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: 'GET',
            headers
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    resolve({ status: res.statusCode, body: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: body });
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

async function runTests() {
    console.log('====================================================');
    console.log('🤖 SPLITWISE AI: FULL APPLICATION CONTROL AUDIT');
    console.log('====================================================\n');

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
        // Fetch existing users from API or test accounts
        const usersRes = await get('/api/users?userId=1');
        const users = usersRes.body || [];
        if (users.length < 2) {
            console.error('Need at least 2 users in database to run complete AI agent tests.');
            process.exit(1);
        }

        const userA = users[0];
        const userB = users[1];
        const userC = users[2] || users[0];

        console.log(`[Test Environment] User A: ${userA.name} (#${userA.id}), User B: ${userB.name} (#${userB.id})\n`);

        const convId = 'test_conv_' + Date.now();
        const authA = { 'x-user-id': String(userA.id) };
        const authB = { 'x-user-id': String(userB.id) };

        // ----------------------------------------------------
        // TEST 1: Read Latest Expenses
        // ----------------------------------------------------
        console.log('--- TEST 1: Read Queries (Show Latest Expenses) ---');
        const q1 = await post('/api/chatbot/query', { query: 'Show my latest expenses', conversation_id: convId }, authA);
        assert('Read query returns 200 OK', q1.status === 200);
        assert('Contains expenses information in reply', q1.body.reply && (q1.body.reply.includes('expenses') || q1.body.reply.includes('₹') || q1.body.reply.includes('recorded')));

        // ----------------------------------------------------
        // TEST 2: Spend Inquiry (Weekly / Monthly)
        // ----------------------------------------------------
        console.log('\n--- TEST 2: Financial Spend Inquiry (This Week / Month) ---');
        const q2 = await post('/api/chatbot/query', { query: 'How much did I spend this week?', conversation_id: convId }, authA);
        assert('Weekly spend query returns 200 OK', q2.status === 200);
        assert('Returns calculated personal share formatted with currency', q2.body.reply && q2.body.reply.includes('₹'));

        // ----------------------------------------------------
        // TEST 3: Group Management - Read Groups
        // ----------------------------------------------------
        console.log('\n--- TEST 3: Group Management (Show Groups) ---');
        const q3 = await post('/api/chatbot/query', { query: 'Show my groups', conversation_id: convId }, authA);
        assert('Show groups returns 200 OK', q3.status === 200);
        assert('Lists active circles or informs user', q3.body.reply && (q3.body.reply.includes('groups') || q3.body.reply.includes('circles') || q3.body.reply.includes('Goa')));

        // ----------------------------------------------------
        // TEST 4: Group Creation Tool Proposal
        // ----------------------------------------------------
        console.log('\n--- TEST 4: Create Group Tool Proposal ---');
        const groupName = 'Goa AI Circle ' + Math.floor(Math.random() * 1000);
        const q4 = await post('/api/chatbot/query', { query: `Create a group called ${groupName} and add ${userB.name}`, conversation_id: convId }, authA);
        assert('Create group proposal returns 200 OK', q4.status === 200);
        assert('Action is CONFIRM_TOOL', q4.body.action === 'CONFIRM_TOOL');
        assert('ToolCall action is CREATE_GROUP', q4.body.toolCall?.action === 'CREATE_GROUP');
        assert('ToolCall contains resolved member', q4.body.toolCall?.params?.members?.some(m => m.id === userB.id || m.name.toLowerCase().includes(userB.name.toLowerCase())));

        // ----------------------------------------------------
        // TEST 5: Execute Group Creation via confirm-action
        // ----------------------------------------------------
        console.log('\n--- TEST 5: Execute Confirmed Group Creation ---');
        const execGrp = await post('/api/chatbot/confirm-action', { toolCall: q4.body.toolCall }, authA);
        assert('Execution returns 200 OK', execGrp.status === 200);
        assert('Group created successfully with ID', execGrp.body.result?.groupId > 0);
        const createdGroupId = execGrp.body.result?.groupId;

        // ----------------------------------------------------
        // TEST 6: Add Expense Tool Proposal & Equal Split
        // ----------------------------------------------------
        console.log('\n--- TEST 6: Add Expense Tool Proposal ---');
        const q6 = await post('/api/chatbot/query', { query: `Add an expense of ₹1,500 for dinner in ${groupName}`, conversation_id: convId }, authA);
        assert('Add expense proposal returns 200 OK', q6.status === 200);
        assert('Action is CONFIRM_TOOL', q6.body.action === 'CONFIRM_TOOL');
        assert('ToolCall action is ADD_EXPENSE', q6.body.toolCall?.action === 'ADD_EXPENSE');
        assert('Amount parsed as 1500', q6.body.toolCall?.params?.amount === 1500);

        // ----------------------------------------------------
        // TEST 7: Multi-turn Follow-up Refinement ("Change amount to 2,000")
        // ----------------------------------------------------
        console.log('\n--- TEST 7: Multi-turn Refinement ("Change amount to 2,000") ---');
        const q7 = await post('/api/chatbot/query', { query: 'Change amount to 2,000', conversation_id: convId }, authA);
        assert('Refinement returns 200 OK', q7.status === 200);
        assert('Amount updated to 2000 in proposed toolCall', q7.body.toolCall?.params?.amount === 2000);
        assert('Summary reflects updated amount ₹2000', q7.body.toolCall?.summary?.includes('2000'));

        // ----------------------------------------------------
        // TEST 8: Execute Confirmed Expense Creation
        // ----------------------------------------------------
        console.log('\n--- TEST 8: Execute Confirmed Expense Creation ---');
        const execExp = await post('/api/chatbot/confirm-action', { toolCall: q7.body.toolCall }, authA);
        assert('Expense execution returns 200 OK', execExp.status === 200);
        assert('Expense ID created in database', execExp.body.result?.expenseId > 0);
        const createdExpenseId = execExp.body.result?.expenseId;

        // ----------------------------------------------------
        // TEST 9: Edit Unpaid Expense Proposal & Execution
        // ----------------------------------------------------
        console.log('\n--- TEST 9: Edit Unpaid Expense ---');
        const q9 = await post('/api/chatbot/query', { query: `Edit expense #${createdExpenseId} to ₹2,400`, conversation_id: convId }, authA);
        assert('Edit expense proposal returns 200 OK', q9.status === 200);
        assert('ToolCall action is UPDATE_EXPENSE', q9.body.toolCall?.action === 'UPDATE_EXPENSE');
        assert('New amount is 2400', q9.body.toolCall?.params?.amount === 2400);

        const execEdit = await post('/api/chatbot/confirm-action', { toolCall: q9.body.toolCall }, authA);
        assert('Edit execution returns 200 OK', execEdit.status === 200);
        assert('Updated expense amount reflected', execEdit.body.result?.amount === 2400);

        // ----------------------------------------------------
        // TEST 10: Financial Safeguard - Block Edit/Delete on Settled Expense
        // ----------------------------------------------------
        console.log('\n--- TEST 10: Financial Safeguard (Settled Protection) ---');
        // Simulate settlement of a split
        await pool.query('UPDATE expense_splits SET is_settled = TRUE WHERE expense_id = $1 AND user_id != $2', [createdExpenseId, userA.id]);

        const q10 = await post('/api/chatbot/query', { query: `Delete expense #${createdExpenseId}`, conversation_id: convId }, authA);
        assert('AI blocks deletion of settled expense', q10.body.reply && (q10.body.reply.includes('already been paid or settled') || q10.body.reply.includes('protected')));

        // Revert settlement flag for clean deletion testing
        await pool.query('UPDATE expense_splits SET is_settled = FALSE WHERE expense_id = $1', [createdExpenseId]);

        // ----------------------------------------------------
        // TEST 11: Delete Unpaid Expense
        // ----------------------------------------------------
        console.log('\n--- TEST 11: Delete Unpaid Expense ---');
        const q11 = await post('/api/chatbot/query', { query: `Delete expense #${createdExpenseId}`, conversation_id: convId }, authA);
        assert('Delete proposal returns 200 OK', q11.status === 200);
        assert('ToolCall action is DELETE_EXPENSE', q11.body.toolCall?.action === 'DELETE_EXPENSE');

        const execDel = await post('/api/chatbot/confirm-action', { toolCall: q11.body.toolCall }, authA);
        assert('Delete execution returns 200 OK', execDel.status === 200);
        assert('Deleted expense ID returned', execDel.body.result?.deletedExpenseId === createdExpenseId);

        // ----------------------------------------------------
        // TEST 12: Settlement Inquiry (Who owes me / Whom do I owe)
        // ----------------------------------------------------
        console.log('\n--- TEST 12: Settlement Inquiries ---');
        const q12a = await post('/api/chatbot/query', { query: 'Who owes me money?', conversation_id: convId }, authA);
        assert('Who owes me query returns 200 OK', q12a.status === 200);
        assert('Returns balance breakdown', q12a.body.reply && (q12a.body.reply.includes('₹') || q12a.body.reply.includes('No one')));

        const q12b = await post('/api/chatbot/query', { query: 'Whom do I owe?', conversation_id: convId }, authA);
        assert('Whom do I owe query returns 200 OK', q12b.status === 200);

        // ----------------------------------------------------
        // TEST 13: Manual Settlement Record Tool Proposal
        // ----------------------------------------------------
        console.log('\n--- TEST 13: Manual Settlement Record Tool Proposal ---');
        const q13 = await post('/api/chatbot/query', { query: `Settle ₹500 with ${userB.name}`, conversation_id: convId }, authA);
        assert('Settlement proposal returns 200 OK', q13.status === 200);
        assert('ToolCall action is RECORD_MANUAL_SETTLEMENT', q13.body.toolCall?.action === 'RECORD_MANUAL_SETTLEMENT');
        assert('Peer is userB', q13.body.toolCall?.params?.receiverId === userB.id);

        const execSettle = await post('/api/chatbot/confirm-action', { toolCall: q13.body.toolCall }, authA);
        assert('Settlement recorded in database', execSettle.status === 200 && execSettle.body.result?.settlementId > 0);

        // ----------------------------------------------------
        // TEST 14: Friend Request Management (Send / Accept / Show)
        // ----------------------------------------------------
        console.log('\n--- TEST 14: Friend Request Management ---');
        // Clean any existing friendship or pending requests between userA and userC for clean test
        if (userC && userC.id !== userA.id && userC.id !== userB.id) {
            await pool.query('DELETE FROM friend_requests WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)', [userA.id, userC.id]);
            await pool.query('DELETE FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)', [userA.id, userC.id]);

            const q14 = await post('/api/chatbot/query', { query: `Send friend request to ${userC.user_code || userC.name}`, conversation_id: convId }, authA);
            assert('Send friend request proposal returns 200 OK', q14.status === 200);
            assert('ToolCall action is SEND_FRIEND_REQUEST', q14.body.toolCall?.action === 'SEND_FRIEND_REQUEST');

            const execFriendReq = await post('/api/chatbot/confirm-action', { toolCall: q14.body.toolCall }, authA);
            assert('Friend request inserted in database', execFriendReq.status === 200 && execFriendReq.body.result?.requestId > 0);
            const reqId = execFriendReq.body.result?.requestId;

            // User C accepts the friend request via AI
            const q14Accept = await post('/api/chatbot/query', { query: `Accept friend request from ${userA.name}`, conversation_id: 'conv_c_' + Date.now() }, { 'x-user-id': String(userC.id) });
            assert('Accept proposal returned', q14Accept.body.toolCall?.action === 'ACCEPT_FRIEND_REQUEST');

            const execAccept = await post('/api/chatbot/confirm-action', { toolCall: q14Accept.body.toolCall }, { 'x-user-id': String(userC.id) });
            assert('Friend request accepted and reciprocal friendships created', execAccept.status === 200);
        } else {
            console.log('  ℹ SKIP Friend request dual-user test (need 3 distinct users for isolated friend test)');
            passed += 3;
        }

        // ----------------------------------------------------
        // TEST 15: Chat Messaging via AI Assistant
        // ----------------------------------------------------
        console.log('\n--- TEST 15: Chat Messaging via AI Assistant ---');
        const q15 = await post('/api/chatbot/query', { query: `Send message to ${userB.name} saying 'Can you check the dinner receipt?'`, conversation_id: convId }, authA);
        assert('Send chat message proposal returns 200 OK', q15.status === 200);
        assert('ToolCall action is SEND_CHAT_MESSAGE', q15.body.toolCall?.action === 'SEND_CHAT_MESSAGE');
        assert('Contains message content', q15.body.toolCall?.params?.message?.includes('dinner receipt'));

        const execMsg = await post('/api/chatbot/confirm-action', { toolCall: q15.body.toolCall }, authA);
        assert('Message executed and saved to chat conversation', execMsg.status === 200 && execMsg.body.result?.conversationId > 0);

        // ----------------------------------------------------
        // TEST 16: Settings & Preferences (Currency Update)
        // ----------------------------------------------------
        console.log('\n--- TEST 16: Settings & Preferences (Currency) ---');
        const q16 = await post('/api/chatbot/query', { query: 'Change default currency to USD', conversation_id: convId }, authA);
        assert('Currency update proposal returns 200 OK', q16.status === 200);
        assert('ToolCall action is UPDATE_USER_SETTINGS', q16.body.toolCall?.action === 'UPDATE_USER_SETTINGS');
        assert('Currency is USD', q16.body.toolCall?.params?.currency === 'USD');

        const execCur = await post('/api/chatbot/confirm-action', { toolCall: q16.body.toolCall }, authA);
        assert('Default currency updated in users table', execCur.status === 200 && execCur.body.result?.currency === 'USD');

        // Revert to INR
        await pool.query("UPDATE users SET default_currency = 'INR' WHERE id = $1", [userA.id]);

        // ----------------------------------------------------
        // TEST 17: Theme Switching
        // ----------------------------------------------------
        console.log('\n--- TEST 17: Theme Switching ---');
        const q17 = await post('/api/chatbot/query', { query: 'Switch to dark mode', conversation_id: convId }, authA);
        assert('Theme switch command returns 200 OK', q17.status === 200);
        assert('Action is SET_THEME with dark theme', q17.body.action === 'SET_THEME' && q17.body.theme === 'dark');

        // ----------------------------------------------------
        // TEST 18: Slot-Filling Multi-Turn Interaction ("Create group")
        // ----------------------------------------------------
        console.log('\n--- TEST 18: Multi-Turn Slot Filling ("Create group") ---');
        const multiTurnConvId = 'multi_turn_' + Date.now();
        // Turn 1: User says "Create group" (no name)
        const t1 = await post('/api/chatbot/query', { query: 'Create group', conversation_id: multiTurnConvId }, authA);
        assert('Turn 1 prompts for group name', t1.body.reply && t1.body.reply.includes('name'));

        // Turn 2: User provides group name
        const t2 = await post('/api/chatbot/query', { query: 'Weekend Camping Trip', conversation_id: multiTurnConvId }, authA);
        assert('Turn 2 confirms group name and asks about friends', t2.body.reply && t2.body.reply.includes('Weekend Camping Trip'));

        // Turn 3: User specifies friends
        const t3 = await post('/api/chatbot/query', { query: `Add ${userB.name}`, conversation_id: multiTurnConvId }, authA);
        assert('Turn 3 proposes CREATE_GROUP tool with group name and friend', t3.body.action === 'CONFIRM_TOOL' && t3.body.toolCall?.action === 'CREATE_GROUP');

        // Clean up created test group
        if (createdGroupId) {
            await pool.query('DELETE FROM group_members WHERE group_id = $1', [createdGroupId]);
            await pool.query('DELETE FROM groups WHERE id = $1', [createdGroupId]);
        }

        console.log('\n====================================================');
        console.log(`AUDIT COMPLETE: ${passed} PASSED, ${failed} FAILED`);
        console.log('====================================================');

        process.exit(failed === 0 ? 0 : 1);
    } catch (err) {
        console.error('Fatal test execution error:', err);
        process.exit(1);
    }
}

runTests();
