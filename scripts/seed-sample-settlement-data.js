/**
 * ==============================================================================
 * DUAL SETTLEMENT SYSTEM — SAMPLE DATA SEEDER
 * ==============================================================================
 * Seeds realistic, production-quality sample data matching:
 * 1. Phase 2 & 4: Multi-Payer Group Dinner (₹4,000 with 4 members, Karan owes Charlie ₹1,000)
 * 2. Phase 3: Combined Settlement set (Hotel ₹1,500, Dinner ₹800, Cab ₹400, Shopping ₹300 = ₹3,000)
 * 3. Phase 6: Pending Payment Confirmation Request for Charlie to review & accept/reject
 * 4. Audit History: Past accepted and rejected settlement requests
 *
 * Safe to run multiple times: idempotent and preserves master admin Charlie (ID: 1).
 * ==============================================================================
 */

const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function seedDualSettlementData() {
    console.log('--- SEEDING DUAL SETTLEMENT SAMPLE DATA ---');
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Verify Charlie exists (Master User ID: 1)
        const charlieRes = await client.query(`SELECT id, name, email FROM public.users WHERE id = 1 OR LOWER(email) = 'nxtcharlie20@gmail.com' LIMIT 1`);
        if (charlieRes.rows.length === 0) {
            throw new Error('Master user Charlie not found in database!');
        }
        const charlie = charlieRes.rows[0];
        console.log(`✓ Master user verified: ${charlie.name} (ID: ${charlie.id}, ${charlie.email})`);

        // Ensure Charlie has UPI handle
        await client.query(`UPDATE public.users SET upi_id = COALESCE(upi_id, 'charlie@okaxis'), avatar_initials = 'C' WHERE id = $1`, [charlie.id]);

        // 2. Ensure Peer Friends exist: Amit, Priya, Karan, Rahul
        const peers = [
            { name: 'Amit Sharma', username: 'Amit', email: 'amit.sharma@example.com', upi: 'amit@oksbi', initials: 'A' },
            { name: 'Priya Patel', username: 'Priya', email: 'priya.patel@example.com', upi: 'priya@okicici', initials: 'P' },
            { name: 'Karan Singh', username: 'Karan', email: 'karan.singh@example.com', upi: 'karan@okhdfc', initials: 'K' },
            { name: 'Rahul Verma', username: 'Rahul', email: 'rahul.verma@example.com', upi: 'rahul@okaxis', initials: 'R' }
        ];

        const peerUsers = {};
        const passwordHash = await bcrypt.hash('Password123!', 10);

        for (const p of peers) {
            let res = await client.query(`SELECT id, name, email FROM public.users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($2)`, [p.email, p.username]);
            if (res.rows.length === 0) {
                res = await client.query(`
                    INSERT INTO public.users (name, username, email, password_hash, role, is_active, upi_id, avatar_initials)
                    VALUES ($1, $2, $3, $4, 'user', true, $5, $6)
                    RETURNING id, name, email
                `, [p.name, p.username, p.email, passwordHash, p.upi, p.initials]);
                console.log(`✓ Created user: ${p.name} (ID: ${res.rows[0].id})`);
            } else {
                await client.query(`UPDATE public.users SET upi_id = $1, avatar_initials = $2 WHERE id = $3`, [p.upi, p.initials, res.rows[0].id]);
                console.log(`✓ Existing user: ${p.name} (ID: ${res.rows[0].id})`);
            }
            peerUsers[p.username] = res.rows[0];
        }

        const amit = peerUsers['Amit'];
        const priya = peerUsers['Priya'];
        const karan = peerUsers['Karan'];
        const rahul = peerUsers['Rahul'];

        // 3. Ensure Shared Group: "Goa Vacation Trip"
        let groupRes = await client.query(`SELECT id, name FROM public.groups WHERE name = 'Goa Vacation Trip' LIMIT 1`);
        let groupId;
        if (groupRes.rows.length === 0) {
            const grp = await client.query(`
                INSERT INTO public.groups (name, category, description, created_by)
                VALUES ('Goa Vacation Trip', 'Trip', 'Goa trip shared group with friends', $1)
                RETURNING id, name
            `, [charlie.id]);
            groupId = grp.rows[0].id;
            console.log(`✓ Created group: Goa Vacation Trip (ID: ${groupId})`);
        } else {
            groupId = groupRes.rows[0].id;
            console.log(`✓ Existing group: Goa Vacation Trip (ID: ${groupId})`);
        }

        // Add all members to group
        const allMembers = [charlie.id, amit.id, priya.id, karan.id, rahul.id];
        for (const uid of allMembers) {
            await client.query(`
                INSERT INTO public.group_members (group_id, user_id, role)
                VALUES ($1, $2, $3)
                ON CONFLICT (group_id, user_id) DO NOTHING
            `, [groupId, uid, uid === charlie.id ? 'admin' : 'member']);
        }

        // Clean up any old sample expenses with matching descriptions to make re-seeding completely clean
        const sampleDescriptions = [
            'Group Dinner (Multi-Payer)',
            'Hotel Booking',
            'Beachside Seafood Dinner',
            'Airport Cab & Transportation',
            'Souvenir & Flea Market Shopping',
            'Beach Shack Snacks (Settled Sample)'
        ];

        for (const desc of sampleDescriptions) {
            const existingExp = await client.query(`SELECT id FROM public.expenses WHERE group_id = $1 AND description = $2`, [groupId, desc]);
            for (const row of existingExp.rows) {
                await client.query(`DELETE FROM public.settlement_allocations WHERE expense_id = $1`, [row.id]);
                await client.query(`DELETE FROM public.payment_requests WHERE expense_id = $1`, [row.id]);
                await client.query(`DELETE FROM public.settlements WHERE expense_id = $1`, [row.id]);
                await client.query(`UPDATE public.expense_splits SET is_settled = false, settled_amount = 0, settled_amount_base = 0 WHERE expense_id = $1`, [row.id]);
                await client.query(`DELETE FROM public.expense_splits WHERE expense_id = $1`, [row.id]);
                await client.query(`DELETE FROM public.expense_payers WHERE expense_id = $1`, [row.id]);
                await client.query(`DELETE FROM public.expenses WHERE id = $1`, [row.id]);
            }
        }

        console.log('\n--- INSERTING SAMPLE EXPENSES ---');

        // =========================================================================
        // EXPENSE 1: Multi-Payer Dinner Example (Phase 2 & Phase 4)
        // Group Dinner — ₹4,000
        // Contributors: Charlie ₹2,000, Amit ₹1,000, Priya ₹1,000, Karan ₹0
        // Splits: ₹1,000 each
        // Net: Karan owes Charlie ₹1,000!
        // =========================================================================
        const exp1Res = await client.query(`
            INSERT INTO public.expenses (
                group_id, paid_by, description, amount, currency, category, split_type, expense_date, notes
            ) VALUES (
                $1, $2, 'Group Dinner (Multi-Payer)', 4000.00, 'INR', 'Food & Drinks', 'exact', CURRENT_DATE - INTERVAL '3 days',
                'Phase 2/4 prompt example: Charlie ₹2,000, Amit ₹1,000, Priya ₹1,000; Karan owes Charlie ₹1,000'
            ) RETURNING id
        `, [groupId, charlie.id]);
        const exp1Id = exp1Res.rows[0].id;

        // Contributors (expense_payers)
        await client.query(`
            INSERT INTO public.expense_payers (expense_id, user_id, amount) VALUES
            ($1, $2, 2000.00),
            ($1, $3, 1000.00),
            ($1, $4, 1000.00)
        `, [exp1Id, charlie.id, amit.id, priya.id]);

        // Splits (₹1,000 each for 4 members)
        const dinnerMembers = [charlie.id, amit.id, priya.id, karan.id];
        for (const uid of dinnerMembers) {
            await client.query(`
                INSERT INTO public.expense_splits (expense_id, user_id, amount, base_amount, settled_amount_base, is_settled)
                VALUES ($1, $2, 1000.00, 1000.00, 0.00, false)
            `, [exp1Id, uid]);
        }
        console.log(`✓ Expense 1 created: Group Dinner (Multi-Payer) [ID: ${exp1Id}] — ₹4,000 (Karan owes Charlie ₹1,000)`);

        // =========================================================================
        // EXPENSES 2-5: Combined Settlement Set (Phase 3 Example)
        // Rahul/Charlie paid for 4 expenses on behalf of Amit:
        // 1. Hotel Booking: ₹1,500
        // 2. Beachside Seafood Dinner: ₹800
        // 3. Airport Cab & Transportation: ₹400
        // 4. Souvenir & Flea Market Shopping: ₹300
        // Total Amit owes Charlie = ₹3,000 across 4 expenses.
        // =========================================================================
        const combinedSpecs = [
            { desc: 'Hotel Booking', amount: 1500.00, daysAgo: 4, cat: 'Travel & Stay' },
            { desc: 'Beachside Seafood Dinner', amount: 800.00, daysAgo: 3, cat: 'Food & Drinks' },
            { desc: 'Airport Cab & Transportation', amount: 400.00, daysAgo: 2, cat: 'Travel & Stay' },
            { desc: 'Souvenir & Flea Market Shopping', amount: 300.00, daysAgo: 1, cat: 'Entertainment' }
        ];

        const specExpIds = [];
        for (const spec of combinedSpecs) {
            const expRes = await client.query(`
                INSERT INTO public.expenses (
                    group_id, paid_by, description, amount, currency, category, split_type, expense_date, notes
                ) VALUES (
                    $1, $2, $3, $4, 'INR', $5, 'exact', CURRENT_DATE - INTERVAL '${spec.daysAgo} days', 'Phase 3 Combined Settlement test expense'
                ) RETURNING id
            `, [groupId, charlie.id, spec.desc, spec.amount, spec.cat]);
            const eid = expRes.rows[0].id;
            specExpIds.push(eid);

            // Contributor is Charlie
            await client.query(`INSERT INTO public.expense_payers (expense_id, user_id, amount) VALUES ($1, $2, $3)`, [eid, charlie.id, spec.amount]);

            // Debtor is Amit for full amount
            await client.query(`
                INSERT INTO public.expense_splits (expense_id, user_id, amount, base_amount, settled_amount_base, is_settled)
                VALUES ($1, $2, $3, $3, 0.00, false)
            `, [eid, amit.id, spec.amount]);

            console.log(`✓ Combined Expense created: ${spec.desc} [ID: ${eid}] — ₹${spec.amount} (Amit owes Charlie)`);
        }

        // =========================================================================
        // EXPENSE 6: Beach Shack Snacks (Already Settled Example for History)
        // Charlie paid ₹1,000, Rahul owed ₹1,000, now fully settled
        // =========================================================================
        const exp6Res = await client.query(`
            INSERT INTO public.expenses (
                group_id, paid_by, description, amount, currency, category, split_type, expense_date
            ) VALUES (
                $1, $2, 'Beach Shack Snacks (Settled Sample)', 1000.00, 'INR', 'Food & Drinks', 'exact', CURRENT_DATE - INTERVAL '5 days'
            ) RETURNING id
        `, [groupId, charlie.id]);
        const exp6Id = exp6Res.rows[0].id;
        await client.query(`INSERT INTO public.expense_payers (expense_id, user_id, amount) VALUES ($1, $2, 1000.00)`, [exp6Id, charlie.id]);
        await client.query(`
            INSERT INTO public.expense_splits (expense_id, user_id, amount, base_amount, settled_amount_base, is_settled, settled_at)
            VALUES ($1, $2, 1000.00, 1000.00, 1000.00, true, NOW() - INTERVAL '4 days')
        `, [exp6Id, rahul.id]);

        // Create the historical settlement & allocation
        const histSetRes = await client.query(`
            INSERT INTO public.settlements (
                group_id, payer_id, receiver_id, amount, settlement_type, expense_id, payment_method, notes, created_at
            ) VALUES (
                $1, $2, $3, 1000.00, 'EXPENSE_WISE', $4, 'UPI', 'Settled via Google Pay', NOW() - INTERVAL '4 days'
            ) RETURNING id
        `, [groupId, rahul.id, charlie.id, exp6Id]);
        const histSetId = histSetRes.rows[0].id;

        await client.query(`
            INSERT INTO public.settlement_allocations (settlement_id, expense_id, debtor_id, creditor_id, amount, created_at)
            VALUES ($1, $2, $3, $4, 1000.00, NOW() - INTERVAL '4 days')
        `, [histSetId, exp6Id, rahul.id, charlie.id]);

        // Historical accepted payment request
        const code1 = `PR-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        await client.query(`
            INSERT INTO public.payment_requests (
                request_code, payer_id, receiver_id, group_id, expense_id, amount, currency,
                payment_method, settlement_type, status, verification_source, idempotency_key,
                transaction_reference, note, created_at, responded_at
            ) VALUES (
                $1, $2, $3, $4, $5, 1000.00, 'INR',
                'UPI', 'EXPENSE_WISE', 'ACCEPTED', 'RECEIVER_CONFIRMED', $6,
                'UPI-HIST-11029', 'Paid via Google Pay QR', NOW() - INTERVAL '4 days', NOW() - INTERVAL '4 days'
            )
        `, [code1, rahul.id, charlie.id, groupId, exp6Id, `idem-${code1}`]);

        // =========================================================================
        // PENDING PAYMENT REQUEST (Phase 6 Workflow)
        // Amit sent a request to Charlie for ₹1,500 (Hotel Booking share)
        // Waiting for Charlie to Accept or Reject in the UI!
        // =========================================================================
        const code2 = `PR-${Date.now() + 1}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        await client.query(`
            INSERT INTO public.payment_requests (
                request_code, payer_id, receiver_id, group_id, expense_id, amount, currency,
                payment_method, settlement_type, status, verification_source, idempotency_key,
                transaction_reference, note, created_at
            ) VALUES (
                $1, $2, $3, $4, $5, 1500.00, 'INR',
                'UPI', 'EXPENSE_WISE', 'PENDING', 'RECEIVER_CONFIRMED', $6,
                'UPI-REF-99824', 'Paid ₹1,500 for Hotel Booking share via PhonePe', NOW() - INTERVAL '2 hours'
            )
        `, [code2, amit.id, charlie.id, groupId, specExpIds[0], `idem-${code2}`]);
        console.log(`✓ Seeded PENDING payment confirmation request: Amit -> Charlie (₹1,500) awaiting Charlie's approval!`);

        // Historical rejected payment request for history tab
        const code3 = `PR-${Date.now() + 2}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        await client.query(`
            INSERT INTO public.payment_requests (
                request_code, payer_id, receiver_id, group_id, expense_id, amount, currency,
                payment_method, settlement_type, status, verification_source, idempotency_key,
                transaction_reference, note, rejection_reason, created_at, responded_at
            ) VALUES (
                $1, $2, $3, $4, $5, 500.00, 'INR',
                'CASH', 'EXPENSE_WISE', 'REJECTED', 'RECEIVER_CONFIRMED', $6,
                'CASH-CLAIM-01', 'Handed over cash yesterday', 'Did not receive cash in person', NOW() - INTERVAL '1 day', NOW() - INTERVAL '20 hours'
            )
        `, [code3, karan.id, charlie.id, groupId, exp1Id, `idem-${code3}`]);
        console.log(`✓ Seeded historical REJECTED payment request: Karan -> Charlie (₹500)`);

        await client.query('COMMIT');
        console.log('\n=============================================================');
        console.log('✓ DUAL SETTLEMENT SAMPLE DATA SEEDED SUCCESSFULLY!');
        console.log('=============================================================');
        console.log('SUMMARY OF SEEDED FLOWS:');
        console.log(`1. Karan owes Charlie ₹1,000 for "Group Dinner (Multi-Payer)" [Expense-Wise]`);
        console.log(`2. Amit owes Charlie ₹3,000 across 4 expenses [Combined Settlement]:`);
        console.log(`   - Hotel Booking: ₹1,500`);
        console.log(`   - Beachside Seafood Dinner: ₹800`);
        console.log(`   - Airport Cab & Transportation: ₹400`);
        console.log(`   - Souvenir & Flea Market Shopping: ₹300`);
        console.log(`3. 1 Pending Payment Confirmation Request in Charlie's inbox:`);
        console.log(`   - Amit -> Charlie (₹1,500 for Hotel Booking) ready to Accept or Reject`);
        console.log(`4. Past payment request history: 1 Accepted (Rahul ₹1,000) & 1 Rejected (Karan ₹500)`);
        console.log('=============================================================');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Failed to seed sample data:', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

seedDualSettlementData();
