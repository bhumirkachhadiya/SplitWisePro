const { pool } = require('../db');

async function testCorrection() {
    console.log('======================================================');
    console.log('TESTING CORRECTED GROUP SPEND CALCULATION');
    console.log('======================================================');

    const users = await pool.query('SELECT id, name FROM users ORDER BY id ASC');
    let totalChecks = 0;
    let passedChecks = 0;

    for (const u of users.rows) {
        // Run the corrected query for user u
        const res = await pool.query(`
            SELECT g.id, g.name, 
                   COUNT(DISTINCT gm.user_id) as member_count,
                   COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.group_id = g.id), 0) as total_spend
            FROM groups g
            LEFT JOIN group_members gm ON g.id = gm.group_id
            WHERE EXISTS (SELECT 1 FROM group_members gm2 WHERE gm2.group_id = g.id AND gm2.user_id = $1)
            GROUP BY g.id
            ORDER BY g.id ASC
        `, [u.id]);

        for (const g of res.rows) {
            // Check against ground truth directly from expenses table
            const expTruth = await pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE group_id = $1', [g.id]);
            const truthTotal = parseFloat(expTruth.rows[0].total);
            const queryTotal = parseFloat(g.total_spend);

            totalChecks++;
            const match = Math.abs(truthTotal - queryTotal) < 0.001;
            if (match) {
                passedChecks++;
            } else {
                console.error(`❌ MISMATCH in User ${u.name} for Group [${g.id}] "${g.name}": Expected ₹${truthTotal}, Got ₹${queryTotal}`);
            }
        }
    }

    console.log(`\nResults: ${passedChecks} / ${totalChecks} checks passed (${Math.round(passedChecks / totalChecks * 100)}%)`);

    // Verify key test groups explicitly:
    const targetGroups = ['Demofrjbt', 'Spiti valley trip', 'Diwali Testing', 'Goa Trip 2024'];
    console.log('\n--- TARGET GROUP INSPECTION ---');
    for (const name of targetGroups) {
        const gRes = await pool.query('SELECT id, name FROM groups WHERE name ILIKE $1 LIMIT 1', [`%${name}%`]);
        if (gRes.rows.length > 0) {
            const g = gRes.rows[0];
            const expRes = await pool.query('SELECT id, description, amount FROM expenses WHERE group_id = $1', [g.id]);
            const gmRes = await pool.query('SELECT user_id FROM group_members WHERE group_id = $1', [g.id]);
            const total = expRes.rows.reduce((s, e) => s + parseFloat(e.amount), 0);
            
            const fixedRes = await pool.query(`
                SELECT g.id, g.name, 
                       COUNT(DISTINCT gm.user_id) as member_count,
                       COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.group_id = g.id), 0) as total_spend
                FROM groups g
                LEFT JOIN group_members gm ON g.id = gm.group_id
                WHERE g.id = $1
                GROUP BY g.id
            `, [g.id]);

            console.log(`\nGroup "${g.name}" [ID: ${g.id}]:`);
            console.log(`  Members: ${gmRes.rows.length}`);
            console.log(`  Expenses: ${expRes.rows.map(e => `₹${e.amount}`).join(' + ')} = ₹${total}`);
            console.log(`  Corrected Group Spend: ₹${fixedRes.rows[0].total_spend}`);
        }
    }

    process.exit(passedChecks === totalChecks ? 0 : 1);
}

testCorrection();
