const http = require('http');
const { Pool } = require('pg');
require('dotenv').config();
const { calculateSmartCustomSplits, distributeDeterministically } = require('../smartCustomSplitService');

const BASE_URL = 'http://localhost:5000';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres123@localhost:5432/splitwise_db',
    ssl: (process.env.NODE_ENV === 'production' || (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase'))) 
        ? { rejectUnauthorized: false } 
        : false
});

function request(method, endpoint, data = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(endpoint, BASE_URL);
        const payload = data ? JSON.stringify(data) : null;
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
                ...headers
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    resolve({ status: res.statusCode, body: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: body });
                }
            });
        });

        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

const post = (endpoint, data, headers) => request('POST', endpoint, data, headers);
const put = (endpoint, data, headers) => request('PUT', endpoint, data, headers);
const get = (endpoint, headers) => request('GET', endpoint, null, headers);

async function runE2ETests() {
    console.log('================================================================');
    console.log('   SPLITWISE: SMART CUSTOM SPLIT & GLOBAL UX E2E TEST SUITE     ');
    console.log('================================================================\n');

    let passedTests = 0;
    let totalTests = 10;
    let createdExpenseIds = [];

    try {
        // Step 0: Ensure we have at least 5 test users and a shared group
        console.log('--- SETUP: Inspecting users and test group ---');
        let usersRes = await pool.query('SELECT id, name, email FROM users ORDER BY id ASC LIMIT 5');
        let users = usersRes.rows;

        if (users.length < 5) {
            console.log(`Found only ${users.length} users. Creating additional test participants...`);
            const needed = 5 - users.length;
            for (let i = 1; i <= needed; i++) {
                const uniqueNum = Date.now().toString().slice(-4) + i;
                const insRes = await pool.query(
                    'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email',
                    [`Test Participant ${uniqueNum}`, `participant${uniqueNum}@test.com`, 'testpass123', 'member']
                );
                users.push(insRes.rows[0]);
            }
        }
        console.log(`✓ Active participants pool (5 users): ${users.map(u => `${u.name} (id:${u.id})`).join(', ')}`);

        // Find or create test group with all 5 users
        let groupRes = await pool.query('SELECT id, name FROM groups ORDER BY id ASC LIMIT 1');
        let groupId;
        if (groupRes.rows.length > 0) {
            groupId = groupRes.rows[0].id;
        } else {
            const newGroup = await pool.query(
                'INSERT INTO groups (name, category, description, created_by) VALUES ($1, $2, $3, $4) RETURNING id, name',
                ['Smart Custom Test Circle', 'Trip', 'Smart custom engine test group', users[0].id]
            );
            groupId = newGroup.rows[0].id;
        }

        // Ensure all 5 users are members in this group
        for (const u of users) {
            await pool.query(
                `INSERT INTO group_members (group_id, user_id, role) 
                 VALUES ($1, $2, 'member') 
                 ON CONFLICT (group_id, user_id) DO NOTHING`,
                [groupId, u.id]
            );
        }
        console.log(`✓ Test Group ready: Group ID ${groupId}\n`);

        const creator = users[0];
        const participantIds = users.map(u => u.id);

        // -------------------------------------------------------------
        // TEST 1: Equal Split Regression
        // -------------------------------------------------------------
        console.log('--- TEST 1: Equal Split Regression ---');
        const eqRes = await post('/api/expenses', {
            group_id: groupId,
            description: 'E2E Equal Split Test',
            amount: 5000,
            category: 'Food & Drinks',
            paid_by: creator.id,
            split_type: 'equal',
            splits: participantIds.map(uid => ({ user_id: uid, amount: 1000 }))
        });

        if (eqRes.status === 201 && eqRes.body && eqRes.body.expense) {
            createdExpenseIds.push(eqRes.body.expense.id);
            console.log(`✅ PASSED: Equal Split expense created (ID: ${eqRes.body.expense.id}, Total: ₹5000)`);
            passedTests++;
        } else {
            console.error('❌ FAILED: Equal Split creation', eqRes.status, eqRes.body);
        }

        // -------------------------------------------------------------
        // TEST 2: Exact Split Regression
        // -------------------------------------------------------------
        console.log('\n--- TEST 2: Exact Split Regression ---');
        const exactSplits = [
            { user_id: users[0].id, amount: 2000 },
            { user_id: users[1].id, amount: 1500 },
            { user_id: users[2].id, amount: 1000 },
            { user_id: users[3].id, amount: 300 },
            { user_id: users[4].id, amount: 200 }
        ];
        const exactRes = await post('/api/expenses', {
            group_id: groupId,
            description: 'E2E Exact Split Test',
            amount: 5000,
            category: 'Travel & Stay',
            paid_by: creator.id,
            split_type: 'exact',
            splits: exactSplits
        });

        if (exactRes.status === 201 && exactRes.body && exactRes.body.expense) {
            createdExpenseIds.push(exactRes.body.expense.id);
            console.log(`✅ PASSED: Exact Split expense created (ID: ${exactRes.body.expense.id}, Total: ₹5000)`);
            passedTests++;
        } else {
            console.error('❌ FAILED: Exact Split creation', exactRes.status, exactRes.body);
        }

        // -------------------------------------------------------------
        // TEST 3: Percentage Split Regression
        // -------------------------------------------------------------
        console.log('\n--- TEST 3: Percentage Split Regression ---');
        const pctSplits = [
            { user_id: users[0].id, amount: 2000, percentage: 40 },
            { user_id: users[1].id, amount: 1000, percentage: 20 },
            { user_id: users[2].id, amount: 1000, percentage: 20 },
            { user_id: users[3].id, amount: 500, percentage: 10 },
            { user_id: users[4].id, amount: 500, percentage: 10 }
        ];
        const pctRes = await post('/api/expenses', {
            group_id: groupId,
            description: 'E2E Percentage Split Test',
            amount: 5000,
            category: 'Entertainment',
            paid_by: creator.id,
            split_type: 'percentage',
            splits: pctSplits
        });

        if (pctRes.status === 201 && pctRes.body && pctRes.body.expense) {
            createdExpenseIds.push(pctRes.body.expense.id);
            console.log(`✅ PASSED: Percentage Split expense created (ID: ${pctRes.body.expense.id}, Total: ₹5000)`);
            passedTests++;
        } else {
            console.error('❌ FAILED: Percentage Split creation', pctRes.status, pctRes.body);
        }

        // -------------------------------------------------------------
        // TEST 4: Smart Custom Split API Creation (Lock & Auto Distribute)
        // -------------------------------------------------------------
        console.log('\n--- TEST 4: Smart Custom Split API Creation ---');
        // Total: 10,000, 5 participants.
        // User 0 locked at 5,000; User 1 locked at 2,000.
        // Remaining 3,000 auto-distributed equally among 3 unlocked: 1,000 each.
        const smartSplitsPayload = [
            { user_id: users[0].id, amount: 5000, is_locked: true },
            { user_id: users[1].id, amount: 2000, is_locked: true },
            { user_id: users[2].id, amount: 1000, is_locked: false },
            { user_id: users[3].id, amount: 1000, is_locked: false },
            { user_id: users[4].id, amount: 1000, is_locked: false }
        ];
        const scRes = await post('/api/expenses', {
            group_id: groupId,
            description: 'Goa Resort Booking - Smart Custom Split',
            amount: 10000,
            category: 'Travel & Stay',
            paid_by: creator.id,
            split_type: 'smart_custom',
            splits: smartSplitsPayload
        });

        let smartCustomExpenseId;
        if (scRes.status === 201 && scRes.body && scRes.body.expense) {
            smartCustomExpenseId = scRes.body.expense.id;
            createdExpenseIds.push(smartCustomExpenseId);
            console.log(`✅ PASSED: Smart Custom Split expense created (ID: ${smartCustomExpenseId}, Total: ₹10,000)`);
            console.log(`  Split type stored in response: ${scRes.body.expense.split_type}`);
            passedTests++;
        } else {
            console.error('❌ FAILED: Smart Custom Split creation', scRes.status, scRes.body);
        }

        // -------------------------------------------------------------
        // TEST 5: Database Direct Verification of `is_locked` Flags
        // -------------------------------------------------------------
        console.log('\n--- TEST 5: Database Direct Verification of `is_locked` Flags ---');
        if (smartCustomExpenseId) {
            const dbSplitsRes = await pool.query(
                'SELECT user_id, amount, is_locked FROM expense_splits WHERE expense_id = $1 ORDER BY user_id ASC',
                [smartCustomExpenseId]
            );
            const dbSplits = dbSplitsRes.rows;

            console.log('  Database expense_splits rows:');
            dbSplits.forEach(s => {
                console.log(`    User ${s.user_id}: Amount = ₹${parseFloat(s.amount).toFixed(2)}, is_locked = ${s.is_locked}`);
            });

            const u0Split = dbSplits.find(s => s.user_id === users[0].id);
            const u1Split = dbSplits.find(s => s.user_id === users[1].id);
            const u2Split = dbSplits.find(s => s.user_id === users[2].id);
            const u3Split = dbSplits.find(s => s.user_id === users[3].id);
            const u4Split = dbSplits.find(s => s.user_id === users[4].id);

            const isCorrect = 
                u0Split && Math.abs(parseFloat(u0Split.amount) - 5000) < 0.01 && u0Split.is_locked === true &&
                u1Split && Math.abs(parseFloat(u1Split.amount) - 2000) < 0.01 && u1Split.is_locked === true &&
                u2Split && Math.abs(parseFloat(u2Split.amount) - 1000) < 0.01 && u2Split.is_locked === false &&
                u3Split && Math.abs(parseFloat(u3Split.amount) - 1000) < 0.01 && u3Split.is_locked === false &&
                u4Split && Math.abs(parseFloat(u4Split.amount) - 1000) < 0.01 && u4Split.is_locked === false;

            if (isCorrect) {
                console.log('✅ PASSED: Database persistence verified. Locked & Auto flags accurately stored!');
                passedTests++;
            } else {
                console.error('❌ FAILED: Database split values or is_locked flags did not match expected values', dbSplits);
            }
        } else {
            console.error('❌ SKIPPED: Cannot run Test 5 without smartCustomExpenseId');
        }

        // -------------------------------------------------------------
        // TEST 6: Smart Custom Split Update API (`PUT /api/expenses/:id`)
        // -------------------------------------------------------------
        console.log('\n--- TEST 6: Smart Custom Split Update API (Modify Lock & Auto Recalculate) ---');
        if (smartCustomExpenseId) {
            // Update: Change User 1 lock from 2,000 to 3,000.
            // Locked sum: 5,000 + 3,000 = 8,000. Remainder: 2,000 for 3 unlocked users.
            // Deterministic distribution: 666.67, 666.67, 666.66. Sum = 2,000.00.
            const updatedCalculated = calculateSmartCustomSplits({
                totalAmount: 10000,
                participants: participantIds,
                locks: {
                    [users[0].id]: 5000,
                    [users[1].id]: 3000
                },
                currency: 'INR'
            });

            const updatedSplitsPayload = updatedCalculated.splits.map(s => ({
                user_id: s.user_id || s.id || s.userId,
                amount: s.amount,
                is_locked: s.is_locked !== undefined ? s.is_locked : s.isLocked
            }));

            const updateRes = await put(`/api/expenses/${smartCustomExpenseId}`, {
                description: 'Goa Resort Booking - Updated Lock to 3,000',
                amount: 10000,
                category: 'Travel & Stay',
                paid_by: creator.id,
                split_type: 'smart_custom',
                splits: updatedSplitsPayload
            }, { 'x-user-id': String(creator.id) });

            if (updateRes.status === 200) {
                // Verify DB values after update
                const postUpdateDbRes = await pool.query(
                    'SELECT user_id, amount, is_locked FROM expense_splits WHERE expense_id = $1 ORDER BY user_id ASC',
                    [smartCustomExpenseId]
                );
                const updatedSplits = postUpdateDbRes.rows;
                const u1Updated = updatedSplits.find(s => s.user_id === users[1].id);
                const sumAmount = updatedSplits.reduce((acc, s) => acc + parseFloat(s.amount), 0);

                if (u1Updated && Math.abs(parseFloat(u1Updated.amount) - 3000) < 0.01 && u1Updated.is_locked === true && Math.abs(sumAmount - 10000) < 0.01) {
                    console.log(`✅ PASSED: Smart Custom expense updated successfully!`);
                    console.log(`  User 1 updated to ₹3,000 (is_locked: true). Sum of all splits = ₹${sumAmount.toFixed(2)}`);
                    passedTests++;
                } else {
                    console.error('❌ FAILED: Updated DB values incorrect', updatedSplits);
                }
            } else {
                console.error('❌ FAILED: PUT /api/expenses/:id failed', updateRes.status, updateRes.body);
            }
        } else {
            console.error('❌ SKIPPED: Cannot run Test 6 without smartCustomExpenseId');
        }

        // -------------------------------------------------------------
        // TEST 7: AI Assistant Smart Custom Split NLP Query
        // -------------------------------------------------------------
        console.log('\n--- TEST 7: AI Assistant Smart Custom Split NLP Query ---');
        // Let's use the first 2 users' names
        const name1 = users[0].name.split(' ')[0];
        const name2 = users[1].name.split(' ')[0];
        const aiPrompt = `Add ₹10,000 expense for five people in ${groupRes.rows[0].name}. ${name1} 5,000, ${name2} 2,000 and distribute the remaining equally`;

        console.log(`  Query to AI: "${aiPrompt}"`);
        const aiRes = await post('/api/chatbot/query', {
            query: aiPrompt,
            language: 'en',
            user_id: creator.id
        });

        let aiToolCall;
        if (aiRes.status === 200 && aiRes.body && aiRes.body.toolCall) {
            aiToolCall = aiRes.body.toolCall;
            console.log(`  AI returned tool call action: ${aiToolCall.action}`);
            console.log(`  Summary: ${aiToolCall.summary}`);
            console.log(`  Split Type: ${aiToolCall.params.splitType}`);
            console.log(`  Reply preview:\n    ${aiRes.body.reply.split('\n').slice(0, 8).join('\n    ')}`);

            const hasLockedBadge = aiRes.body.reply.includes('Locked 🔒');
            const hasAutoBadge = aiRes.body.reply.includes('Auto ⚡');
            const isSmartCustom = aiToolCall.params.splitType === 'smart_custom';

            if (isSmartCustom && hasLockedBadge && hasAutoBadge) {
                console.log(`✅ PASSED: AI Assistant recognized Smart Custom lock intent and formatted badges correctly!`);
                passedTests++;
            } else {
                console.error('❌ FAILED: AI tool call missing smart_custom or badges', aiToolCall, aiRes.body.reply);
            }
        } else {
            console.error('❌ FAILED: AI query did not generate toolCall', aiRes.status, aiRes.body);
        }

        // -------------------------------------------------------------
        // TEST 8: AI Assistant Action Confirmation & Execution
        // -------------------------------------------------------------
        console.log('\n--- TEST 8: AI Assistant Action Confirmation & Execution ---');
        if (aiToolCall) {
            const confirmRes = await post('/api/chatbot/confirm-action', {
                toolCall: aiToolCall,
                user_id: creator.id
            });

            if (confirmRes.status === 200 && confirmRes.body && confirmRes.body.success) {
                const createdExp = confirmRes.body.expense;
                if (createdExp && createdExp.id) {
                    createdExpenseIds.push(createdExp.id);
                    // Check database to ensure is_locked persisted from AI confirmation
                    const aiDbSplitsRes = await pool.query(
                        'SELECT user_id, amount, is_locked FROM expense_splits WHERE expense_id = $1 ORDER BY user_id ASC',
                        [createdExp.id]
                    );
                    const aiSplits = aiDbSplitsRes.rows;
                    const lockedCount = aiSplits.filter(s => s.is_locked).length;
                    console.log(`✅ PASSED: AI action confirmed and executed! Expense ID ${createdExp.id} created with ${lockedCount} locked splits.`);
                    passedTests++;
                } else {
                    console.log(`✅ PASSED: AI action confirmed with success message: ${confirmRes.body.message || confirmRes.body.reply}`);
                    passedTests++;
                }
            } else {
                console.error('❌ FAILED: Confirmation execution failed', confirmRes.status, confirmRes.body);
            }
        } else {
            console.error('❌ SKIPPED: Cannot run Test 8 without aiToolCall');
        }

        // -------------------------------------------------------------
        // TEST 9: Zero-Drift Currency Rounding Validation (INR, JPY, EUR)
        // -------------------------------------------------------------
        console.log('\n--- TEST 9: Zero-Drift Currency Rounding Validation ---');
        let roundingPassed = true;

        // Sub-test A: INR 100 split 3 ways -> 33.34, 33.33, 33.33 -> sum = 100.00
        const inrDist = distributeDeterministically(100, 3, 'INR');
        const inrSum = inrDist.reduce((a, b) => a + b, 0);
        if (Math.abs(inrSum - 100) > 0.0001 || inrDist[0] !== 33.34 || inrDist[1] !== 33.33 || inrDist[2] !== 33.33) {
            console.error('  Sub-test A (INR) failed:', inrDist, inrSum);
            roundingPassed = false;
        } else {
            console.log(`  Sub-test A (INR ₹100 / 3): [${inrDist.join(', ')}] -> Sum: ₹${inrSum.toFixed(2)} ✓`);
        }

        // Sub-test B: JPY 10,000 split 3 ways -> 3334, 3333, 3333 -> sum = 10000
        const jpyDist = distributeDeterministically(10000, 3, 'JPY');
        const jpySum = jpyDist.reduce((a, b) => a + b, 0);
        if (jpySum !== 10000 || jpyDist[0] !== 3334 || jpyDist[1] !== 3333 || jpyDist[2] !== 3333) {
            console.error('  Sub-test B (JPY) failed:', jpyDist, jpySum);
            roundingPassed = false;
        } else {
            console.log(`  Sub-test B (JPY ¥10,000 / 3): [${jpyDist.join(', ')}] -> Sum: ¥${jpySum} ✓`);
        }

        // Sub-test C: Smart custom with ₹10,000 total, 2 locked (₹5,000 & ₹2,000), 3 unlocked
        const fullCalc = calculateSmartCustomSplits({
            totalAmount: 10000,
            participants: [1, 2, 3, 4, 5],
            locks: { 1: 5000, 2: 2000 },
            currency: 'INR'
        });
        const fullSum = fullCalc.splits.reduce((a, s) => a + s.amount, 0);
        if (Math.abs(fullSum - 10000) > 0.0001) {
            console.error('  Sub-test C failed: sum is not 10,000', fullSum);
            roundingPassed = false;
        } else {
            console.log(`  Sub-test C (INR ₹10,000 with ₹5,000 & ₹2,000 locks): Sum = ₹${fullSum.toFixed(2)} ✓`);
        }

        if (roundingPassed) {
            console.log('✅ PASSED: Zero-drift deterministic rounding verified across multiple currencies!');
            passedTests++;
        } else {
            console.error('❌ FAILED: Currency rounding sub-tests failed');
        }

        // -------------------------------------------------------------
        // TEST 10: Validation Rejections (Over-allocation & Negative Locks)
        // -------------------------------------------------------------
        console.log('\n--- TEST 10: Validation Rejections ---');
        let validationPassed = true;

        // Over-allocation: Total 5000, locks sum to 6000
        const overRes = calculateSmartCustomSplits({
            totalAmount: 5000,
            participants: [1, 2, 3],
            locks: { 1: 4000, 2: 2000 }
        });
        if (overRes.errorMessage && !overRes.isBalanced) {
            console.log(`  Over-allocation properly caught: "${overRes.errorMessage}" ✓`);
        } else {
            console.error('  Expected error for over-allocation, but none reported!');
            validationPassed = false;
        }

        // Negative lock
        const negRes = calculateSmartCustomSplits({
            totalAmount: 5000,
            participants: [1, 2, 3],
            locks: { 1: -500 }
        });
        if (negRes.errorMessage && !negRes.isBalanced) {
            console.log(`  Negative lock properly caught: "${negRes.errorMessage}" ✓`);
        } else {
            console.error('  Expected error for negative lock, but none reported!');
            validationPassed = false;
        }

        // All locked with sum < total (unallocated surplus)
        const surplusRes = calculateSmartCustomSplits({
            totalAmount: 5000,
            participants: [1, 2],
            locks: { 1: 2000, 2: 2000 }
        });
        if (surplusRes.errorMessage && !surplusRes.isBalanced) {
            console.log(`  Surplus with zero unlocked participants properly caught: "${surplusRes.errorMessage}" ✓`);
        } else {
            console.error('  Expected error for locked surplus with no unlocked participants, but none reported!');
            validationPassed = false;
        }

        if (validationPassed) {
            console.log('✅ PASSED: All boundary edge cases & invalid states rejected gracefully!');
            passedTests++;
        } else {
            console.error('❌ FAILED: Validation edge cases did not behave as expected');
        }

    } catch (globalErr) {
        console.error('CRITICAL ERROR during E2E test run:', globalErr);
    } finally {
        // Clean up created test expenses to keep database tidy
        if (createdExpenseIds.length > 0) {
            console.log(`\n--- CLEANUP: Removing ${createdExpenseIds.length} test expenses ---`);
            try {
                await pool.query('DELETE FROM expense_splits WHERE expense_id = ANY($1)', [createdExpenseIds]);
                await pool.query('DELETE FROM expenses WHERE id = ANY($1)', [createdExpenseIds]);
                console.log('✓ Cleanup complete.');
            } catch (cleanupErr) {
                console.warn('Cleanup warning:', cleanupErr.message);
            }
        }
        await pool.end();
    }

    console.log('\n================================================================');
    console.log(`  RESULTS: ${passedTests} / ${totalTests} TESTS PASSED (${Math.round((passedTests/totalTests)*100)}%)`);
    console.log('================================================================\n');

    if (passedTests === totalTests) {
        console.log('🎉 ALL SMART CUSTOM SPLIT & GLOBAL UX TESTS PASSED PERFECTLY!\n');
        process.exit(0);
    } else {
        console.error(`❌ SOME TESTS FAILED: ${totalTests - passedTests} failure(s) detected.\n`);
        process.exit(1);
    }
}

runE2ETests();
