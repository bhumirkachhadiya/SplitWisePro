const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/splitwise'
});

async function check() {
    try {
        const users = await pool.query('SELECT id, name, email FROM users');
        console.log('Users in DB:', users.rows);
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await pool.end();
    }
}

check();
