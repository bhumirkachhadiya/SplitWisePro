const fs = require('fs');

async function testConversationAssistant() {
    console.log('====================================================');
    console.log('  AI VOICE ASSISTANT & CONVERSATIONAL NLP TEST SUITE');
    console.log('====================================================');

    const BASE_URL = 'http://localhost:5000/api/chatbot/query';

    // 1. Natural Indian English: "How much do I need to give Rahul?"
    console.log('\n--- 1. Natural Indian English Debt Inquiry ---');
    let res = await fetch(BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'How much do I need to give Rahul?', language: 'en', user_id: 1 })
    });
    let data = await res.json();
    if (res.status === 200 && data.reply && (data.reply.includes('Rahul') || data.reply.includes('₹'))) {
        console.log('✅ PASSED: "How much do I need to give Rahul?" resolved accurately');
        console.log(`  Reply: "${data.reply}"`);
    } else {
        console.error('❌ FAILED: Debt inquiry', res.status, data);
        process.exit(1);
    }

    // 2. Direct Discovery: "Who owes me money?"
    console.log('\n--- 2. Direct Discovery: Who Owes Me Money ---');
    res = await fetch(BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'Who owes me money?', language: 'en', user_id: 1 })
    });
    data = await res.json();
    if (res.status === 200 && data.reply && (data.reply.includes('owes you') || data.reply.includes('Total') || data.reply.includes('cleared'))) {
        console.log('✅ PASSED: "Who owes me money?" resolved accurately');
        console.log(`  Reply: "${data.reply}"`);
    } else {
        console.error('❌ FAILED: Who owes me query', res.status, data);
        process.exit(1);
    }

    // 3. Instruction Query: "Split this equally between everyone"
    console.log('\n--- 3. Instruction: Split Equally Between Everyone ---');
    res = await fetch(BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'Split this equally between everyone', language: 'en', user_id: 1 })
    });
    data = await res.json();
    if (res.status === 200 && data.reply && data.reply.includes('Equal') && data.action === 'NAVIGATE' && data.view === 'add-expense') {
        console.log('✅ PASSED: "Split this equally between everyone" guided to Add Expense with Equal split explanation');
        console.log(`  Reply: "${data.reply}"`);
    } else {
        console.error('❌ FAILED: Split equally query', res.status, data);
        process.exit(1);
    }

    // 4. Timeframe Spend Query: "What did I spend last month?"
    console.log('\n--- 4. Timeframe Spend: What Did I Spend Last Month ---');
    res = await fetch(BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'What did I spend last month?', language: 'en', user_id: 1 })
    });
    data = await res.json();
    if (res.status === 200 && data.reply && data.reply.includes('₹') && data.action === 'NAVIGATE' && data.view === 'analytics') {
        console.log('✅ PASSED: "What did I spend last month?" computed spend and redirected to Analytics');
        console.log(`  Reply: "${data.reply}"`);
    } else {
        console.error('❌ FAILED: Spend last month query', res.status, data);
        process.exit(1);
    }

    // 5. Settlement Action Intent: "Settle my balance with Rahul"
    console.log('\n--- 5. Settlement Action Intent: Settle My Balance with Rahul ---');
    res = await fetch(BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'Settle my balance with Rahul', language: 'en', user_id: 1 })
    });
    data = await res.json();
    if (res.status === 200 && data.reply && data.reply.includes('Rahul') && (data.action === 'SETTLE_PEER' || (data.action === 'CONFIRM_TOOL' && data.toolCall?.action === 'RECORD_MANUAL_SETTLEMENT'))) {
        console.log('✅ PASSED: "Settle my balance with Rahul" triggered direct peer settlement flow');
        console.log(`  Reply: "${data.reply}"`);
    } else {
        console.error('❌ FAILED: Settle balance query', res.status, data);
        process.exit(1);
    }

    // 6. Multi-Turn Follow-Up Dialogue:
    // Turn 1: "Show my expenses" -> Turn 2: "Only for last month" -> Turn 3: "What about Rahul?"
    console.log('\n--- 6. Multi-Turn Context Memory Follow-Up Sequence ---');
    // Turn 1
    let t1Res = await fetch(BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'Show my expenses', language: 'en', user_id: 1 })
    });
    let t1Data = await t1Res.json();
    const convId = t1Data.conversation_id;
    if (t1Res.status === 200 && t1Data.action === 'NAVIGATE' && t1Data.view === 'expenses' && convId) {
        console.log(`  Turn 1 PASSED: Show my expenses (Conv ID: ${convId})`);
    } else {
        console.error('❌ FAILED: Turn 1 of multi-turn dialogue', t1Res.status, t1Data);
        process.exit(1);
    }

    // Turn 2
    let t2Res = await fetch(BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'Only for last month', language: 'en', user_id: 1, conversation_id: convId })
    });
    let t2Data = await t2Res.json();
    if (t2Res.status === 200 && t2Data.reply && t2Data.reply.includes('last month') && t2Data.reply.includes('₹')) {
        console.log(`  Turn 2 PASSED: Follow-up narrowed by timeframe ("Only for last month")`);
        console.log(`  Reply: "${t2Data.reply.split('\n')[0]}"`);
    } else {
        console.error('❌ FAILED: Turn 2 of multi-turn dialogue', t2Res.status, t2Data);
        process.exit(1);
    }

    // Turn 3
    let t3Res = await fetch(BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'What about Rahul?', language: 'en', user_id: 1, conversation_id: convId })
    });
    let t3Data = await t3Res.json();
    if (t3Res.status === 200 && t3Data.reply && t3Data.reply.includes('Rahul') && t3Data.action === 'SETTLE_PEER') {
        console.log(`  Turn 3 PASSED: Follow-up pivoted to peer context ("What about Rahul?")`);
        console.log(`  Reply: "${t3Data.reply}"`);
    } else {
        console.error('❌ FAILED: Turn 3 of multi-turn dialogue', t3Res.status, t3Data);
        process.exit(1);
    }

    // 7. Intelligent Fallback Sequence & Scope Guard
    console.log('\n--- 7. Intelligent Fallback & Scope Guard ---');
    let scopeRes = await fetch(BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'Tell me a joke about dogs', language: 'en', user_id: 1 })
    });
    let scopeData = await scopeRes.json();
    if (scopeRes.status === 200 && scopeData.reply.includes('trained exclusively on your SplitEase financial ledger')) {
        console.log('✅ PASSED: Non-project query provided helpful domain alternative');
    } else {
        console.error('❌ FAILED: Scope guard test', scopeRes.status, scopeData);
        process.exit(1);
    }

    console.log('\n====================================================');
    console.log('   🎉 ALL AI ASSISTANT CONVERSATION TESTS PASSED!   ');
    console.log('====================================================\n');
}

testConversationAssistant().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
});
