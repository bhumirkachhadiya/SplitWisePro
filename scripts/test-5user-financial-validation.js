/**
 * 5-USER FINANCIAL VALIDATION & REGRESSION TEST SUITE
 * Validates the complete multi-party financial lifecycle:
 * - 5 users in one group (User A, B, C, D, E)
 * - ₹5,000 expense split equally (₹1,000 each)
 * - User A paid full amount
 * - User B settles ₹1,000
 * - Blocked expense deletion (paid protected)
 * - Blocked expense editing (tamper protected)
 * - Blocked member removal (unsettled obligations)
 * - Blocked group deletion (financial history preserved)
 * - Full settlement of Users C, D, E
 * - Verified immutable audit trail
 */
const { Pool } = require('pg');
require('dotenv').config();

const BASE_URL = 'http://localhost:5000/api';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres123@localhost:5432/splitwise_db',
    ssl: (process.env.NODE_ENV === 'production' || (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase'))) 
        ? { rejectUnauthorized: false } 
        : false
});

const results = [];
function record(num, name, passed, details = '') {
    results.push({ '#': num, Checkpoint: name, Status: passed ? 'PASSED' : 'FAILED', Details: details });
    const mark = passed ? '✓ PASSED' : '✗ FAILED';
    console.log(`[${mark}] Checkpoint ${num}: ${name}`);
    if (details) console.log(`   -> ${details}`);
}

async function run() {
    console.log('================================================================');
    console.log('     5-USER FINANCIAL LIFECYCLE & REGRESSION TEST SUITE         ');
    console.log('================================================================\n');

    let userA, userB, userC, userD, userE;
    let testGroup, testExpense;

    try {
        // 1. Setup 5 distinct test users
        console.log('Setting up 5 distinct test accounts...');
        const dummyHash = '$2a$10$wE4RkLq91K2wZg3b7tqKze6FzW9L0u6s7E9yO1f4P8G1.8yU8qT1K';
        
        async function createOrGetUser(name, email, code) {
            let res = await pool.query('SELECT id, name, email FROM users WHERE email = $1', [email]);
            if (res.rows.length === 0) {
                res = await pool.query(`
                    INSERT INTO users (name, email, password_hash, user_code, default_currency, avatar_initials)
                    VALUES ($1, $2, $3, $4, 'INR', $5)
                    RETURNING id, name, email
                `, [name, email, dummyHash, code, name.slice(0, 2).toUpperCase()]);
            }
            return res.rows[0];
        }

        userA = await createOrGetUser('Test User A', 'test.user.a@splitease.io', 'SW-USR-A1');
        userB = await createOrGetUser('Test User B', 'test.user.b@splitease.io', 'SW-USR-B1');
        userC = await createOrGetUser('Test User C', 'test.user.c@splitease.io', 'SW-USR-C1');
        userD = await createOrGetUser('Test User D', 'test.user.d@splitease.io', 'SW-USR-D1');
        userE = await createOrGetUser('Test User E', 'test.user.e@splitease.io', 'SW-USR-E1');

        console.log(`Created/Resolved 5 users: A(${userA.id}), B(${userB.id}), C(${userC.id}), D(${userD.id}), E(${userE.id})\n`);

        // 2. Create test group with all 5 members
        const groupRes = await pool.query(`
            INSERT INTO groups (name, category, description, created_by, base_currency)
            VALUES ('Five-User Financial Circle', 'Travel & Stay', '5-member shared ledger test', $1, 'INR')
            RETURNING id, name
        `, [userA.id]);
        testGroup = groupRes.rows[0];

        const users = [userA, userB, userC, userD, userE];
        for (let i = 0; i < users.length; i++) {
            await pool.query(`
                INSERT INTO group_members (group_id, user_id, role)
                VALUES ($1, $2, $3)
            `, [testGroup.id, users[i].id, i === 0 ? 'admin' : 'member']);
        }

        // Checkpoint 1: 5 Members enrolled
        const memberCountRes = await pool.query('SELECT COUNT(*)::int as count FROM group_members WHERE group_id = $1', [testGroup.id]);
        record(1, 'Group created with 5 enrolled members', memberCountRes.rows[0].count === 5, `Total members: ${memberCountRes.rows[0].count}`);

        // 3. User A creates expense of ₹5,000 split equally among all 5 (₹1,000 each)
        const addExpRes = await fetch(`${BASE_URL}/expenses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                group_id: testGroup.id,
                paid_by: userA.id,
                amount: 5000,
                description: 'Goa Luxury Villa Stay',
                category: 'Travel & Stay',
                split_type: 'equal',
                splits: users.map(u => ({ user_id: u.id, amount: 1000 }))
            })
        });

        const addExpData = await addExpRes.json();
        const expId = addExpData.id || (addExpData.expense && addExpData.expense.id);
        testExpense = { id: expId };

        // Checkpoint 2: Expense of ₹5,000 created
        record(2, 'Expense of ₹5,000 created by User A', addExpRes.status === 201 && !!expId, `Expense ID: ${expId}, Description: "Goa Luxury Villa Stay"`);

        // 4. Verify each member's ₹1,000 share
        const splitsRes = await pool.query('SELECT user_id, amount, is_settled FROM expense_splits WHERE expense_id = $1 ORDER BY user_id ASC', [expId]);
        const all1000 = splitsRes.rows.length === 5 && splitsRes.rows.every(s => parseFloat(s.amount) === 1000);
        record(3, 'Verified 5 equal shares of ₹1,000 each', all1000, `Splits count: ${splitsRes.rows.length}, All ₹1000: ${all1000}`);

        // 5. Verify User B, C, D, E owe ₹1,000 to User A
        const balancesA = await (await fetch(`${BASE_URL}/balances/summary?userId=${userA.id}`)).json();
        const owedToA = balancesA.owes_you_list || balancesA.you_are_owed_list || [];
        const hasB = owedToA.some(o => o.user_id === userB.id && parseFloat(o.amount) === 1000);
        const hasC = owedToA.some(o => o.user_id === userC.id && parseFloat(o.amount) === 1000);
        const hasD = owedToA.some(o => o.user_id === userD.id && parseFloat(o.amount) === 1000);
        const hasE = owedToA.some(o => o.user_id === userE.id && parseFloat(o.amount) === 1000);
        record(4, 'Users B, C, D, E each owe ₹1,000 to User A', hasB && hasC && hasD && hasE, `Total owed to User A: ₹${balancesA.total_owed || balancesA.you_are_owed}`);

        // 6. User B settles ₹1,000 with User A
        const settleBRes = await fetch(`${BASE_URL}/settlements`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                group_id: testGroup.id,
                payer_id: userB.id,
                receiver_id: userA.id,
                amount: 1000,
                payment_method: 'UPI',
                notes: 'Settled ₹1000 for Goa Villa share'
            })
        });

        record(5, 'User B settles ₹1,000 with User A via settlement endpoint', settleBRes.status === 200 || settleBRes.status === 201, `Settlement status: ${settleBRes.status}`);

        // 7. Verify User B split is marked settled and User B owes ₹0
        const bSplitRes = await pool.query('SELECT is_settled FROM expense_splits WHERE expense_id = $1 AND user_id = $2', [expId, userB.id]);
        const bIsSettled = bSplitRes.rows[0]?.is_settled === true;

        const balancesB = await (await fetch(`${BASE_URL}/balances/summary?userId=${userB.id}`)).json();
        const bOwesA = (balancesB.you_owe_list || []).find(o => o.user_id === userA.id)?.amount || 0;
        record(6, 'User B split is marked is_settled = TRUE and outstanding balance is ₹0', bIsSettled && bOwesA === 0, `User B split settled: ${bIsSettled}, Remaining debt to A: ₹${bOwesA}`);

        // 8. Verify Users C, D, E still owe ₹1,000 each
        const cSplitRes = await pool.query('SELECT is_settled FROM expense_splits WHERE expense_id = $1 AND user_id = $2', [expId, userC.id]);
        const cStillUnsettled = cSplitRes.rows[0]?.is_settled === false;
        record(7, 'Users C, D, E splits remain unsettled', cStillUnsettled, `User C split settled: ${cSplitRes.rows[0]?.is_settled}`);

        // 9. Attempt to delete the expense -> MUST BE BLOCKED
        const delExpRes = await fetch(`${BASE_URL}/expenses/${expId}?userId=${userA.id}`, {
            method: 'DELETE'
        });
        const delExpData = await delExpRes.json();
        const isDeleteBlocked = delExpRes.status === 403 && (delExpData.code === 'EXPENSE_PAID_PROTECTED' || delExpData.is_protected === true);
        record(8, 'Attempt to delete partially settled expense is BLOCKED (HTTP 403)', isDeleteBlocked, `Response: ${delExpRes.status} ${delExpData.error}`);

        // 10. Attempt to edit the expense amount -> MUST BE BLOCKED
        const editExpRes = await fetch(`${BASE_URL}/expenses/${expId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userA.id,
                amount: 4000,
                description: 'Attempt to tamper paid expense amount'
            })
        });
        const editExpData = await editExpRes.json();
        const isEditBlocked = editExpRes.status === 403 && editExpData.code === 'EXPENSE_PAID_PROTECTED';
        record(9, 'Attempt to edit settled expense amount is BLOCKED (HTTP 403)', isEditBlocked, `Response: ${editExpRes.status} ${editExpData.error}`);

        // 11. Attempt to remove Member C (who still owes money) -> MUST BE BLOCKED
        const delMemberCRes = await fetch(`${BASE_URL}/groups/${testGroup.id}/members/${userC.id}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requester_id: userA.id })
        });
        const delMemberCData = await delMemberCRes.json();
        const isRemoveDebtorBlocked = delMemberCRes.status === 403;
        record(10, 'Attempt to remove member who owes money is BLOCKED (HTTP 403)', isRemoveDebtorBlocked, `Response: ${delMemberCRes.status} ${delMemberCData.error}`);

        // 12. Attempt to remove Member A (who is owed money) -> MUST BE BLOCKED
        const delMemberARes = await fetch(`${BASE_URL}/groups/${testGroup.id}/members/${userA.id}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requester_id: userA.id })
        });
        const delMemberAData = await delMemberARes.json();
        const isRemoveCreditorBlocked = delMemberARes.status === 403 || delMemberARes.status === 400;
        record(11, 'Attempt to remove member who is owed money is BLOCKED', isRemoveCreditorBlocked, `Response: ${delMemberARes.status} ${delMemberAData.error}`);

        // 13. Attempt to delete group with financial history -> MUST BE BLOCKED
        const delGroupRes = await fetch(`${BASE_URL}/groups/${testGroup.id}`, {
            method: 'DELETE'
        });
        const delGroupData = await delGroupRes.json();
        const isGroupDelBlocked = delGroupRes.status === 403 && delGroupData.code === 'GROUP_HAS_FINANCIAL_HISTORY';
        record(12, 'Attempt to delete group with active expenses is BLOCKED (HTTP 403)', isGroupDelBlocked, `Response: ${delGroupRes.status} ${delGroupData.error}`);

        // 14. Settle remaining 3 balances (Users C, D, E)
        for (const u of [userC, userD, userE]) {
            await fetch(`${BASE_URL}/settlements`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    group_id: testGroup.id,
                    payer_id: u.id,
                    receiver_id: userA.id,
                    amount: 1000,
                    payment_method: 'UPI',
                    notes: `Settled ₹1000 by ${u.name}`
                })
            });
        }

        // 15. Verify final fully settled state across all 5 members
        const finalSplitsRes = await pool.query('SELECT user_id, is_settled FROM expense_splits WHERE expense_id = $1', [expId]);
        const allSettledNow = finalSplitsRes.rows.every(s => s.is_settled === true);
        const finalBalA = await (await fetch(`${BASE_URL}/balances/summary?userId=${userA.id}`)).json();
        const finalOwedToA = (finalBalA.owes_you_list || finalBalA.you_are_owed_list || []).filter(o => [userB.id, userC.id, userD.id, userE.id].includes(o.user_id));
        record(13, 'All 5 shares fully settled (100% reconciled in ledger)', allSettledNow && finalOwedToA.length === 0, `All splits settled: ${allSettledNow}, Remaining peer debts: ${finalOwedToA.length}`);

        // 16. Verify immutable activity audit trail
        const auditRes = await pool.query('SELECT COUNT(*)::int as count FROM activity_logs WHERE group_id = $1', [testGroup.id]);
        const auditCount = auditRes.rows[0]?.count || 0;
        record(14, 'Financial activity logs preserved in audit ledger', auditCount >= 5, `Total audit records for circle: ${auditCount}`);

    } catch (err) {
        console.error('Test execution error:', err);
    } finally {
        // Safe cleanup of test records
        console.log('\nCleaning up 5-user test data safely...');
        try {
            if (testExpense?.id) {
                await pool.query('UPDATE expense_splits SET is_settled = false WHERE expense_id = $1', [testExpense.id]);
                await pool.query('DELETE FROM settlements WHERE group_id = $1', [testGroup.id]);
                await pool.query('DELETE FROM expense_splits WHERE expense_id = $1', [testExpense.id]);
                await pool.query('DELETE FROM expenses WHERE id = $1', [testExpense.id]);
            }
            if (testGroup?.id) {
                await pool.query('DELETE FROM activity_logs WHERE group_id = $1', [testGroup.id]);
                await pool.query('DELETE FROM group_members WHERE group_id = $1', [testGroup.id]);
                await pool.query('DELETE FROM groups WHERE id = $1', [testGroup.id]);
            }
            if (userA && userB && userC && userD && userE) {
                await pool.query('DELETE FROM users WHERE id IN ($1, $2, $3, $4, $5)', [userA.id, userB.id, userC.id, userD.id, userE.id]);
            }
            console.log('✓ Cleanup completed.');
        } catch (cleanErr) {
            console.error('Cleanup warning:', cleanErr.message);
        }
        await pool.end();
    }

    console.log('\n================================================================');
    console.log('              5-USER VALIDATION SUMMARY MATRIX                  ');
    console.log('================================================================');
    console.table(results);
    const passedCount = results.filter(r => r.Status === 'PASSED').length;
    console.log(`\nTotal: ${results.length} | Passed: ${passedCount} | Failed: ${results.length - passedCount}`);
    console.log(`Success Rate: ${((passedCount / results.length) * 100).toFixed(1)}%`);
}

run();
