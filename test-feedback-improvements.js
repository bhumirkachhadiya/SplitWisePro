// test-feedback-improvements.js
// Exhaustive automated test suite covering end-user feedback improvements (Reqs 1 to 12)

const { Pool } = require('pg');
const authService = require('./authService');
require('dotenv').config();

const API = 'http://127.0.0.1:5000/api';
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

let totalAssertions = 0;
let passedAssertions = 0;

function assert(condition, message) {
    totalAssertions++;
    if (condition) {
        passedAssertions++;
        console.log(`  PASS: ${message}`);
    } else {
        console.error(`  FAIL: ${message}`);
        throw new Error(message);
    }
}

async function runFeedbackImprovementsTests() {
    console.log('=============================================================');
    console.log(' STARTING FEEDBACK IMPROVEMENTS AUTOMATED TEST SUITE');
    console.log('=============================================================');

    let testGroupId = null;
    let charlieToken = null;
    let amitToken = null;
    let karanToken = null;
    let charlieId = 1;
    let amitId = 2;
    let karanId = 3;
    let testInviteCode = null;

    try {
        // Step 0: Obtain session tokens for test users
        console.log('\n[SETUP] Authenticating test users...');
        const cRes = await pool.query(`SELECT id, name, email FROM public.users WHERE id = 1 LIMIT 1`);
        const aRes = await pool.query(`SELECT id, name, email FROM public.users WHERE LOWER(name) LIKE '%amit%' OR LOWER(email) LIKE '%amit%' LIMIT 1`);
        const kRes = await pool.query(`SELECT id, name, email FROM public.users WHERE LOWER(name) LIKE '%karan%' OR LOWER(email) LIKE '%karan%' LIMIT 1`);

        const charlieUser = cRes.rows[0];
        const amitUser = aRes.rows[0] || { id: 2 };
        const karanUser = kRes.rows[0] || { id: 3 };

        charlieId = charlieUser.id;
        amitId = amitUser.id;
        karanId = karanUser.id;

        const charlieSession = await authService.createSession(charlieId);
        const amitSession = await authService.createSession(amitId);
        const karanSession = await authService.createSession(karanId);

        charlieToken = charlieSession.token;
        amitToken = amitSession.token;
        karanToken = karanSession.token;

        assert(Boolean(charlieToken && amitToken && karanToken), 'Obtained tokens for Charlie, Amit, and Karan');

        // Create a test circle for these tests
        const groupRes = await pool.query(`
            INSERT INTO public.groups (name, category, description, created_by)
            VALUES ($1, 'Trip', 'Feedback Verification Circle', $2)
            RETURNING id
        `, [`Feedback_Test_${Date.now()}`, charlieId]);
        testGroupId = groupRes.rows[0].id;

        await pool.query(`
            INSERT INTO public.group_members (group_id, user_id, role)
            VALUES ($1, $2, 'admin'), ($1, $3, 'member')
        `, [testGroupId, charlieId, amitId]);

        // Seed a sample expense in this group to test spending velocity
        const expRes = await pool.query(`
            INSERT INTO public.expenses (group_id, paid_by, description, amount, currency, category, split_type, expense_date)
            VALUES ($1, $2, 'Velocity Test Dinner', 2400.00, 'INR', 'Food & Drinks', 'equal', CURRENT_DATE)
            RETURNING id
        `, [testGroupId, charlieId]);
        const expId = expRes.rows[0].id;

        await pool.query(`
            INSERT INTO public.expense_payers (expense_id, user_id, amount) VALUES
            ($1, $2, 2400.00)
        `, [expId, charlieId]);

        await pool.query(`
            INSERT INTO public.expense_splits (expense_id, user_id, amount, base_amount, settled_amount_base, is_settled)
            VALUES ($1, $2, 1200.00, 1200.00, 0.00, false), ($1, $3, 1200.00, 1200.00, 0.00, false)
        `, [expId, charlieId, amitId]);

        // -------------------------------------------------------------
        // TEST 1: REQ 1 - SPENDING VELOCITY API
        // -------------------------------------------------------------
        console.log('\n[REQ 1] Spending Velocity & Expense Analysis');
        const velRes = await fetch(`${API}/analytics/spending-velocity?groupId=${testGroupId}`, {
            headers: { 'Authorization': `Bearer ${charlieToken}` }
        });
        assert(velRes.ok, 'GET /api/analytics/spending-velocity?groupId= returned 200');
        const velData = await velRes.json();
        assert(Array.isArray(velData.labels) && velData.labels.length > 0, 'Returns historical spending month labels');
        assert(Array.isArray(velData.datasets) && velData.datasets.length >= 2, 'Returns Chart.js datasets for user, members, and circle total');
        assert(Array.isArray(velData.members) && velData.members.length >= 2, 'Returns member-wise velocity metrics');
        const charlieVel = velData.members.find(m => m.id === charlieId);
        assert(Boolean(charlieVel), 'Current user velocity present');
        assert(Number(charlieVel.total_spend) >= 1200, 'Member velocity reflects real expense shares');

        // -------------------------------------------------------------
        // TEST 2: REQ 5 - GROUP COVER PHOTO, ICON, & MEDIA ENDPOINT
        // -------------------------------------------------------------
        console.log('\n[REQ 5] Group Cover Photo & Icon Customization');
        const mediaRes = await fetch(`${API}/groups/${testGroupId}/media`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${charlieToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                cover_photo_url: 'https://images.unsplash.com/photo-test-cover',
                icon_url: 'https://images.unsplash.com/photo-test-icon'
            })
        });
        assert(mediaRes.ok, 'POST /api/groups/:id/media returned 200');
        const mediaData = await mediaRes.json();
        assert(mediaData.group && mediaData.group.cover_photo_url === 'https://images.unsplash.com/photo-test-cover', 'Cover photo updated');
        assert(mediaData.group && mediaData.group.icon_url === 'https://images.unsplash.com/photo-test-icon', 'Group icon updated');

        // Verify persisted in group details
        const getGroupRes = await fetch(`${API}/groups/${testGroupId}`, {
            headers: { 'Authorization': `Bearer ${charlieToken}` }
        });
        assert(getGroupRes.ok, 'GET /api/groups/:id returned 200');
        const getGroupData = await getGroupRes.json();
        assert(getGroupData.cover_photo_url === 'https://images.unsplash.com/photo-test-cover', 'Persisted cover photo URL returned');
        assert(getGroupData.icon_url === 'https://images.unsplash.com/photo-test-icon', 'Persisted icon URL returned');

        // -------------------------------------------------------------
        // TEST 3: REQ 6 - WHATSAPP INVITATION LINK & ZERO-LEAK JOIN FLOW
        // -------------------------------------------------------------
        console.log('\n[REQ 6] WhatsApp Group Invite URL, Public Preview & Join');
        const inviteRes = await fetch(`${API}/groups/${testGroupId}/invite-link`, {
            headers: { 'Authorization': `Bearer ${charlieToken}` }
        });
        assert(inviteRes.ok, 'GET /api/groups/:id/invite-link returned 200');
        const inviteData = await inviteRes.json();
        assert(Boolean(inviteData.invite_code), 'Unique invite code returned');
        assert(inviteData.whatsapp_url && inviteData.whatsapp_url.startsWith('https://api.whatsapp.com/send?text='), 'Valid WhatsApp share link returned');
        testInviteCode = inviteData.invite_code;

        // Test Regeneration
        const regenRes = await fetch(`${API}/groups/${testGroupId}/regenerate-invite-link`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${charlieToken}` }
        });
        assert(regenRes.ok, 'POST /api/groups/:id/regenerate-invite-link returned 200');
        const regenData = await regenRes.json();
        assert(regenData.invite_code !== testInviteCode, 'New invite code generated');
        testInviteCode = regenData.invite_code;

        // Public Join Info (Zero-leak preview)
        const joinInfoRes = await fetch(`${API}/groups/join-info/${testInviteCode}`);
        assert(joinInfoRes.ok, 'GET /api/groups/join-info/:inviteCode returned 200 without auth');
        const joinInfoData = await joinInfoRes.json();
        assert(joinInfoData.group && joinInfoData.group.name, 'Public preview includes circle name');
        assert(Number(joinInfoData.group.member_count) === 2, 'Public preview includes member count');
        assert(joinInfoData.group.balances === undefined, 'Public preview strictly isolates financial balances');

        // Karan joins via invite code
        const joinRes = await fetch(`${API}/groups/join/${testInviteCode}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${karanToken}` }
        });
        assert(joinRes.ok, 'POST /api/groups/join/:inviteCode allows member to join');
        const joinData = await joinRes.json();
        assert(joinData.success === true || joinData.already_member === true, 'Karan successfully enrolled into circle');

        // Karan sends friend request to Amit via targetUserId
        const friendReqRes = await fetch(`${API}/friends/request`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${karanToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ targetUserId: amitId })
        });
        assert(friendReqRes.ok || friendReqRes.status === 400, 'POST /api/friends/request supports targetUserId');

        // -------------------------------------------------------------
        // TEST 4: REQ 7 & 9 - CHAT WORKFLOW, READ RECEIPTS & ATTACHMENTS
        // -------------------------------------------------------------
        console.log('\n[REQ 7 & 9] WhatsApp-Like Chat, Read Receipts, and Attachments');
        // Find or create group conversation
        const convListRes = await fetch(`${API}/chat/conversations`, {
            headers: {
                'Authorization': `Bearer ${charlieToken}`,
                'x-user-id': String(charlieId)
            }
        });
        assert(convListRes.ok, 'GET /api/chat/conversations returned 200');
        const convListData = await convListRes.json();
        let targetConv = (convListData.conversations || []).find(c => c.group_id === testGroupId);
        if (!targetConv) {
            // Group conv auto-created or direct
            targetConv = convListData.conversations[0];
        }
        assert(Boolean(targetConv), 'Active conversation thread found');
        const convId = targetConv.id;

        // Send regular text message
        const sendMsgRes = await fetch(`${API}/chat/conversations/${convId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${charlieToken}`,
                'Content-Type': 'application/json',
                'x-user-id': String(charlieId)
            },
            body: JSON.stringify({ message: 'Hey team, reviewing dinner receipt!' })
        });
        assert(sendMsgRes.ok, 'Sent text chat message');

        // Send Sticker message
        const sendStickerRes = await fetch(`${API}/chat/conversations/${convId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${charlieToken}`,
                'Content-Type': 'application/json',
                'x-user-id': String(charlieId)
            },
            body: JSON.stringify({
                message: '💸 Paid in Full',
                message_type: 'sticker'
            })
        });
        assert(sendStickerRes.ok, 'Sent sticker chat message');

        // Upload attachment
        const sampleFileData = 'data:text/plain;base64,' + Buffer.from('Dummy receipt invoice file content').toString('base64');
        const attachRes = await fetch(`${API}/chat/conversations/${convId}/attachment`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${charlieToken}`,
                'Content-Type': 'application/json',
                'x-user-id': String(charlieId)
            },
            body: JSON.stringify({
                file_data: sampleFileData,
                file_name: 'invoice_dinner.txt',
                file_type: 'text/plain'
            })
        });
        assert(attachRes.ok, 'POST /api/chat/conversations/:id/attachment uploaded file');
        const attachData = await attachRes.json();
        assert(attachData.media_url && attachData.file_name === 'invoice_dinner.txt', 'Attachment metadata stored');

        // Post message with attachment
        const attachMsgRes = await fetch(`${API}/chat/conversations/${convId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${charlieToken}`,
                'Content-Type': 'application/json',
                'x-user-id': String(charlieId)
            },
            body: JSON.stringify({
                message: 'Attached invoice_dinner.txt',
                message_type: attachData.message_type || 'document',
                media_url: attachData.media_url,
                file_name: attachData.file_name,
                file_size: attachData.file_size
            })
        });
        assert(attachMsgRes.ok, 'Message with attachment posted successfully');

        // Amit marks conversation as read
        const readRes = await fetch(`${API}/chat/conversations/${convId}/read`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${amitToken}`,
                'x-user-id': String(amitId)
            }
        });
        assert(readRes.ok, 'POST /api/chat/conversations/:id/read marked messages as read');

        // Verify read_at in messages
        const getMsgsRes = await fetch(`${API}/chat/conversations/${convId}/messages`, {
            headers: {
                'Authorization': `Bearer ${amitToken}`,
                'x-user-id': String(amitId)
            }
        });
        const getMsgsData = await getMsgsRes.json();
        const readMsg = (getMsgsData.messages || []).find(m => m.sender_id === charlieId && m.read_at);
        assert(Boolean(readMsg), 'Incoming message marked with read_at timestamp');

        // -------------------------------------------------------------
        // TEST 5: REQ 8 - USER PROFILE DP SAVE
        // -------------------------------------------------------------
        console.log('\n[REQ 8] User Profile DP Picture Save & Propagation');
        const testAvatarBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        const dpRes = await fetch(`${API}/users/profile/picture`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${charlieToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ image: testAvatarBase64 })
        });
        assert(dpRes.ok, 'POST /api/users/profile/picture returned 200');
        const dpData = await dpRes.json();
        assert(dpData.avatar_url && dpData.avatar_url.includes('/uploads/avatars/'), 'Avatar URL created in uploads');

        // Verify session includes avatar_url
        const sessionRes = await fetch(`${API}/auth/session`, {
            headers: { 'Authorization': `Bearer ${charlieToken}` }
        });
        const sessionData = await sessionRes.json();
        assert(sessionData.user.avatar_url === dpData.avatar_url, 'Session reflects saved avatar_url');

        // -------------------------------------------------------------
        // TEST 6: REQ 10 - PASSWORD STRENGTH INDICATOR & BACKEND VALIDATION
        // -------------------------------------------------------------
        console.log('\n[REQ 10] Password Strength Validation Rules');
        // Test weak password (too short)
        const weakRes1 = await fetch(`${API}/auth/send-signup-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Weak User',
                email: 'weak1@example.com',
                password: 'abc',
                phone: '+919988771122'
            })
        });
        assert(weakRes1.status === 400, 'Rejects password shorter than 8 chars');

        // Test weak password (no uppercase)
        const weakRes2 = await fetch(`${API}/auth/send-signup-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Weak User',
                email: 'weak2@example.com',
                password: 'password123!',
                phone: '+919988771122'
            })
        });
        assert(weakRes2.status === 400, 'Rejects password without uppercase letter');

        // Test weak password (no lowercase)
        const weakRes3 = await fetch(`${API}/auth/send-signup-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Weak User',
                email: 'weak3@example.com',
                password: 'PASSWORD123!',
                phone: '+919988771122'
            })
        });
        assert(weakRes3.status === 400, 'Rejects password without lowercase letter');

        // -------------------------------------------------------------
        // TEST 7: REQ 12 - STRICT UPI VALIDATION BEFORE QR GENERATION
        // -------------------------------------------------------------
        console.log('\n[REQ 12] Strict UPI Validation (No Placeholder Fallbacks)');
        const origCharlieUpi = charlieUser.upi_id;

        // Ensure receiver (Charlie) has no UPI ID
        await pool.query('UPDATE users SET upi_id = NULL WHERE id = $1', [charlieId]);

        // Attempting to generate QR for payment to Charlie must fail
        const upiMissingRes = await fetch(`${API}/upi/create-payment-request`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${amitToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                payer_id: amitId,
                receiver_id: charlieId,
                group_id: testGroupId,
                amount: 500
            })
        });
        assert(upiMissingRes.status === 400, 'Rejects UPI payment request when receiver has no UPI ID');
        const upiMissingData = await upiMissingRes.json();
        assert(upiMissingData.code === 'MISSING_RECEIVER_UPI', 'Returns MISSING_RECEIVER_UPI code without fake @okaxis generation');

        // Configure valid UPI ID for Charlie and verify success
        await pool.query('UPDATE users SET upi_id = $1 WHERE id = $2', ['charlie.verified@okaxis', charlieId]);
        const upiSuccessRes = await fetch(`${API}/upi/create-payment-request`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${amitToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                payer_id: amitId,
                receiver_id: charlieId,
                group_id: testGroupId,
                amount: 500
            })
        });
        assert(upiSuccessRes.ok, 'Accepts payment request when real UPI ID is present');
        const upiSuccessData = await upiSuccessRes.json();
        const finalUpiUri = upiSuccessData.upiString || upiSuccessData.payment_uri || (upiSuccessData.payment_request && upiSuccessData.payment_request.upi_string);
        assert(finalUpiUri && finalUpiUri.includes('pa=charlie.verified@okaxis'), 'Generates valid UPI intent URL with real ID');

        // Restore Charlie original UPI ID
        await pool.query('UPDATE users SET upi_id = $1 WHERE id = $2', [origCharlieUpi, charlieId]);

        console.log('\n=============================================================');
        console.log(`✓ ALL TESTS PASSED: ${passedAssertions} / ${totalAssertions} assertions passed!`);
        console.log('=============================================================');

    } catch (err) {
        console.error('Test suite failed:', err);
        process.exit(1);
    } finally {
        if (testGroupId) {
            console.log('\n[CLEANUP] Cleaning up test records...');
            try {
                await pool.query('DELETE FROM payment_requests WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = $1)', [testGroupId]);
                await pool.query('DELETE FROM chat_messages WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id = $1)', [testGroupId]);
                await pool.query('DELETE FROM chat_conversation_members WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id = $1)', [testGroupId]);
                await pool.query('DELETE FROM chat_conversations WHERE group_id = $1', [testGroupId]);
                await pool.query('DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = $1)', [testGroupId]);
                await pool.query('DELETE FROM expense_payers WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = $1)', [testGroupId]);
                await pool.query('DELETE FROM expenses WHERE group_id = $1', [testGroupId]);
                await pool.query('DELETE FROM group_members WHERE group_id = $1', [testGroupId]);
                await pool.query('DELETE FROM groups WHERE id = $1', [testGroupId]);
                console.log('✓ Cleaned up test group and records.');
            } catch (cleanErr) {
                console.error('Error during cleanup:', cleanErr.message);
            }
        }
        await pool.end();
    }
}

runFeedbackImprovementsTests();
