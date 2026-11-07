const http = require('http');

function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request({
            hostname: 'localhost',
            port: 5000,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch(e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function assert(condition, message) {
    if (!condition) {
        console.error(`❌ FAIL: ${message}`);
        throw new Error(message);
    }
    console.log(`✓ PASS: ${message}`);
}

async function runProductionFeatureTests() {
    console.log('====================================================');
    console.log('🧪 SPLITWISE PRODUCTION GROUP & EXPENSE CRUD TEST');
    console.log('====================================================\n');

    // 1. Create a test group
    console.log('--- 1. Create New Group ---');
    const groupName = 'Production Test Group ' + Date.now();
    const createRes = await request('POST', '/api/groups', {
        name: groupName,
        description: 'Test group for CRUD verification',
        category: 'Trip',
        created_by: 1,
        members: [
            { user_id: 1, role: 'admin' },
            { user_id: 2, role: 'editor' }
        ]
    });
    assert(createRes.status === 201, 'Group created successfully');
    const groupId = createRes.data.id;
    console.log(`  Created Group ID: ${groupId}`);

    // 2. Fetch Group Details (GET /api/groups/:id)
    console.log('\n--- 2. Fetch Group Details ---');
    const getGroupRes = await request('GET', `/api/groups/${groupId}`);
    assert(getGroupRes.status === 200, 'GET /api/groups/:id returned 200');
    assert(getGroupRes.data.name === groupName, 'Group name matches');
    assert(getGroupRes.data.members.length === 2, 'Group has 2 initial members');

    // 3. Add Member (POST /api/groups/:id/members)
    console.log('\n--- 3. Add Member to Group ---');
    const addMemRes = await request('POST', `/api/groups/${groupId}/members`, {
        user_id: 3,
        role: 'member'
    });
    assert(addMemRes.status === 200 || addMemRes.status === 201, 'POST /api/groups/:id/members succeeded');
    const checkGroupAfterAdd = await request('GET', `/api/groups/${groupId}`);
    assert(checkGroupAfterAdd.data.members.some(m => m.id === 3), 'User 3 is now verified in group members');

    // 4. Update Group (PUT /api/groups/:id)
    console.log('\n--- 4. Update Group Details & Roles ---');
    const updatedName = groupName + ' (Renamed)';
    const updateGroupRes = await request('PUT', `/api/groups/${groupId}`, {
        name: updatedName,
        description: 'Updated description',
        category: 'Home',
        members: [
            { user_id: 1, role: 'admin' },
            { user_id: 2, role: 'editor' },
            { user_id: 3, role: 'editor' } // Promoted to editor
        ]
    });
    assert(updateGroupRes.status === 200, 'PUT /api/groups/:id returned 200');
    assert(updateGroupRes.data.group.name === updatedName, 'Renamed group persisted');

    // 5. Remove Member (DELETE /api/groups/:id/members/:userId)
    console.log('\n--- 5. Remove Member from Group ---');
    const removeMemRes = await request('DELETE', `/api/groups/${groupId}/members/3`);
    assert(removeMemRes.status === 200, 'DELETE /api/groups/:id/members/:userId returned 200');
    const checkGroupAfterRemove = await request('GET', `/api/groups/${groupId}`);
    assert(checkGroupAfterRemove.data.members.every(m => m.id !== 3), 'User 3 successfully verified removed');

    // 6. Create Expense in Group (POST /api/expenses)
    console.log('\n--- 6. Create Expense in Group ---');
    const expRes = await request('POST', '/api/expenses', {
        group_id: groupId,
        description: 'Team Lunch',
        amount: 600,
        paid_by: 1,
        category: 'Food',
        split_type: 'equal',
        expense_date: '2026-11-04',
        splits: [
            { user_id: 1, amount: 300 },
            { user_id: 2, amount: 300 }
        ]
    });
    assert(expRes.status === 201, 'Expense created successfully');
    const expenseId = expRes.data.id;
    console.log(`  Created Expense ID: ${expenseId}`);

    // 7. Fetch Expense (GET /api/expenses/:id)
    console.log('\n--- 7. Fetch Expense Details & Splits ---');
    const getExpRes = await request('GET', `/api/expenses/${expenseId}`);
    assert(getExpRes.status === 200, 'GET /api/expenses/:id returned 200');
    assert(getExpRes.data.description === 'Team Lunch', 'Expense description matches');
    assert(parseFloat(getExpRes.data.amount) === 600, 'Expense amount matches');
    assert(getExpRes.data.splits.length === 2, 'Found 2 split records');

    // 8. Edit Expense (PUT /api/expenses/:id)
    console.log('\n--- 8. Edit Expense & Reallocate Splits ---');
    const editExpRes = await request('PUT', `/api/expenses/${expenseId}`, {
        description: 'Team Dinner (Special)',
        amount: 900,
        category: 'Food',
        paid_by: 1,
        expense_date: '2026-11-04',
        splits: [
            { user_id: 1, amount: 450 },
            { user_id: 2, amount: 450 }
        ]
    });
    assert(editExpRes.status === 200, 'PUT /api/expenses/:id returned 200');
    assert(editExpRes.data.expense.description === 'Team Dinner (Special)', 'Updated description persisted');
    assert(parseFloat(editExpRes.data.expense.amount) === 900, 'Updated amount persisted');

    // 9. Delete Group Cascade (DELETE /api/groups/:id)
    console.log('\n--- 9. Delete Group Cascade ---');
    const delGroupRes = await request('DELETE', `/api/groups/${groupId}`);
    assert(delGroupRes.status === 200, 'DELETE /api/groups/:id returned 200');

    // Verify group is gone
    const verifyDel = await request('GET', `/api/groups/${groupId}`);
    assert(verifyDel.status === 404, 'Group was permanently deleted (404)');

    console.log('\n====================================================');
    console.log('🎉 ALL PRODUCTION CRUD OPERATIONS VERIFIED (100%)');
    console.log('====================================================');
}

runProductionFeatureTests().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
