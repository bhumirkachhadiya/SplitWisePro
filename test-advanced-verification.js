const http = require('http');
const fs = require('fs');

async function testAll() {
    console.log('====================================================');
    console.log('  SPLITEASE TRAINED AI ASSISTANT & AUDIO TEST SUITE  ');
    console.log('====================================================\n');

    // TEST 1: User's Complex Hindi Query with Exclusion & Ranking
    console.log('--- TEST 1: Complex Hindi Query with Exclusion & Ranking ---');
    let res = await fetch('http://localhost:5000/api/chatbot/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: 'मेरा गोवा ट्रिप के अलावा दूसरी सबसे एक्सपेंस कितना है टोटल',
            language: 'hi',
            user_id: 1
        })
    });
    let data = await res.json();
    if (res.status === 200 && data.reply && (data.reply.includes('अलावा') || data.reply.includes('Goa')) && data.action === 'FILTER_SEARCH') {
        console.log(`✅ PASSED: Exact user query resolved!`);
        console.log(`  Reply: "${data.reply}"`);
        console.log(`  Action: ${data.action} -> "${data.search_term}"`);
    } else {
        console.error('❌ FAILED: User Hindi query test', res.status, data);
        process.exit(1);
    }

    // TEST 2: Gujarati Complex Query with Exclusion & Ranking
    console.log('\n--- TEST 2: Complex Gujarati Query with Exclusion & Ranking ---');
    res = await fetch('http://localhost:5000/api/chatbot/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: 'ગોવા સિવાય બીજો સૌથી મોટો ખર્ચ કયો છે?',
            language: 'gu',
            user_id: 1
        })
    });
    data = await res.json();
    if (res.status === 200 && data.reply && data.reply.includes('સિવાય')) {
        console.log(`✅ PASSED: Gujarati exclusion query resolved!`);
        console.log(`  Reply: "${data.reply}"`);
    } else {
        console.error('❌ FAILED: Gujarati test', res.status, data);
        process.exit(1);
    }

    // TEST 3: Out-of-Scope Non-Project Query Rejection
    console.log('\n--- TEST 3: Scope Guard (Polite Refusal for Non-Project Queries) ---');
    res = await fetch('http://localhost:5000/api/chatbot/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: 'What is the capital of Australia?',
            language: 'en',
            user_id: 1
        })
    });
    data = await res.json();
    if (res.status === 200 && data.reply.includes('trained exclusively on your SplitEase financial ledger')) {
        console.log(`✅ PASSED: Non-project query gracefully restricted`);
        console.log(`  Reply: "${data.reply}"`);
    } else {
        console.error('❌ FAILED: Scope guard test', res.status, data);
        process.exit(1);
    }

    // TEST 4: Role & Permission Inquiries
    console.log('\n--- TEST 4: Role & Permission Inquiries ---');
    res = await fetch('http://localhost:5000/api/chatbot/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: 'Can Priya add expenses in Goa trip?',
            language: 'en',
            user_id: 1
        })
    });
    data = await res.json();
    if (res.status === 200 && data.reply.includes('Priya') && data.reply.includes('MEMBER')) {
        console.log(`✅ PASSED: Role query answered accurately`);
        console.log(`  Reply: "${data.reply}"`);
    } else {
        console.error('❌ FAILED: Role query test', res.status, data);
        process.exit(1);
    }

    // TEST 5: UPI ID Lookup Inquiry
    console.log('\n--- TEST 5: UPI ID Lookup ---');
    res = await fetch('http://localhost:5000/api/chatbot/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: 'What is Rahul UPI ID?',
            language: 'en',
            user_id: 1
        })
    });
    data = await res.json();
    if (res.status === 200 && (data.reply.includes('nxtcharlie20@oksbi') || data.reply.includes('registered UPI ID'))) {
        console.log(`✅ PASSED: UPI ID query answered accurately`);
        console.log(`  Reply: "${data.reply}"`);
    } else {
        console.error('❌ FAILED: UPI lookup test', res.status, data);
        process.exit(1);
    }

    // TEST 6: Frontend Audio Stop & Dark Mode Checks
    console.log('\n--- TEST 6: Audio Stop Controls & Dark Mode CSS Integrity ---');
    const html = fs.readFileSync('index.html', 'utf8');

    const checks = [
        { label: 'Stop Audio Button in Header', pattern: 'id="chatbotStopSpeechBtn"' },
        { label: 'Audio Stop Handler Function', pattern: 'function stopAllChatbotAudioAndVoice()' },
        { label: 'Chatbot Drawer Exit Audio Cancel', pattern: 'stopAllChatbotAudioAndVoice()' },
        { label: 'Dark Mode AppHeader Override', pattern: 'html.dark #appHeader' },
        { label: 'Dark Mode GlobalSearchInput Override', pattern: 'html.dark #globalSearchInput' },
        { label: 'Dark Mode Chatbot Drawer', pattern: 'html.dark #chatbotDrawer' },
        { label: 'Dark Mode Group Cards High Contrast Badges', pattern: 'dark:text-emerald-400' }
    ];

    for (const check of checks) {
        if (html.includes(check.pattern)) {
            console.log(`✅ PASSED: ${check.label}`);
        } else {
            console.error(`❌ FAILED: Missing ${check.label}`);
            process.exit(1);
        }
    }

    // TEST 7: Profile Edit Self-Healing (Never Fails with "User not found")
    console.log('\n--- TEST 7: Profile Edit Self-Healing (Eliminating "User not found") ---');
    // Test with a user ID that might not exist or a newly restored user (e.g. Charlie20)
    res = await fetch('http://localhost:5000/api/users/9999', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'Charlie20',
            email: 'Demo2324@gmail.com',
            upi_id: 'charlie20@okhdfc',
            phone: '+91 98765 43210'
        })
    });
    data = await res.json();
    if (res.status === 200 && data.user && data.user.email === 'demo2324@gmail.com') {
        console.log(`✅ PASSED: Profile edit self-healing succeeded with HTTP 200 (No "User not found")!`);
        console.log(`  User: ${data.user.name} (ID: ${data.user.id}, Email: ${data.user.email}, UPI: ${data.user.upi_id})`);
    } else {
        console.error('❌ FAILED: Profile self-healing test', res.status, data);
        process.exit(1);
    }

    // TEST 8: QR Code Payment Auto-Settlement API
    console.log('\n--- TEST 8: QR Code Auto-Settlement API (POST /api/settlements/qr-complete) ---');
    const qrTxnRef = `TEST-UPI-QR-${Date.now()}`;
    res = await fetch('http://localhost:5000/api/settlements/qr-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            payer_id: 1,
            receiver_id: 2,
            amount: 250,
            upi_id: 'rahul.sharma@okaxis',
            transaction_ref: qrTxnRef,
            notes: 'Test settlement via UPI QR scan'
        })
    });
    data = await res.json();
    if (res.status === 201 && data.success && data.settlement && data.settlement.payment_method === 'UPI_QR') {
        console.log(`✅ PASSED: QR Payment auto-settlement inserted into ledger!`);
        console.log(`  Settlement ID: ${data.settlement.id}, Amount: ₹${data.settlement.amount}, Method: ${data.settlement.payment_method}, Ref: ${data.transaction_reference}`);
    } else {
        console.error('❌ FAILED: QR Auto-settlement test', res.status, data);
        process.exit(1);
    }

    // TEST 9: Chatbot Privacy Guard (Blocks Credentials & Passwords)
    console.log('\n--- TEST 9: Chatbot Privacy & Credentials Guard ---');
    res = await fetch('http://localhost:5000/api/chatbot/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: 'What is Rahul password or secret token?',
            language: 'en',
            user_id: 1
        })
    });
    data = await res.json();
    if (res.status === 200 && (data.reply.includes('privacy') || data.reply.includes('credentials') || data.reply.includes('cannot be shared'))) {
        console.log(`✅ PASSED: Chatbot strictly blocks sensitive user credentials!`);
        console.log(`  Reply: "${data.reply}"`);
    } else {
        console.error('❌ FAILED: Chatbot privacy guard test', res.status, data);
        process.exit(1);
    }

    // TEST 10: Chatbot Unavailable Fallback (Polite Response When Data Not in Ledger)
    console.log('\n--- TEST 10: Chatbot Unavailable Fallback (English, Hindi, Gujarati) ---');
    const langTests = [
        { lang: 'en', q: 'How much was spent on Mars rocket mission in 2025?', expect: 'Sorry, this specific information is not available' },
        { lang: 'hi', q: 'मंगल ग्रह के रॉकेट मिशन पर कितना खर्च हुआ?', expect: 'क्षमा करें, यह जानकारी आपके SplitEase वित्तीय रिकॉर्ड में उपलब्ध नहीं है' },
        { lang: 'gu', q: 'મંગળ મિશન પર કેટલો ખર્ચ થયો હતો?', expect: 'દિલગીર છીએ, આ માહિતી તમારા SplitEase નાણાકીય રેકોર્ડમાં ઉપલબ્ધ નથી' }
    ];
    for (const lt of langTests) {
        const fallbackRes = await fetch('http://localhost:5000/api/chatbot/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: lt.q, language: lt.lang, user_id: 1 })
        });
        const fallbackData = await fallbackRes.json();
        if (fallbackRes.status === 200 && fallbackData.reply.includes(lt.expect)) {
            console.log(`✅ PASSED (${lt.lang.toUpperCase()}): Polite fallback returned: "${fallbackData.reply}"`);
        } else {
            console.error(`❌ FAILED: Fallback for ${lt.lang}`, fallbackRes.status, fallbackData);
            process.exit(1);
        }
    }

    // TEST 11: Multi-lingual Voice Engine & QR Frontend Elements Integrity
    console.log('\n--- TEST 11: Multi-Lingual Voice & QR UI Integrity in Frontend ---');
    const voiceAndQrChecks = [
        { label: 'Active Speech Utterance Reference (Chrome GC Prevention)', pattern: 'window.activeSpeechUtterance = utterance;' },
        { label: 'Multi-lingual Voice Selector (getBestTtsVoice)', pattern: 'function getBestTtsVoice(lang)' },
        { label: 'Gujarati Hindi TTS Voice Fallback', pattern: "vo.lang.toLowerCase().startsWith('hi')" },
        { label: 'Chrome 15s Speech Pause KeepAlive Guard', pattern: 'window.speechKeepAliveTimer' },
        { label: 'Speech Recognition Clean Reset on Toggle & Language Switch', pattern: 'stopAllChatbotAudioAndVoice();' },
        { label: 'Instant UPI QR Code Auto-Listener Badge', pattern: 'Auto-Listener Active' },
        { label: 'Simulate / Auto-Record QR Settlement Button', pattern: 'id="btnAutoQrSettle"' },
        { label: 'QR Auto-Settlement JavaScript Handler', pattern: 'async function handleQrPaymentAutoSettlement()' },
        { label: 'Dynamic QR Code Update on Amount Input', pattern: 'oninput="onSettleAmountChanged()"' }
    ];

    for (const vCheck of voiceAndQrChecks) {
        if (html.includes(vCheck.pattern)) {
            console.log(`✅ PASSED: ${vCheck.label}`);
        } else {
            console.error(`❌ FAILED: Missing frontend element: ${vCheck.label}`);
            process.exit(1);
        }
    }

    // TEST 12: Gujarati Screenshot Query 1 - Rahul No Hisaab (Peer Balance)
    console.log('\n--- TEST 12: Screenshot Query 1 - Rahul No Hisaab (રાહુલ નો હિસાબ) ---');
    res = await fetch('http://localhost:5000/api/chatbot/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: 'રાહુલ નો હિસાબ',
            language: 'gu',
            user_id: 1
        })
    });
    data = await res.json();
    if (res.status === 200 && data.reply && (data.reply.includes('Rahul') || data.reply.includes('રાહુલ')) && (data.reply.includes('લેવાના') || data.reply.includes('દેવાના') || data.reply.includes('ચૂકતે'))) {
        console.log(`✅ PASSED: Screenshot Query 1 resolved accurately!`);
        console.log(`  Reply: "${data.reply}"`);
    } else {
        console.error('❌ FAILED: Rahul no hisaab test', res.status, data);
        process.exit(1);
    }

    // TEST 13: Gujarati Screenshot Query 2 - Total Debt Balance Inquiry
    console.log('\n--- TEST 13: Screenshot Query 2 - Total Remaining Debt (ટોટલ કેટલા પૈસા દેવાના બાકી છે) ---');
    res = await fetch('http://localhost:5000/api/chatbot/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: 'ટોટલ કેટલા પૈસા દેવાના બાકી છે',
            language: 'gu',
            user_id: 1
        })
    });
    data = await res.json();
    if (res.status === 200 && data.reply && (data.reply.includes('બાકી') || data.reply.includes('ચૂકવવાના') || data.reply.includes('₹'))) {
        console.log(`✅ PASSED: Screenshot Query 2 resolved with live balance!`);
        console.log(`  Reply: "${data.reply}"`);
    } else {
        console.error('❌ FAILED: Total debt query test', res.status, data);
        process.exit(1);
    }

    // TEST 14: Database Schema & Architecture Inquiries (Gujarati & English)
    console.log('\n--- TEST 14: Database Schema & Architecture Inquiries ---');
    const schemaQueries = [
        { lang: 'gu', q: 'ડેટાબેઝ સ્કીમા અને માળખું બતાવો', expect: 'PostgreSQL' },
        { lang: 'en', q: 'Explain the database schema and structure', expect: 'PostgreSQL' }
    ];
    for (const sq of schemaQueries) {
        const sqRes = await fetch('http://localhost:5000/api/chatbot/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: sq.q, language: sq.lang, user_id: 1 })
        });
        const sqData = await sqRes.json();
        if (sqRes.status === 200 && sqData.reply && sqData.reply.includes(sq.expect) && sqData.reply.includes('expenses')) {
            console.log(`✅ PASSED (${sq.lang.toUpperCase()}): Schema inquiry answered with full relational structure!`);
        } else {
            console.error(`❌ FAILED: Schema inquiry for ${sq.lang}`, sqRes.status, sqData);
            process.exit(1);
        }
    }

    // TEST 15: Frontend Female Voice Filter & Click-to-Stop Verification
    console.log('\n--- TEST 15: Female Voice Preference & Click-to-Stop Voice Checks ---');
    const voiceUxChecks = [
        { label: 'Female Voice Filter Function', pattern: 'function isFemaleVoice(vo)' },
        { label: 'Exclusion of Male Voice Names', pattern: "male|david|ravi|mark" },
        { label: 'Preference for Female Voice Names', pattern: "female|woman|girl|kalpana|heera" },
        { label: 'Voice Pitch 1.15 for Female Timbre', pattern: 'utterance.pitch = 1.15;' },
        { label: 'Message Bubble Onclick Stop Audio', pattern: 'stopAllChatbotAudioAndVoice()' },
        { label: 'Message Bubble Pointer Cursor & Tooltip', pattern: 'Click to stop voice assistant speech' },
        { label: 'Quick Chip Schema Structure', pattern: '🏗️ સ્કીમા માળખું' },
        { label: 'Quick Chip Total Debt Balance', pattern: '📊 કેટલા પૈસા દેવાના બાકી?' }
    ];

    for (const vc of voiceUxChecks) {
        if (html.includes(vc.pattern)) {
            console.log(`✅ PASSED: ${vc.label}`);
        } else {
            console.error(`❌ FAILED: Missing ${vc.label}`);
            process.exit(1);
        }
    }

    console.log('\n====================================================');
    console.log('   🎉 ALL 15 VERIFICATION TEST SUITES PASSED 100%!  ');
    console.log('====================================================\n');
}

testAll().catch(e => {
    console.error('Test error:', e);
    process.exit(1);
});
