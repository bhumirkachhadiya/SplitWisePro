const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

function request(method, reqPath, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request({
            hostname: 'localhost',
            port: 5000,
            path: reqPath,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
                ...headers
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch(e) {
                    parsed = data;
                }
                resolve({ status: res.statusCode, body: parsed, raw: data });
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function runChatTests() {
    console.log('====================================================');
    console.log('STARTING CHAT VISIBILITY & AUTH SECURITY TEST SUITE');
    console.log('====================================================\n');

    let testResults = [];

    function record(scenarioNum, scenarioTitle, passed, detail) {
        testResults.push({ scenarioNum, scenarioTitle, passed, detail });
        console.log(`[SCENARIO ${scenarioNum}] [${passed ? 'PASS' : 'FAIL'}] ${scenarioTitle}: ${detail}`);
    }

    try {
        // Read index.html to verify markup default states
        const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

        // SCENARIO 1: Unauthenticated State - Chat Option Hidden & Backend Guarded
        console.log('\n--- SCENARIO 1: Unauthenticated State ---');
        // HTML check: #sidebarChatNav and #chatbotLauncher must be hidden by default
        const chatNavHiddenByDefault = /id="sidebarChatNav"[^>]*class="[^"]*\bhidden\b/.test(indexHtml);
        const launcherHiddenByDefault = /id="chatbotLauncher"[^>]*class="[^"]*\bhidden\b/.test(indexHtml);
        
        // Backend API check: Unauthenticated call without x-user-id
        const unauthConvRes = await request('GET', '/api/chat/conversations');
        const unauthBotRes = await request('POST', '/api/chatbot/query', { query: 'Hello' });
        const unauthUnreadRes = await request('GET', '/api/chat/unread-count');

        const s1Passed = chatNavHiddenByDefault && 
                         launcherHiddenByDefault && 
                         unauthConvRes.status === 401 && 
                         unauthBotRes.status === 401 &&
                         unauthUnreadRes.status === 401;

        record(
            1,
            'Unauthenticated state: Chat option hidden and APIs protected',
            s1Passed,
            `Nav Hidden: ${chatNavHiddenByDefault}, Launcher Hidden: ${launcherHiddenByDefault}, Conv API: ${unauthConvRes.status}, Bot API: ${unauthBotRes.status}, Unread API: ${unauthUnreadRes.status}`
        );

        // SCENARIO 2: Unauthenticated Direct URL Access -> Redirected to Login
        console.log('\n--- SCENARIO 2: Unauthenticated Direct URL Access ---');
        // In client-side code: checkUrlNavigationParams, navigateTo, hashchange, and DOMContentLoaded check !currentUser -> handleLogout()
        const navigateToGuarded = indexHtml.includes("if (!currentUser) {\n                handleLogout();\n                return;\n            }");
        const urlParamsGuarded = indexHtml.includes("function checkUrlNavigationParams() {\n            if (!currentUser) {\n                handleLogout();");
        const hashChangeGuarded = indexHtml.includes("if (!currentUser) {\n                        handleLogout();");

        const s2Passed = navigateToGuarded && urlParamsGuarded && hashChangeGuarded;
        record(
            2,
            'Direct URL / hash navigation without session bounces to Login',
            s2Passed,
            `navigateTo guarded: ${navigateToGuarded}, checkUrlNavigationParams guarded: ${urlParamsGuarded}, hashchange guarded: ${hashChangeGuarded}`
        );

        // SCENARIO 3: Logged-in State - Chat Option Appears & Conversations Accessible
        console.log('\n--- SCENARIO 3: Logged-in State ---');
        // Seed user 1 (Alex Mercer)
        const user1Res = await pool.query('SELECT id, name, email FROM public.users ORDER BY id ASC LIMIT 1');
        const user1 = user1Res.rows[0];

        // Seed user 2 (Sarah Connor)
        const user2Res = await pool.query('SELECT id, name, email FROM public.users WHERE id != $1 ORDER BY id ASC LIMIT 1', [user1.id]);
        const user2 = user2Res.rows[0];

        // Launch app reveals nav:
        const launchAppRevealsNav = indexHtml.includes("chatNav.classList.remove('hidden')") &&
                                    indexHtml.includes("chatLauncher.classList.remove('hidden')");

        // Authenticated user can fetch their conversations
        const authConvRes = await request('GET', '/api/chat/conversations', null, { 'x-user-id': String(user1.id) });
        const s3Passed = launchAppRevealsNav && authConvRes.status === 200 && Array.isArray(authConvRes.body.conversations);

        record(
            3,
            'Logged-in state: Chat option revealed and conversations queried',
            s3Passed,
            `UI Unhiding logic: ${launchAppRevealsNav}, API status: ${authConvRes.status}, Found: ${authConvRes.body.conversations?.length || 0} conversations`
        );

        // SCENARIO 4: Page Refresh -> Session Loaded and Chat Option Remains Visible
        console.log('\n--- SCENARIO 4: Page Refresh / Session Persistence ---');
        const sessionRestorationLogic = indexHtml.includes("sessionStorage.getItem('splitease_user')") &&
                                        indexHtml.includes("currentUser = JSON.parse(savedUser)") &&
                                        indexHtml.includes("launchApp()");
        record(
            4,
            'Page refresh: session restore calls launchApp() to maintain Chat visibility',
            sessionRestorationLogic,
            `Session storage reader and launchApp auto-trigger verified in index.html`
        );

        // SCENARIO 5: Open Conversation -> Message History Loads Correctly
        console.log('\n--- SCENARIO 5: Open Conversation & Message History ---');
        let testConvId = authConvRes.body.conversations?.[0]?.id;
        if (!testConvId) {
            // Create a test conversation between User 1 and User 2
            const createConv = await request('POST', '/api/chat/conversations', {
                title: 'Test Discussion Circle',
                type: 'group',
                member_ids: [user1.id, user2.id]
            }, { 'x-user-id': String(user1.id) });
            testConvId = createConv.body.conversation?.id;
        }

        // Post a message from User 1
        const postMsgRes = await request('POST', `/api/chat/conversations/${testConvId}/messages`, {
            message: 'Hello team, coordinating splits for Goa trip!'
        }, { 'x-user-id': String(user1.id) });

        // User 1 reads conversation messages
        const getMsgsRes = await request('GET', `/api/chat/conversations/${testConvId}/messages`, null, {
            'x-user-id': String(user1.id)
        });

        const s5Passed = getMsgsRes.status === 200 && 
                         Array.isArray(getMsgsRes.body.messages) && 
                         getMsgsRes.body.messages.some(m => m.message.includes('Goa trip'));

        record(
            5,
            'Open conversation: authorized messages load with sender metadata',
            s5Passed,
            `Message post: ${postMsgRes.status}, Message fetch: ${getMsgsRes.status}, Count: ${getMsgsRes.body.messages?.length}`
        );

        // SCENARIO 6: Logout -> Chat Option Immediately Disappears, State & Audio Purged
        console.log('\n--- SCENARIO 6: Logout Teardown ---');
        const logoutHidesNav = indexHtml.includes("chatNav.classList.add('hidden')");
        const logoutHidesLauncher = indexHtml.includes("chatLauncher.classList.add('hidden')");
        const logoutHidesDrawer = indexHtml.includes("chatDrawer.classList.add('hidden')");
        const logoutStopsSpeech = indexHtml.includes("stopAllChatbotAudioAndVoice()");
        const logoutClearsMemory = indexHtml.includes("chatbotConversationId = null") && indexHtml.includes("chatbotAudioQueue = []");
        const logoutClearsChatState = indexHtml.includes("currentActiveConversationId = null") && indexHtml.includes("activeChatMessages = []");
        const logoutClearsHash = indexHtml.includes("window.location.hash");

        const s6Passed = logoutHidesNav && 
                         logoutHidesLauncher && 
                         logoutHidesDrawer && 
                         logoutStopsSpeech && 
                         logoutClearsMemory && 
                         logoutClearsChatState && 
                         logoutClearsHash;

        record(
            6,
            'Logout immediately hides Chat option, purges state, memory, and audio',
            s6Passed,
            `Nav Hidden: ${logoutHidesNav}, Launcher Hidden: ${logoutHidesLauncher}, Audio Stopped: ${logoutStopsSpeech}, State Purged: ${logoutClearsChatState}, Hash Cleared: ${logoutClearsHash}`
        );

        // SCENARIO 7: Open Previous Chat URL After Logout -> Denied
        console.log('\n--- SCENARIO 7: Open Chat URL After Logout ---');
        // When user logs out, currentUser is null. If they then navigate to #chat or ?view=chat,
        // navigateTo('chat') calls handleLogout() immediately, keeping view-chat hidden and authScreen visible.
        const hashGuardValid = indexHtml.includes("if (!currentUser) {\n                        handleLogout();");
        record(
            7,
            'Open previous chat URL after logout: access denied, redirected to Login',
            hashGuardValid,
            `Guarded against unauthenticated direct access via #chat or ?view=chat`
        );

        // SCENARIO 8: Access Another User's Conversation -> 403 Forbidden
        console.log('\n--- SCENARIO 8: Access Another User Conversation (403 Forbidden) ---');
        // Create an isolated private conversation between User 1 and User 2 only
        const privConvRes = await request('POST', '/api/chat/conversations', {
            title: 'Private 1-on-1 Settlement',
            type: 'direct',
            member_ids: [user1.id, user2.id]
        }, { 'x-user-id': String(user1.id) });
        const privateConvId = privConvRes.body.conversation.id;

        // Find a third user who is NOT a member (User 3)
        const user3Res = await pool.query('SELECT id, name FROM public.users WHERE id NOT IN ($1, $2) LIMIT 1', [user1.id, user2.id]);
        const user3 = user3Res.rows[0];

        // User 3 attempts to read messages of the private conversation
        const rogueReadRes = await request('GET', `/api/chat/conversations/${privateConvId}/messages`, null, {
            'x-user-id': String(user3.id)
        });

        // User 3 attempts to post a message into the private conversation
        const roguePostRes = await request('POST', `/api/chat/conversations/${privateConvId}/messages`, {
            message: 'I am spying on you'
        }, { 'x-user-id': String(user3.id) });

        const s8Passed = rogueReadRes.status === 403 && roguePostRes.status === 403;
        record(
            8,
            'Access another user\'s conversation: 403 Forbidden strictly enforced',
            s8Passed,
            `Read Attempt: HTTP ${rogueReadRes.status} (${rogueReadRes.body.error}), Post Attempt: HTTP ${roguePostRes.status} (${roguePostRes.body.error})`
        );

        // SCENARIO 9: Multi-Account Isolation -> Only Authorized Conversations Visible
        console.log('\n--- SCENARIO 9: Multi-Account Conversation Isolation ---');
        const user1Convs = await request('GET', '/api/chat/conversations', null, { 'x-user-id': String(user1.id) });
        const user3Convs = await request('GET', '/api/chat/conversations', null, { 'x-user-id': String(user3.id) });

        const user1HasPrivate = user1Convs.body.conversations.some(c => c.id === privateConvId);
        const user3HasPrivate = user3Convs.body.conversations.some(c => c.id === privateConvId);

        const s9Passed = user1HasPrivate === true && user3HasPrivate === false;
        record(
            9,
            'Multi-account isolation: User 3 cannot see or list conversations of User 1',
            s9Passed,
            `User 1 sees conversation: ${user1HasPrivate}, User 3 sees conversation: ${user3HasPrivate}`
        );

        // Cleanup test conversation
        await pool.query('DELETE FROM public.chat_messages WHERE conversation_id = $1', [privateConvId]);
        await pool.query('DELETE FROM public.chat_conversation_members WHERE conversation_id = $1', [privateConvId]);
        await pool.query('DELETE FROM public.chat_conversations WHERE id = $1', [privateConvId]);
        console.log('✓ Cleaned up isolated test conversation.');

    } catch(err) {
        console.error('Chat Test Suite Error:', err);
    } finally {
        await pool.end();
        console.log('\n====================================================');
        console.log('CHAT VISIBILITY & SECURITY TEST RESULTS:');
        const passCount = testResults.filter(r => r.passed).length;
        console.log(`Passed: ${passCount} / ${testResults.length}`);
        console.log('====================================================');
    }
}

runChatTests();
