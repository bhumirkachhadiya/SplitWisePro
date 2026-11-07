const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

const BASE_URL = 'http://localhost:5000';

async function request(method, path, body = null, headers = {}) {
    const opts = {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...headers
        }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${BASE_URL}${path}`, opts);
    let data = null;
    try {
        data = await res.json();
    } catch (e) {
        data = null;
    }
    return { status: res.status, ok: res.ok, data };
}

async function runRoleSecurityAndModalTests() {
    console.log('================================================================');
    console.log('   COMPREHENSIVE ROLE-BASED ACCESS & MODAL VALIDATION TEST SUITE');
    console.log('================================================================\n');

    let totalTests = 0;
    let passedTests = 0;

    function recordTest(desc, passed, detail = '') {
        totalTests++;
        if (passed) {
            passedTests++;
            console.log(`✓ [PASS] ${desc}`);
        } else {
            console.error(`✗ [FAIL] ${desc} - Detail: ${detail}`);
        }
    }

    try {
        // Retrieve test users from database
        const usersRes = await pool.query('SELECT id, name, email, role, is_active FROM users ORDER BY id ASC');
        const allUsers = usersRes.rows;

        const masterAdmin = allUsers.find(u => u.role === 'master_admin') || allUsers[0];
        const normalUser = allUsers.find(u => u.role !== 'master_admin') || allUsers[1];

        console.log(`[Configuration] Master Admin: ID ${masterAdmin.id} (${masterAdmin.name}, role: ${masterAdmin.role})`);
        console.log(`[Configuration] Normal User:  ID ${normalUser.id} (${normalUser.name}, role: ${normalUser.role})\n`);

        // -----------------------------------------------------------------
        // SECTION 1: MASTER ADMIN GOVERNANCE & ACCESS CONTROL
        // -----------------------------------------------------------------
        console.log('--- 1. MASTER ADMIN AUTHORIZATION TESTS ---');

        const adminOverviewRes = await request('GET', '/api/admin/overview', null, { 'x-user-id': String(masterAdmin.id) });
        recordTest('Master Admin can access /api/admin/overview (200 OK)', adminOverviewRes.status === 200, `Got status ${adminOverviewRes.status}`);

        const adminUsersRes = await request('GET', '/api/admin/users', null, { 'x-user-id': String(masterAdmin.id) });
        recordTest('Master Admin can access /api/admin/users (200 OK)', adminUsersRes.status === 200, `Got status ${adminUsersRes.status}`);

        const adminErrorsRes = await request('GET', '/api/admin/errors', null, { 'x-user-id': String(masterAdmin.id) });
        recordTest('Master Admin can access /api/admin/errors (200 OK)', adminErrorsRes.status === 200, `Got status ${adminErrorsRes.status}`);

        const adminEmailTemplatesRes = await request('GET', '/api/email-templates', null, { 'x-user-id': String(masterAdmin.id) });
        recordTest('Master Admin can access /api/email-templates (200 OK)', adminEmailTemplatesRes.status === 200, `Got status ${adminEmailTemplatesRes.status}`);

        // -----------------------------------------------------------------
        // SECTION 2: NORMAL USER RESTRICTIONS & BACKEND ENFORCEMENT
        // -----------------------------------------------------------------
        console.log('\n--- 2. NORMAL USER BACKEND PERMISSION ENFORCEMENT ---');

        const normalOverviewRes = await request('GET', '/api/admin/overview', null, { 'x-user-id': String(normalUser.id) });
        recordTest('Normal user blocked from /api/admin/overview (403 Forbidden)', normalOverviewRes.status === 403, `Got status ${normalOverviewRes.status}`);

        const normalUsersRes = await request('GET', '/api/admin/users', null, { 'x-user-id': String(normalUser.id) });
        recordTest('Normal user blocked from /api/admin/users (403 Forbidden)', normalUsersRes.status === 403, `Got status ${normalUsersRes.status}`);

        const normalErrorsRes = await request('GET', '/api/admin/errors', null, { 'x-user-id': String(normalUser.id) });
        recordTest('Normal user blocked from /api/admin/errors (403 Forbidden)', normalErrorsRes.status === 403, `Got status ${normalErrorsRes.status}`);

        const normalTemplatesRes = await request('GET', '/api/email-templates', null, { 'x-user-id': String(normalUser.id) });
        recordTest('Normal user blocked from /api/email-templates (403 Forbidden)', normalTemplatesRes.status === 403, `Got status ${normalTemplatesRes.status}`);

        // Anonymous API attempts
        const anonOverviewRes = await request('GET', '/api/admin/overview');
        recordTest('Anonymous request blocked from /api/admin/overview (401 Unauthorized)', anonOverviewRes.status === 401, `Got status ${anonOverviewRes.status}`);

        const anonActivityRes = await request('GET', '/api/activity');
        recordTest('Anonymous request blocked from /api/activity (401 Unauthorized)', anonActivityRes.status === 401, `Got status ${anonActivityRes.status}`);

        const anonUsersRes = await request('GET', '/api/users');
        recordTest('Anonymous request blocked from /api/users (401 Unauthorized)', anonUsersRes.status === 401, `Got status ${anonUsersRes.status}`);

        // Authenticated normal user accessing personal data
        const normalActivityRes = await request('GET', `/api/activity?userId=${normalUser.id}`, null, { 'x-user-id': String(normalUser.id) });
        recordTest('Normal user can access their personal activity logs (200 OK)', normalActivityRes.status === 200, `Got status ${normalActivityRes.status}`);

        const normalPersonalUsersRes = await request('GET', `/api/users?userId=${normalUser.id}`, null, { 'x-user-id': String(normalUser.id) });
        recordTest('Normal user can access their own contact circles (200 OK)', normalPersonalUsersRes.status === 200, `Got status ${normalPersonalUsersRes.status}`);

        // -----------------------------------------------------------------
        // SECTION 3: GROUP ROLE PERMISSION SAFEGUARDS
        // -----------------------------------------------------------------
        console.log('\n--- 3. GROUP ROLE PERMISSION SAFEGUARDS ---');

        // Create a temporary test group
        const testGroupName = `Role-Test-Circle-${Date.now()}`;
        const newGroupRes = await request('POST', '/api/groups', {
            name: testGroupName,
            category: 'General',
            created_by: masterAdmin.id,
            members: [
                { user_id: masterAdmin.id, role: 'admin' },
                { user_id: normalUser.id, role: 'member' }
            ]
        }, { 'x-user-id': String(masterAdmin.id) });

        let testGroupId = null;
        if (newGroupRes.status === 201 && newGroupRes.data?.id) {
            testGroupId = newGroupRes.data.id;
        } else {
            // Find an existing group
            const gRes = await pool.query('SELECT id FROM groups ORDER BY id DESC LIMIT 1');
            testGroupId = gRes.rows[0]?.id;
        }

        recordTest('Created/Located test group circle', testGroupId !== null, `Group ID: ${testGroupId}`);

        // Ensure masterAdmin is admin and normalUser is member
        await pool.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [testGroupId, normalUser.id]);
        await pool.query('INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)', [testGroupId, normalUser.id, 'member']);

        // Case 3.1: Member cannot record an expense
        const memberAddExpRes = await request('POST', '/api/expenses', {
            group_id: testGroupId,
            paid_by: normalUser.id,
            created_by: normalUser.id,
            amount: 500,
            description: 'Unauthorized Member Expense',
            splits: [{ user_id: normalUser.id, amount: 500 }]
        }, { 'x-user-id': String(normalUser.id) });

        recordTest('Group member with role="member" cannot record expenses (403 Forbidden)', memberAddExpRes.status === 403, `Got status ${memberAddExpRes.status}`);

        // Case 3.2: Member cannot edit group details
        const memberEditGroupRes = await request('PUT', `/api/groups/${testGroupId}`, {
            name: 'Hacked Group Name',
            requester_id: normalUser.id
        }, { 'x-user-id': String(normalUser.id) });

        recordTest('Group member cannot edit group details (403 Forbidden)', memberEditGroupRes.status === 403, `Got status ${memberEditGroupRes.status}`);

        // Case 3.3: Member cannot lock group
        const memberLockRes = await request('POST', `/api/groups/${testGroupId}/lock`, {
            userId: normalUser.id
        }, { 'x-user-id': String(normalUser.id) });

        recordTest('Group member cannot lock circle (403 Forbidden)', memberLockRes.status === 403, `Got status ${memberLockRes.status}`);

        // Case 3.4: Member cannot modify member roles
        const memberChangeRoleRes = await request('PUT', `/api/groups/${testGroupId}/members/${masterAdmin.id}`, {
            role: 'member',
            requester_id: normalUser.id
        }, { 'x-user-id': String(normalUser.id) });

        recordTest('Group member cannot modify member roles (403 Forbidden)', memberChangeRoleRes.status === 403, `Got status ${memberChangeRoleRes.status}`);

        // Case 3.5: Non-creator cannot delete group
        const memberDeleteGroupRes = await request('DELETE', `/api/groups/${testGroupId}`, null, {
            'x-user-id': String(normalUser.id)
        });

        recordTest('Non-creator cannot delete circle (403 Forbidden)', memberDeleteGroupRes.status === 403, `Got status ${memberDeleteGroupRes.status}`);

        // Case 3.6: Admin can create expense
        const adminAddExpRes = await request('POST', '/api/expenses', {
            group_id: testGroupId,
            paid_by: masterAdmin.id,
            created_by: masterAdmin.id,
            amount: 600,
            description: 'Authorized Admin Expense',
            splits: [
                { user_id: masterAdmin.id, amount: 300 },
                { user_id: normalUser.id, amount: 300 }
            ]
        }, { 'x-user-id': String(masterAdmin.id) });

        recordTest('Group admin can record expenses (201 Created)', adminAddExpRes.status === 201, `Got status ${adminAddExpRes.status}`);
        const createdExpId = adminAddExpRes.data?.id;

        if (createdExpId) {
            // Case 3.7: Member cannot edit expense
            const memberEditExpRes = await request('PUT', `/api/expenses/${createdExpId}`, {
                description: 'Member Attempt Edit',
                amount: 700,
                updated_by: normalUser.id
            }, { 'x-user-id': String(normalUser.id) });

            recordTest('Group member cannot edit expense (403 Forbidden)', memberEditExpRes.status === 403, `Got status ${memberEditExpRes.status}`);

            // Case 3.8: Admin can edit expense
            const adminEditExpRes = await request('PUT', `/api/expenses/${createdExpId}`, {
                description: 'Admin Updated Expense',
                amount: 600,
                paid_by: masterAdmin.id,
                splits: [
                    { user_id: masterAdmin.id, amount: 300 },
                    { user_id: normalUser.id, amount: 300 }
                ],
                updated_by: masterAdmin.id
            }, { 'x-user-id': String(masterAdmin.id) });

            recordTest('Group admin can edit expense (200 OK)', adminEditExpRes.status === 200, `Got status ${adminEditExpRes.status}: ${JSON.stringify(adminEditExpRes.data)}`);

            // Clean up test expense
            await request('DELETE', `/api/expenses/${createdExpId}`, null, { 'x-user-id': String(masterAdmin.id) });
        }

        // Clean up test group
        await request('DELETE', `/api/groups/${testGroupId}`, null, { 'x-user-id': String(masterAdmin.id) });

        // -----------------------------------------------------------------
        // SECTION 4: FRONTEND UI & MODAL VALIDATION INTEGRITY
        // -----------------------------------------------------------------
        console.log('\n--- 4. FRONTEND UI & MODAL VALIDATION AUDIT ---');

        const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

        // Check 4.1: Toast Container z-index
        const toastZIndex = html.includes('id="toastContainer" class="fixed top-4 right-4 z-[9999]');
        recordTest('Toast container has elevated z-[9999] so alerts never appear behind modals', toastZIndex);

        // Check 4.2: Sidebar Email Templates navigation item has hidden class
        const sidebarTemplatesHidden = html.includes('id="sidebarEmailTemplatesNav"') && 
            html.includes('class="nav-item hidden flex items-center');
        recordTest('Sidebar Email Templates nav is hidden by default for normal users', sidebarTemplatesHidden);

        // Check 4.3: Profile modal admin tabs are hidden in HTML
        const profileTemplatesHidden = html.includes('id="settingsTabBtn-templates" class="settings-tab-btn hidden');
        const profilePrefsHidden = html.includes('id="settingsTabBtn-prefs" class="settings-tab-btn hidden');
        recordTest('Profile modal Email Templates and App Settings tabs hidden by default', profileTemplatesHidden && profilePrefsHidden);

        // Check 4.4: navigateTo guards master-admin view
        const navigateToGuard = html.includes("if (viewName === 'master-admin')") &&
            html.includes("currentUser.role !== 'master_admin'");
        recordTest('navigateTo guards master-admin view with role check and redirect', navigateToGuard);

        // Check 4.5: Inline modal alert containers
        const editGroupAlert = html.includes('id="editGroupModalAlert"');
        recordTest('editGroupModal contains dedicated inline alert container', editGroupAlert);

        const manageMembersAlert = html.includes('id="manageMembersModalAlert"');
        recordTest('manageMembersModal contains dedicated inline alert container', manageMembersAlert);

        const editExpenseAlert = html.includes('id="editExpenseModalAlert"');
        recordTest('editExpenseModal contains dedicated inline alert container', editExpenseAlert);

        const expenseCorrectionAlert = html.includes('id="expenseCorrectionModalAlert"');
        recordTest('expenseCorrectionModal contains dedicated inline alert container', expenseCorrectionAlert);

        // Check 4.6: Global Universal Escape and Backdrop Click listeners
        const escapeListener = html.includes("document.addEventListener('keydown', (e) => {") && html.includes("if (e.key === 'Escape')");
        recordTest('Global universal Escape key modal listener implemented', escapeListener);

        const backdropListener = html.includes("document.addEventListener('click', (e) => {") && html.includes("e.target === el");
        recordTest('Global universal backdrop click overlay dismissal listener implemented', backdropListener);

        console.log('\n================================================================');
        console.log(`   TEST RESULTS: ${passedTests}/${totalTests} TESTS PASSED (${((passedTests/totalTests)*100).toFixed(1)}%)`);
        console.log('================================================================\n');

        if (passedTests === totalTests) {
            console.log('✓ ALL ROLE SECURITY & MODAL VALIDATION TESTS PASSED PERFECTLY!\n');
            process.exit(0);
        } else {
            console.error(`✗ ${totalTests - passedTests} test(s) failed.`);
            process.exit(1);
        }

    } catch (err) {
        console.error('Fatal error during test execution:', err);
        process.exit(1);
    }
}

runRoleSecurityAndModalTests();
