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

async function runSuite() {
    console.log('========================================================================');
    console.log('   AI ASSISTANT NATURAL HUMAN CONVERSATION & PERSONALIZATION SUITE      ');
    console.log('========================================================================\n');

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
        // Fetch users from DB
        const usersRes = await pool.query('SELECT id, name, email, default_currency FROM users ORDER BY id ASC');
        const allUsers = usersRes.rows;
        const rahul = allUsers.find(u => u.name === 'Rahul Sharma') || allUsers[0];
        const alex = allUsers.find(u => u.name === 'Alex Sharma') || allUsers[1];
        const priya = allUsers.find(u => u.name === 'Priya Patel') || allUsers[2];

        console.log(`[User Contexts]`);
        console.log(`  User 1 (Rahul): ID ${rahul.id}, Currency: ${rahul.default_currency || 'INR'}`);
        console.log(`  User 2 (Alex):  ID ${alex.id}, Currency: ${alex.default_currency || 'INR'}`);
        console.log(`  User 3 (Priya): ID ${priya.id}, Currency: ${priya.default_currency || 'INR'}\n`);

        const authRahul = { 'x-user-id': String(rahul.id) };
        const authAlex = { 'x-user-id': String(alex.id) };
        const authPriya = { 'x-user-id': String(priya.id) };

        // Ensure Priya has USD currency for multi-currency test
        await pool.query("UPDATE users SET default_currency = 'USD' WHERE id = $1", [priya.id]);

        // -------------------------------------------------------------------------
        // 1. GREETINGS (Hello, Hi, Hey)
        // -------------------------------------------------------------------------
        console.log('--- 1. Greetings (Hello, Hi, Hey) ---');
        const g1 = await post('/api/chatbot/query', { query: 'Hello!' }, authRahul);
        assert('Status 200 OK', g1.status === 200);
        assert('Personalized with Rahul first name', g1.body.reply?.includes('Rahul'));
        assert('Does not say "not trained"', !g1.body.reply?.toLowerCase().includes('not trained') && !g1.body.reply?.includes('exclusively'));

        const g2 = await post('/api/chatbot/query', { query: 'Hi' }, authAlex);
        assert('Personalized with Alex first name for Alex', g2.body.reply?.includes('Alex'));

        // -------------------------------------------------------------------------
        // 2. TIME-OF-DAY GREETINGS (Good morning, Good afternoon, etc.)
        // -------------------------------------------------------------------------
        console.log('\n--- 2. Time-of-Day Greetings ---');
        const gm = await post('/api/chatbot/query', { query: 'Good morning!' }, authRahul);
        assert('Good morning responds with morning greeting', gm.body.reply?.toLowerCase().includes('good morning') && gm.body.reply?.includes('Rahul'));

        const ge = await post('/api/chatbot/query', { query: 'Good evening!' }, authRahul);
        assert('Good evening responds with evening greeting', ge.body.reply?.toLowerCase().includes('good evening') && ge.body.reply?.includes('Rahul'));

        // -------------------------------------------------------------------------
        // 3. HOW ARE YOU?
        // -------------------------------------------------------------------------
        console.log('\n--- 3. How are you? ---');
        const h1 = await post('/api/chatbot/query', { query: 'How are you?' }, authRahul);
        assert('Status 200 OK', h1.status === 200);
        assert('Warm, conversational response', h1.body.reply?.toLowerCase().includes('doing great') || h1.body.reply?.toLowerCase().includes('great'));
        assert('Mentions user name', h1.body.reply?.includes('Rahul'));

        // -------------------------------------------------------------------------
        // 4. WHAT ARE YOU DOING?
        // -------------------------------------------------------------------------
        console.log('\n--- 4. What are you doing? ---');
        const w1 = await post('/api/chatbot/query', { query: 'What are you doing?' }, authRahul);
        assert('Status 200 OK', w1.status === 200);
        assert('Explains assistant readiness', w1.body.reply?.includes('expenses') || w1.body.reply?.includes('ready'));

        // -------------------------------------------------------------------------
        // 5. THANK YOU / THANKS
        // -------------------------------------------------------------------------
        console.log('\n--- 5. Thank you ---');
        const ty = await post('/api/chatbot/query', { query: 'Thank you so much!' }, authRahul);
        assert('Status 200 OK', ty.status === 200);
        assert('Gracious welcome reply', ty.body.reply?.toLowerCase().includes("welcome") && ty.body.reply?.includes('Rahul'));

        // -------------------------------------------------------------------------
        // 6. COMPLIMENTS (That\'s great, Nice!)
        // -------------------------------------------------------------------------
        console.log('\n--- 6. Compliments (That\'s great, Nice!) ---');
        const c1 = await post('/api/chatbot/query', { query: "That's great" }, authRahul);
        assert('Status 200 OK', c1.status === 200);
        assert('Positive feedback acknowledged', c1.body.reply?.toLowerCase().includes('glad to hear') || c1.body.reply?.toLowerCase().includes('great'));

        const c2 = await post('/api/chatbot/query', { query: "Nice!" }, authRahul);
        assert('Nice! acknowledged', c2.body.reply?.toLowerCase().includes('glad to hear'));

        // -------------------------------------------------------------------------
        // 7. WHO ARE YOU?
        // -------------------------------------------------------------------------
        console.log('\n--- 7. Who are you? ---');
        const who = await post('/api/chatbot/query', { query: 'Who are you?' }, authRahul);
        assert('Status 200 OK', who.status === 200);
        assert('Identifies as SplitWise AI Assistant', who.body.reply?.includes('SplitWise AI Assistant'));
        assert('Tailored to Rahul Sharma', who.body.reply?.includes('Rahul Sharma'));

        // -------------------------------------------------------------------------
        // 8. WHAT CAN YOU DO? / HELP ME
        // -------------------------------------------------------------------------
        console.log('\n--- 8. What can you do? / Help me ---');
        const help = await post('/api/chatbot/query', { query: 'What can you do?' }, authRahul);
        assert('Status 200 OK', help.status === 200);
        assert('Includes expense splitting capability', help.body.reply?.includes('Add & Split Expenses'));
        assert('Includes balances and settlements', help.body.reply?.includes('Check Balances') || help.body.reply?.includes('Settle Payments'));

        // -------------------------------------------------------------------------
        // 9. GENERAL QUESTIONS (How does SplitWise work? How to add expense / settle / friend / group)
        // -------------------------------------------------------------------------
        console.log('\n--- 9. General Questions (App & Workflow Explanations) ---');
        const qApp = await post('/api/chatbot/query', { query: 'How does SplitWise work?' }, authRahul);
        assert('Explains app workflow (circles, expenses, ledger)', qApp.body.reply?.includes('How SplitWise Works'));

        const qAddExp = await post('/api/chatbot/query', { query: 'How do I add an expense?' }, authRahul);
        assert('Explains adding expense via assistant and manual form', qAddExp.body.reply?.includes('+ Add Expense') || qAddExp.body.reply?.includes('Add an expense'));

        const qSettle = await post('/api/chatbot/query', { query: 'How do I settle a payment?' }, authRahul);
        assert('Explains settling up', qSettle.body.reply?.includes('Settle Up'));

        const qFriend = await post('/api/chatbot/query', { query: 'How do I add a friend?' }, authRahul);
        assert('Explains adding friends', qFriend.body.reply?.includes('Friends') && qFriend.body.reply?.includes('user code'));

        const qGroup = await post('/api/chatbot/query', { query: 'How do I create a group?' }, authRahul);
        assert('Explains creating group', qGroup.body.reply?.includes('Create Group') || qGroup.body.reply?.includes('Create Circle'));

        const qLedger = await post('/api/chatbot/query', { query: 'Explain my ledger' }, authRahul);
        assert('Explains personal ledger breakdown', qLedger.body.reply?.includes('Personal Ledger Breakdown') && qLedger.body.reply?.includes('Net Ledger Position'));

        // -------------------------------------------------------------------------
        // 10. ENGLISH INSTRUCTION ("Add 4000 expense for me and Alex")
        // -------------------------------------------------------------------------
        console.log('\n--- 10. English Instruction ---');
        const enExp = await post('/api/chatbot/query', { query: 'Add 4000 expense for me and Alex in Goa Trip 2024' }, authRahul);
        assert('Understands English instruction with participants', enExp.body.toolCall?.params?.participants?.length === 2);
        assert('Amount is 4000', enExp.body.toolCall?.params?.amount === 4000);

        // -------------------------------------------------------------------------
        // 11. HINDI INSTRUCTION ("Alex aur mere beech 2000 split kar do")
        // -------------------------------------------------------------------------
        console.log('\n--- 11. Hindi Instruction ---');
        const hiExp = await post('/api/chatbot/query', { query: 'Alex aur mere beech 2000 split kar do in Goa Trip 2024' }, authRahul);
        assert('Understands Hindi instruction ("aur mere beech")', hiExp.body.toolCall?.params?.participants?.length === 2);
        assert('Amount is 2000', hiExp.body.toolCall?.params?.amount === 2000);
        assert('Each share is 1000', hiExp.body.toolCall?.params?.participants?.every(p => p.amount === 1000));

        // -------------------------------------------------------------------------
        // 12. GUJARATI INSTRUCTION ("Mara ane Alex vachche 4000 divide karo")
        // -------------------------------------------------------------------------
        console.log('\n--- 12. Gujarati Instruction ---');
        const guExp = await post('/api/chatbot/query', { query: 'Mara ane Alex vachche 4000 divide karo in Goa Trip 2024' }, authRahul);
        assert('Understands Gujarati instruction ("Mara ane Alex vachche")', guExp.body.toolCall?.params?.participants?.length === 2);
        assert('Amount is 4000', guExp.body.toolCall?.params?.amount === 4000);
        assert('Each share is 2000', guExp.body.toolCall?.params?.participants?.every(p => p.amount === 2000));

        // -------------------------------------------------------------------------
        // 13. ALL MEMBERS INSTRUCTION ("Badha group members vachche split karo")
        // -------------------------------------------------------------------------
        console.log('\n--- 13. All Members Multi-Lingual Instruction ---');
        const allExp = await post('/api/chatbot/query', { query: 'Badha group members vachche 5000 split karo in Goa Trip 2024' }, authRahul);
        assert('Includes all group members (5 members)', allExp.body.toolCall?.params?.participants?.length === 5);
        assert('Amount is 5000', allExp.body.toolCall?.params?.amount === 5000);

        // -------------------------------------------------------------------------
        // 14. CASUAL FOLLOW-UP CONVERSATION (Can you explain that, What happened, Cancel that)
        // -------------------------------------------------------------------------
        console.log('\n--- 14. Casual Follow-ups ---');
        const convFollow = 'conv_follow_' + Date.now();
        await post('/api/chatbot/query', { query: 'Show my latest expenses', conversation_id: convFollow }, authRahul);
        const expMore = await post('/api/chatbot/query', { query: 'Can you explain that?', conversation_id: convFollow }, authRahul);
        assert('Can you explain that gives conversational context', expMore.body.reply && !expMore.body.reply.includes('not trained'));

        const cancelOp = await post('/api/chatbot/query', { query: 'Cancel that', conversation_id: convFollow }, authRahul);
        assert('Cancel that cancels pending operation', cancelOp.body.reply?.toLowerCase().includes('cancelled'));

        // -------------------------------------------------------------------------
        // 15. MULTI-TURN CONVERSATIONAL EXPENSE CREATION (Section 6 Dialogue)
        // -------------------------------------------------------------------------
        console.log('\n--- 15. Multi-Turn Conversational Expense Creation ---');
        const convMulti = 'conv_multiturn_' + Date.now();
        // Turn 1: "Add an expense of ₹4,000 for me and Alex."
        const mTurn1 = await post('/api/chatbot/query', {
            query: 'Add an expense of ₹4,000 for me and Alex.',
            conversation_id: convMulti
        }, authRahul);
        assert('Turn 1 prompts for description', mTurn1.body.reply?.toLowerCase().includes('description') || mTurn1.body.reply?.includes('विवरण'));

        // Turn 2: "Dinner."
        const mTurn2 = await post('/api/chatbot/query', {
            query: 'Dinner.',
            conversation_id: convMulti
        }, authRahul);
        assert('Turn 2 confirms split details', mTurn2.body.reply?.includes('4,000') && mTurn2.body.reply?.includes('Alex'));
        assert('Turn 2 generates tool proposal', mTurn2.body.action === 'CONFIRM_TOOL');
        assert('Turn 2 toolCall has description "Dinner."', mTurn2.body.toolCall?.params?.description === 'Dinner.');

        // Turn 3: "Yes." (Affirmative execution)
        const mTurn3 = await post('/api/chatbot/query', {
            query: 'Yes.',
            conversation_id: convMulti
        }, authRahul);
        assert('Turn 3 executes confirmed expense in DB', (mTurn3.body.result?.expenseId > 0) || mTurn3.body.reply?.toLowerCase().includes('successfully'));

        // Turn 4: Saying "Yes" again must NOT duplicate the expense
        const mTurn4 = await post('/api/chatbot/query', {
            query: 'Yes.',
            conversation_id: convMulti
        }, authRahul);
        assert('Subsequent "Yes" does not duplicate creation', mTurn4.body.action !== 'CONFIRM_TOOL' && !mTurn4.body.result?.expenseId);

        // -------------------------------------------------------------------------
        // 16. USER-SPECIFIC GREETINGS
        // -------------------------------------------------------------------------
        console.log('\n--- 16. User-Specific Greetings ---');
        const uAlex = await post('/api/chatbot/query', { query: 'Hello!' }, authAlex);
        const uRahul = await post('/api/chatbot/query', { query: 'Hello!' }, authRahul);
        assert('Alex sees Alex in greeting', uAlex.body.reply?.includes('Alex'));
        assert('Rahul sees Rahul in greeting', uRahul.body.reply?.includes('Rahul'));
        assert('Greetings are distinct per user', uAlex.body.reply !== uRahul.body.reply);

        // -------------------------------------------------------------------------
        // 17. USER-SPECIFIC EXPENSE QUERIES & DATA ISOLATION
        // -------------------------------------------------------------------------
        console.log('\n--- 17. User-Specific Expense Queries ---');
        const expAlex = await post('/api/chatbot/query', { query: 'Show my latest expenses' }, authAlex);
        const expRahul = await post('/api/chatbot/query', { query: 'Show my latest expenses' }, authRahul);
        assert('Alex expense query returns 200 OK', expAlex.status === 200);
        assert('Rahul expense query returns 200 OK', expRahul.status === 200);

        // -------------------------------------------------------------------------
        // 18. MULTI-CURRENCY SUPPORT (Alex INR ₹ vs Priya USD $)
        // -------------------------------------------------------------------------
        console.log('\n--- 18. Multi-Currency Support (INR vs USD) ---');
        const rahulBal = await post('/api/chatbot/query', { query: 'Explain my ledger' }, authRahul);
        const priyaBal = await post('/api/chatbot/query', { query: 'Explain my ledger' }, authPriya);
        assert('Rahul (INR) ledger contains ₹ symbol', rahulBal.body.reply?.includes('₹'));
        assert('Priya (USD) ledger contains $ symbol', priyaBal.body.reply?.includes('$'));

        // -------------------------------------------------------------------------
        // 19. WHICH GROUP HAS HIGHEST SPENDING?
        // -------------------------------------------------------------------------
        console.log('\n--- 19. Highest Spending Group ---');
        const highGrp = await post('/api/chatbot/query', { query: 'Which group has the highest spending?' }, authRahul);
        assert('Status 200 OK', highGrp.status === 200);
        assert('Identifies top spending group', highGrp.body.reply?.includes('highest total spending') && highGrp.body.reply?.includes('Goa Trip 2024'));

        // -------------------------------------------------------------------------
        // 20. SECURITY & CROSS-USER SESSION HIJACKING PREVENTION
        // -------------------------------------------------------------------------
        console.log('\n--- 20. Cross-User Session Isolation ---');
        const rahulConv = 'rahul_private_conv_' + Date.now();
        await post('/api/chatbot/query', { query: 'Add an expense of ₹4,000 for me and Alex in Goa Trip 2024', conversation_id: rahulConv }, authRahul);

        // Priya attempts to use Rahul's conversation_id
        const hijackAttempt = await post('/api/chatbot/query', { query: 'What happened?', conversation_id: rahulConv }, authPriya);
        assert('Priya does not access Rahul private session state', hijackAttempt.body.conversation_id !== rahulConv || hijackAttempt.body.reply?.includes('No actions have been executed'));

        // -------------------------------------------------------------------------
        // 21. CONVERSATION HISTORY ISOLATION
        // -------------------------------------------------------------------------
        console.log('\n--- 21. Conversation History Isolation ---');
        const alexConv = 'alex_isolated_conv_' + Date.now();
        await post('/api/chatbot/query', { query: 'Good morning!', conversation_id: alexConv }, authAlex);
        const alexTurns = await post('/api/chatbot/query', { query: 'What happened?', conversation_id: alexConv }, authAlex);
        assert('Alex sees his own conversation turn', alexTurns.body.reply?.includes('Good morning'));

        // -------------------------------------------------------------------------
        // 22. PERSONALIZED SUGGESTIONS
        // -------------------------------------------------------------------------
        console.log('\n--- 22. Personalized Suggestions ---');
        const sug = await post('/api/chatbot/query', { query: 'What should I do?' }, authRahul);
        assert('Status 200 OK', sug.status === 200);
        assert('Generates personalized recommendations for Rahul', sug.body.reply?.includes('Personalized Recommendations for Rahul'));

        // Restore Priya's currency back to INR
        await pool.query("UPDATE users SET default_currency = 'INR' WHERE id = $1", [priya.id]);

        // Cleanup test expenses created during suite
        try {
            await pool.query("DELETE FROM expense_splits WHERE is_settled = false AND expense_id IN (SELECT id FROM expenses WHERE description = 'Dinner.' OR description LIKE '%Manual Parity%')");
            await pool.query("DELETE FROM expenses WHERE id NOT IN (SELECT DISTINCT expense_id FROM expense_splits) AND (description = 'Dinner.' OR description LIKE '%Manual Parity%')");
        } catch (cleanupErr) {
            // Ignore cleanup failure so suite result reflects assertions
        }

    } catch (err) {
        console.error('Test execution exception:', err);
        failed++;
    } finally {
        await pool.end();
    }

    console.log('\n========================================================================');
    console.log(`TOTAL CHECKS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log('========================================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

runSuite().catch(e => {
    console.error('Runner fatal:', e);
    process.exit(1);
});
