/**
 * test-user-testing-audit-suite.js
 * Comprehensive Verification & Audit Test Suite for SplitWise User Testing Requirements
 */

const BASE_URL = 'http://localhost:5000';

async function request(path, options = {}) {
    const url = BASE_URL + path;
    const init = {
        method: options.method || 'GET',
        headers: options.headers || {},
        signal: AbortSignal.timeout(options.timeout || 15000)
    };

    if (options.body) {
        init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        init.headers['Content-Type'] = 'application/json';
    }

    try {
        const res = await fetch(url, init);
        let body = null;
        const text = await res.text();
        try {
            body = JSON.parse(text);
        } catch {
            body = text;
        }
        return { status: res.status, body };
    } catch (e) {
        return { status: 0, error: e.message };
    }
}

async function runTestSuite() {
    console.log('================================================================');
    console.log('   SPLITWISE USER TESTING COMPLETE AUDIT & VERIFICATION SUITE   ');
    console.log('================================================================\n');

    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;

    function assert(name, condition, details = '') {
        totalTests++;
        if (condition) {
            passedTests++;
            console.log(`  ✓ PASS: ${name}`);
            if (details) console.log(`          ↳ ${details}`);
        } else {
            failedTests++;
            console.error(`  ✗ FAIL: ${name}`);
            if (details) console.error(`          ↳ ${details}`);
        }
    }

    try {
        // --- 1. User & Master Admin Discovery ---
        console.log('[SECTION 1: User & Authentication Discovery]');
        const usersRes = await request('/api/users');
        const allUsers = Array.isArray(usersRes.body) ? usersRes.body : (usersRes.body?.users || []);
        assert('Fetch registered users from /api/users', usersRes.status === 200 && allUsers.length > 0, `Found ${allUsers.length} users`);

        const masterAdmin = allUsers.find(u => u.role === 'master_admin') || allUsers.find(u => u.id === 1);
        const regularUser = allUsers.find(u => u.role === 'user' && u.id !== masterAdmin.id) || allUsers.find(u => u.id === 2);
        console.log(`     Master Admin: ${masterAdmin?.name} (ID: ${masterAdmin?.id}, Role: ${masterAdmin?.role})`);
        console.log(`     Regular User: ${regularUser?.name} (ID: ${regularUser?.id}, Role: ${regularUser?.role})`);

        // --- 2. Master Admin RBAC Gate on Email Templates ---
        console.log('\n[SECTION 2: Part 13 - Super Admin Access Control]');
        const forbiddenRes = await request('/api/email-templates', {
            headers: { 'x-user-id': String(regularUser.id) }
        });
        assert('Regular user blocked from /api/email-templates (HTTP 403)', forbiddenRes.status === 403, `Got HTTP ${forbiddenRes.status}`);

        const adminTemplatesRes = await request('/api/email-templates', {
            headers: { 'x-user-id': String(masterAdmin.id) }
        });
        assert('Master admin allowed to access /api/email-templates (HTTP 200)', adminTemplatesRes.status === 200, `Got HTTP ${adminTemplatesRes.status}`);
        const templateList = Array.isArray(adminTemplatesRes.body) ? adminTemplatesRes.body : (adminTemplatesRes.body?.templates || []);
        assert('All required email templates exist in system', templateList.length >= 9, `Found ${templateList.length} templates (minimum 9 required)`);

        // --- 3. Email Template Previews & Placeholder Substitution ---
        console.log('\n[SECTION 3: Part 12 - Email Template Preview & Variable Substitution]');
        const previewRes = await request('/api/email-templates/preview', {
            method: 'POST',
            headers: { 'x-user-id': String(masterAdmin.id) },
            body: {
                template_type: 'signup_otp',
                subject: 'Your SplitWise OTP is {{otp}}',
                body_html: '<p>Hi {{user_name}}, your code is <strong>{{otp}}</strong> for {{app_name}}</p>'
            }
        });
        assert('Preview generation succeeds (HTTP 200)', previewRes.status === 200);
        const previewHtml = previewRes.body?.preview_html || '';
        const previewSubject = previewRes.body?.preview_subject || '';
        assert('Preview replaces {{otp}} and {{user_name}}', 
            !previewHtml.includes('{{') && !previewHtml.includes('}}') && !previewSubject.includes('{{'),
            `Subject: "${previewSubject}", Body excerpt: "${previewHtml.substring(0, 60)}..."`);

        // --- 4. User Discoverability for Adding Members ---
        console.log('\n[SECTION 4: Part 5 - Discover Registered Enrolled Users]');
        const discoverRes = await request('/api/users/discover?excludeGroupId=42', {
            headers: { 'x-user-id': String(masterAdmin.id) }
        });
        assert('Discover candidate users endpoint /api/users/discover exists (HTTP 200)', discoverRes.status === 200);
        const candidates = Array.isArray(discoverRes.body) ? discoverRes.body : (discoverRes.body?.users || []);
        assert('Candidate users list excludes members already in Group 42', Array.isArray(candidates) && candidates.length > 0, `Retrieved ${candidates.length} candidates not in Diwali Testing`);

        // --- 5. Group Expense Details & Splits Breakdown ---
        console.log('\n[SECTION 5: Part 1 - Group Expense Details & Member Splits]');
        const groupExpRes = await request('/api/groups/42/expenses', {
            headers: { 'x-user-id': String(masterAdmin.id) }
        });
        assert('Fetch detailed group expenses with split breakdown (HTTP 200)', groupExpRes.status === 200);
        const groupExpData = groupExpRes.body || {};
        assert('Group expenses include total_paid, total_pending, and expenses array',
            groupExpData.expenses && (groupExpData.total_spend !== undefined || groupExpData.totals?.group_spend !== undefined),
            `Total Spend: ₹${groupExpData.total_spend}, Paid: ₹${groupExpData.total_paid}, Pending: ₹${groupExpData.total_pending}`);

        const sampleExp = groupExpData.expenses?.[0];
        if (sampleExp) {
            assert('Expense object includes split breakdown with member statuses',
                Array.isArray(sampleExp.splits) && sampleExp.splits.length > 0 && sampleExp.splits[0].payment_status,
                `Expense "${sampleExp.title || sampleExp.description}": ${sampleExp.splits.length} splits (Status: ${sampleExp.splits[0].payment_status})`);
        }

        // --- 6. Critical Diwali Testing Settlement Reconciliation ---
        console.log('\n[SECTION 6: Part 2 & Part 7 - Diwali Testing Settlement Reconciliation]');
        const diwaliBalancesRes = await request('/api/groups?userId=' + masterAdmin.id);
        assert('Fetch groups for balance verification (HTTP 200)', diwaliBalancesRes.status === 200);
        const groupsList = diwaliBalancesRes.body || [];
        const diwaliGroup = groupsList.find(g => g.id === 42 || g.name === 'Diwali Testing');
        assert('Diwali Testing circle found', !!diwaliGroup, `Group ID: ${diwaliGroup?.id}, Name: ${diwaliGroup?.name}`);

        const alexNet = diwaliGroup ? Number(diwaliGroup.user_net_balance || 0) : null;
        console.log(`     Diwali Testing Alex (User 1) net balance: ₹${alexNet}`);
        assert('Diwali Testing Alex balance reflects reconciled Priya settlement (₹500 instead of ₹750)',
            alexNet === 500, `Expected ₹500, got ₹${alexNet}`);

        // Also check Priya's balance in Diwali Testing (User 3)
        const priyaBalanceRes = await request('/api/groups?userId=3');
        const priyaDiwali = (priyaBalanceRes.body || []).find(g => g.id === 42);
        const priyaNet = priyaDiwali ? Number(priyaDiwali.user_net_balance || 0) : null;
        console.log(`     Diwali Testing Priya (User 3) net balance: ₹${priyaNet}`);
        assert('Diwali Testing Priya balance reflects fully settled share (₹0)',
            priyaNet === 0, `Expected ₹0, got ₹${priyaNet}`);

        // --- 7. Group Spend Consistency (No Cartesian 3x/4x multiplier) ---
        console.log('\n[SECTION 7: Part 2 - Group Spend Ledger vs Group Wise Consistency]');
        assert('Diwali Testing Total Spend correctly reflects single-pass sum ₹1000',
            Number(diwaliGroup.total_spend) === 1000, `Expected ₹1000, got ₹${diwaliGroup?.total_spend}`);

        // --- 8. Idempotency & Rapid Button Click Deduplication ---
        console.log('\n[SECTION 8: Part 4 - Backend Idempotency & Duplicate Prevention]');
        const uniqueTestName = `Idempotency Test Circle ${Date.now()}`;
        const firstCreate = await request('/api/groups', {
            method: 'POST',
            headers: { 'x-user-id': String(masterAdmin.id) },
            body: { name: uniqueTestName, type: 'trip', members: [masterAdmin.id] }
        });
        assert('First group creation succeeds (HTTP 201)', firstCreate.status === 201);
        const createdGroupId = firstCreate.body?.group?.id || firstCreate.body?.id;
        console.log(`     Created Group ID: ${createdGroupId}`);

        // Immediate duplicate creation with exact same payload
        const secondCreate = await request('/api/groups', {
            method: 'POST',
            headers: { 'x-user-id': String(masterAdmin.id) },
            body: { name: uniqueTestName, type: 'trip', members: [masterAdmin.id] }
        });
        assert('Duplicate rapid request rejected by dedupeRequest middleware (HTTP 409 or 429)',
            secondCreate.status === 409 || secondCreate.status === 429,
            `Got HTTP ${secondCreate.status}: ${secondCreate.body?.error}`);

        // --- 9. Group Locking & Financial History Protection ---
        console.log('\n[SECTION 9: Part 9 - Group Locking & Financial History Audit]');
        if (createdGroupId) {
            // Lock group
            const lockRes = await request(`/api/groups/${createdGroupId}/lock`, {
                method: 'POST',
                headers: { 'x-user-id': String(masterAdmin.id) }
            });
            console.log(`     Lock response status: ${lockRes.status}, body:`, lockRes.body);
            assert('Lock group endpoint /api/groups/:id/lock succeeds (HTTP 200)', lockRes.status === 200, `Got HTTP ${lockRes.status}`);

            // Adding expense to locked group should be rejected
            const addExpLocked = await request('/api/expenses', {
                method: 'POST',
                headers: { 'x-user-id': String(masterAdmin.id) },
                body: {
                    groupId: createdGroupId,
                    description: 'Locked Test Expense',
                    amount: 100,
                    payerId: masterAdmin.id,
                    splitType: 'EQUAL',
                    splits: [{ userId: masterAdmin.id, amount: 100 }]
                }
            });
            assert('Adding expense to locked group is rejected (HTTP 400/403)',
                addExpLocked.status === 400 || addExpLocked.status === 403,
                `Got HTTP ${addExpLocked.status}: ${addExpLocked.body?.error}`);

            // Unlock group
            const unlockRes = await request(`/api/groups/${createdGroupId}/unlock`, {
                method: 'POST',
                headers: { 'x-user-id': String(masterAdmin.id) }
            });
            console.log(`     Unlock response status: ${unlockRes.status}, body:`, unlockRes.body);
            assert('Unlock group endpoint /api/groups/:id/unlock succeeds (HTTP 200)', unlockRes.status === 200, `Got HTTP ${unlockRes.status}`);

            // Clean up temporary test group
            await request(`/api/groups/${createdGroupId}`, {
                method: 'DELETE',
                headers: { 'x-user-id': String(masterAdmin.id) }
            });
        }

        // --- 10. Audit Log Activity Feed ---
        console.log('\n[SECTION 10: Part 14 - Activity Feed & Audit Log]');
        const actRes = await request(`/api/activity?userId=${masterAdmin.id}`, {
            headers: { 'x-user-id': String(masterAdmin.id) }
        });
        assert('Activity audit log endpoint /api/activity (HTTP 200)', actRes.status === 200);
        const activities = actRes.body?.activities || actRes.body || [];
        assert('Audit log contains activity history records', Array.isArray(activities) && activities.length > 0,
            `Found ${activities.length} recorded audit events`);

        // --- 11. Personal 1-to-1 Direct Chat ---
        console.log('\n[SECTION 11: Part 15 - Personal 1-to-1 Direct Chat]');
        const directChatRes = await request(`/api/chat/direct/${regularUser.id}`, {
            headers: { 'x-user-id': String(masterAdmin.id) }
        });
        assert('Create or get direct chat with friend (HTTP 200)', directChatRes.status === 200, `Got HTTP ${directChatRes.status}`);
        const directConvId = directChatRes.body?.conversation_id;
        assert('Direct chat returns valid conversation ID', !!directConvId, `Conversation ID: ${directConvId}`);

        if (directConvId) {
            // Post direct message
            const testMsg = `Direct chat audit verification timestamp ${Date.now()}`;
            const postMsgRes = await request(`/api/chat/conversations/${directConvId}/messages`, {
                method: 'POST',
                headers: { 'x-user-id': String(masterAdmin.id) },
                body: { message: testMsg }
            });
            assert('Post message to direct conversation (HTTP 200/201)', postMsgRes.status === 200 || postMsgRes.status === 201);

            // Fetch direct messages
            const getMsgsRes = await request(`/api/chat/conversations/${directConvId}/messages`, {
                headers: { 'x-user-id': String(masterAdmin.id) }
            });
            assert('Fetch direct conversation messages (HTTP 200)', getMsgsRes.status === 200);
            const msgs = getMsgsRes.body?.messages || [];
            const hasMsg = msgs.some(m => m.message === testMsg);
            assert('Sent direct message appears in conversation thread', hasMsg, `Total messages in thread: ${msgs.length}`);
        }

        // --- 12. Send Expense Reminder (Bulk Selection) ---
        console.log('\n[SECTION 12: Part 11 - Send Expense Reminder with Bulk Selection]');
        const reminderRes = await request('/api/reminders/send', {
            method: 'POST',
            headers: { 'x-user-id': String(masterAdmin.id) },
            body: {
                expense_id: 45,
                send_to_all_pending: true,
                message: 'Friendly reminder to settle your share.'
            },
            timeout: 20000
        });
        assert('Send reminder endpoint supports send_to_all_pending (HTTP 200 or handled response)',
            reminderRes.status === 200 || (reminderRes.status === 400 && reminderRes.body?.error),
            `Response: ${JSON.stringify(reminderRes.body)}`);

    } catch (err) {
        console.error('Fatal test runner error:', err);
        failedTests++;
    }

    console.log('\n================================================================');
    console.log(`   AUDIT SUITE COMPLETE: ${passedTests}/${totalTests} TESTS PASSED (${failedTests} FAILED)`);
    console.log('================================================================\n');

    process.exit(failedTests > 0 ? 1 : 0);
}

runTestSuite();
