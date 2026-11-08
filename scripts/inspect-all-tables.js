require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function main() {
    try {
        const tablesRes = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        `);
        console.log('Tables found:', tablesRes.rows.length);

        for (const row of tablesRes.rows) {
            const t = row.table_name;
            try {
                const countRes = await pool.query(`SELECT COUNT(*) FROM "${t}"`);
                console.log(`- ${t}: ${countRes.rows[0].count} rows`);
            } catch (err) {
                console.log(`- ${t}: error counting (${err.message})`);
            }
        }

        console.log('\n--- Checking user Charlie (nxtcharlie20@gmail.com) ---');
        const userRes = await pool.query(`
            SELECT id, name, email, username, role, is_active, upi_id, phone, user_code, password_hash IS NOT NULL as has_password, default_currency, avatar_initials
            FROM users 
            WHERE LOWER(email) = 'nxtcharlie20@gmail.com'
        `);
        console.log('Charlie user:', userRes.rows);

        console.log('\n--- Checking sequences ---');
        const seqRes = await pool.query(`
            SELECT sequence_name 
            FROM information_schema.sequences 
            WHERE sequence_schema = 'public'
            ORDER BY sequence_name;
        `);
        console.log('Sequences in public schema:', seqRes.rows.map(x => x.sequence_name));

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

main();
