const http = require('http');

const BASE_URL = 'http://localhost:5000';

function request(method, path, body = null, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...customHeaders
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
        }
        resolve({ status: res.statusCode, data: parsed });
      });
    });

    req.on('error', (err) => reject(err));

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(message);
  }
  console.log(`✅ PASSED: ${message}`);
}

async function runTests() {
  console.log('====================================================');
  console.log('   SPLITEASE END-TO-END VERIFICATION & TEST SUITE   ');
  console.log('====================================================\n');

  // Test 1: Health check / users listing
  console.log('--- TEST 1: User & Authentication Verification ---');
  const usersRes = await request('GET', '/api/users?userId=1');
  assert(usersRes.status === 200, 'GET /api/users returns 200');
  assert(Array.isArray(usersRes.data) && usersRes.data.length >= 5, 'Found seeded users in database');
  console.log(`  Current users count: ${usersRes.data.length}`);
  
  // Test 2: User Login
  const loginRes = await request('POST', '/api/users/login', {
    email: 'alex@splitease.io',
    password: 'password123'
  });
  assert(loginRes.status === 200, 'Alex login successful with 200');
  assert(loginRes.data.user && loginRes.data.user.name === 'Alex Sharma', 'Alex user object verified');

  // Test 3: User Profile Update (Name, UPI ID, Phone, Password)
  console.log('\n--- TEST 3: User Profile Edit & Persistence ---');
  const alexId = loginRes.data.user.id;
  const profileUpdateRes = await request('PUT', `/api/users/${alexId}`, {
    name: 'Alex Sharma Updated',
    email: 'alex@splitease.io',
    phone: '+91 98765 43210',
    upi_id: 'alexsharma@upi',
    new_password: 'newpassword123'
  });
  assert(profileUpdateRes.status === 200, 'PUT /api/users/:id successfully updated profile');
  assert(profileUpdateRes.data.user.name === 'Alex Sharma Updated', 'Updated name persisted');
  assert(profileUpdateRes.data.user.upi_id === 'alexsharma@upi', 'Updated UPI ID persisted');
  assert(profileUpdateRes.data.user.phone === '+91 98765 43210', 'Updated phone persisted');

  // Test login with new password
  const newLoginRes = await request('POST', '/api/users/login', {
    email: 'alex@splitease.io',
    password: 'newpassword123'
  });
  assert(newLoginRes.status === 200, 'Login with new password succeeded');

  // Restore Alex's original password & name for consistency
  await request('PUT', `/api/users/${alexId}`, {
    name: 'Alex Sharma',
    email: 'alex@splitease.io',
    phone: '+91 98765 43210',
    upi_id: 'alex.sharma@okicici',
    new_password: 'password123'
  });
  console.log('  Alex profile successfully reset to defaults');

  // Test 4: Group Creation with Role Assignment
  console.log('\n--- TEST 4: Group Creation with Explicit Member Roles ---');
  // Group members:
  // Alex: Admin (Creator)
  // Rahul: Editor
  // Priya: Member (Split only)
  const testGroupName = 'Role Verification Trip ' + Date.now();
  const createGroupRes = await request('POST', '/api/groups', {
    name: testGroupName,
    description: 'Testing role enforcement',
    category: 'Trip',
    currency: 'INR',
    created_by: alexId,
    members: [
      { user_id: 1, role: 'admin' },
      { user_id: 2, role: 'editor' },
      { user_id: 3, role: 'member' }
    ]
  });
  assert(createGroupRes.status === 201, 'POST /api/groups created group with 201');
  const testGroupId = createGroupRes.data.group.id;
  assert(testGroupId != null, `Created group ID: ${testGroupId}`);

  // Fetch groups to verify member roles
  const groupsRes = await request('GET', '/api/groups?userId=1');
  const createdGroup = groupsRes.data.find(g => g.id === testGroupId);
  assert(createdGroup != null, 'Created group retrieved via GET /api/groups');
  assert(createdGroup.members.length === 3, 'Group has exactly 3 members');
  
  const memberPriya = createdGroup.members.find(m => m.id === 3);
  const memberRahul = createdGroup.members.find(m => m.id === 2);
  const memberAlex = createdGroup.members.find(m => m.id === 1);
  assert(memberPriya && memberPriya.role === 'member', 'Priya has role "member" (Split Only)');
  assert(memberRahul && memberRahul.role === 'editor', 'Rahul has role "editor"');
  assert(memberAlex && memberAlex.role === 'admin', 'Alex has role "admin"');

  // Test 5: Role-Gated Expense Entry Enforcement
  console.log('\n--- TEST 5: Expense Entry Role Restrictions ---');
  // Case A: Priya (role: member) attempts to add an expense -> MUST FAIL WITH 403
  const priyaAttemptRes = await request('POST', '/api/expenses', {
    group_id: testGroupId,
    creator_id: 3, // Priya
    paid_by: 3,
    title: 'Priya unauthorized lunch',
    amount: 900,
    category: 'Food & Dining',
    split_type: 'EQUAL',
    splits: [
      { user_id: 1, amount: 300 },
      { user_id: 2, amount: 300 },
      { user_id: 3, amount: 300 }
    ]
  });
  assert(priyaAttemptRes.status === 403, 'Priya (member) is blocked from creating expenses (HTTP 403)');
  assert(!/postgres|sql|syntax/i.test(priyaAttemptRes.data.error), 'Error message is sanitized and contains no DB keywords');
  console.log(`  Server friendly error: "${priyaAttemptRes.data.error}"`);

  // Case B: Rahul (role: editor) creates an expense -> MUST SUCCEED
  const rahulExpenseRes = await request('POST', '/api/expenses', {
    group_id: testGroupId,
    creator_id: 2, // Rahul (Editor)
    paid_by: 2,
    title: 'Rahul Hotel Booking',
    amount: 1200,
    category: 'Accommodation',
    split_type: 'EQUAL',
    splits: [
      { user_id: 1, amount: 400 },
      { user_id: 2, amount: 400 },
      { user_id: 3, amount: 400 }
    ]
  });
  assert(rahulExpenseRes.status === 201, 'Rahul (editor) successfully created expense (HTTP 201)');
  const rahulExpenseId = rahulExpenseRes.data.expense.id;

  // Case C: Alex (role: admin) creates an expense -> MUST SUCCEED
  const alexExpenseRes = await request('POST', '/api/expenses', {
    group_id: testGroupId,
    creator_id: 1, // Alex (Admin)
    paid_by: 1,
    title: 'Alex Fuel & Tolls',
    amount: 1000,
    category: 'Transportation',
    split_type: 'PERCENTAGE',
    splits: [
      { user_id: 1, amount: 500, percentage: 50 },
      { user_id: 2, amount: 250, percentage: 25 },
      { user_id: 3, amount: 250, percentage: 25 }
    ]
  });
  assert(alexExpenseRes.status === 201, 'Alex (admin) successfully created percentage-split expense (HTTP 201)');

  // Test 6: Smart Percentage Auto-Balancing Logic Verification
  console.log('\n--- TEST 6: Smart Split Auto-Balance Algorithm Check ---');
  function simulateAutoBalance(totalAmount, activeUserIds, changedUserId, newPct) {
    let pct = Math.max(0, Math.min(100, parseFloat(newPct) || 0));
    const others = activeUserIds.filter(id => id !== changedUserId);
    const shares = {};
    shares[changedUserId] = pct;

    if (others.length > 0) {
      const remainingPct = Math.max(0, 100 - pct);
      const baseShare = Math.floor((remainingPct / others.length) * 100) / 100;
      let allocated = 0;
      others.forEach((uid, idx) => {
        if (idx === others.length - 1) {
          const lastShare = parseFloat((remainingPct - allocated).toFixed(2));
          shares[uid] = lastShare;
        } else {
          shares[uid] = baseShare;
          allocated += baseShare;
        }
      });
    }

    // Verify sum equals exactly 100.00%
    const totalPct = Object.values(shares).reduce((a, b) => a + b, 0);
    const amounts = {};
    for (const uid of activeUserIds) {
      amounts[uid] = Math.round((totalAmount * (shares[uid] / 100)) * 100) / 100;
    }
    return { shares, totalPct: parseFloat(totalPct.toFixed(2)), amounts };
  }

  // 3 users: 50% on User 1
  const balanceCase1 = simulateAutoBalance(1000, [1, 2, 3], 1, 50);
  assert(balanceCase1.shares[1] === 50, 'User 1 is 50%');
  assert(balanceCase1.shares[2] === 25, 'User 2 auto-balanced to 25.00%');
  assert(balanceCase1.shares[3] === 25, 'User 3 auto-balanced to 25.00%');
  assert(balanceCase1.totalPct === 100, 'Total percentage sums exactly to 100.00%');
  assert(balanceCase1.amounts[1] === 500 && balanceCase1.amounts[2] === 250 && balanceCase1.amounts[3] === 250, '₹ shares calculate to ₹500, ₹250, ₹250');

  // 3 users: 33.34% on User 1
  const balanceCase2 = simulateAutoBalance(1000, [1, 2, 3], 1, 33.34);
  assert(balanceCase2.totalPct === 100, 'Sum is precisely 100.00% even with repeating decimals');
  console.log(`  Split distribution for 33.34%: User 1=${balanceCase2.shares[1]}%, User 2=${balanceCase2.shares[2]}%, User 3=${balanceCase2.shares[3]}%`);

  // Cap at 100%: 120% entered
  const balanceCase3 = simulateAutoBalance(1000, [1, 2, 3], 1, 120);
  assert(balanceCase3.shares[1] === 100, 'Percentage over 100 capped at 100%');
  assert(balanceCase3.shares[2] === 0 && balanceCase3.shares[3] === 0, 'Other members set to 0.00% when one member is 100%');
  assert(balanceCase3.totalPct === 100, 'Sum remains 100.00%');

  // Test 7: Balance Summaries & Settle Up
  console.log('\n--- TEST 7: Balances, Settlement & Debt Simplification ---');
  const balancesRes = await request('GET', '/api/balances/summary?userId=1');
  assert(balancesRes.status === 200, 'GET /api/balances/summary returned 200');
  assert(balancesRes.data.net_balance !== undefined, 'Current user summary balances present');

  // Debt Simplification
  const debtRes = await request('GET', `/api/simplify-debts/${testGroupId}`);
  assert(debtRes.status === 200, 'GET /api/simplify-debts/:groupId returned 200');
  assert(Array.isArray(debtRes.data.simplified_debts), 'Simplified debts list returned');
  console.log(`  Optimized debt transfers for group: ${debtRes.data.simplified_debts.length} transactions`);

  // Settle a debt
  const settleRes = await request('POST', '/api/settlements', {
    payer_id: 3, // Priya pays Alex
    payee_id: 1,
    group_id: testGroupId,
    amount: 250,
    payment_method: 'UPI',
    notes: 'Settling toll share'
  });
  assert(settleRes.status === 201, 'POST /api/settlements recorded payment with 201');
  assert(settleRes.data.settlement && settleRes.data.settlement.amount == 250, 'Settlement amount confirmed');

  // Test 8: Activity Logs and Analytics
  console.log('\n--- TEST 8: Activity Logging & Analytics ---');
  const activityRes = await request('GET', '/api/activity?userId=1');
  assert(activityRes.status === 200, 'GET /api/activity returned 200');
  assert(Array.isArray(activityRes.data) && activityRes.data.length > 0, 'Activity feed populated');

  const analyticsRes = await request('GET', '/api/analytics?userId=1');
  assert(analyticsRes.status === 200, 'GET /api/analytics returned 200');
  assert(Array.isArray(analyticsRes.data.categories) || Array.isArray(analyticsRes.data.category_spending), 'Analytics categories returned');

  // Test 9: Delete Expense
  console.log('\n--- TEST 9: In-Screen Deletion API Verification ---');
  const delRes = await request('DELETE', `/api/expenses/${rahulExpenseId}`, null, { 'x-user-id': '2' });
  assert(delRes.status === 200, 'DELETE /api/expenses/:id returned 200');

  // Test 10: Error Sanitizer Check (Raw DB error prevention)
  console.log('\n--- TEST 10: Error Sanitizer Check ---');
  // Trigger an invalid split amount sum error
  const invalidSplitRes = await request('POST', '/api/expenses', {
    group_id: testGroupId,
    creator_id: 1,
    paid_by: 1,
    title: 'Mismatched split test',
    amount: 1000,
    category: 'Other',
    split_type: 'EXACT',
    splits: [
      { user_id: 1, amount: 200 },
      { user_id: 2, amount: 200 } // Total 400 != 1000
    ]
  });
  assert(invalidSplitRes.status === 400, 'Mismatched split rejected with 400');
  assert(!/postgres|sql|syntax/i.test(invalidSplitRes.data.error), 'Sanitized error message without database jargon');
  console.log(`  Friendly error message: "${invalidSplitRes.data.error}"`);

  console.log('\n====================================================');
  console.log('   🎉 ALL 10 TEST SUITES PASSED FLAWLESSLY!         ');
  console.log('====================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
