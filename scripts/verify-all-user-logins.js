const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function verifyLogins() {
    try {
        const users = await pool.query('SELECT id, name, email, password_hash, user_code FROM users ORDER BY id ASC');
        console.log(`Checking ${users.rows.length} users:`);
        for (const u of users.rows) {
            let status = 'UNKNOWN';
            // Verify the stored value is a real, usable hash (never plaintext).
            const isBcrypt = /^\$2[aby]\$/.test(u.password_hash || '');
            if (!isBcrypt) {
                status = 'INVALID HASH';
            } else {
                // Test common development passwords to confirm the hash is usable.
                const common = ['password123', 'Password123!', 'Alex@123', 'SplitWise@2025', 'Test@1234'];
                let found = null;
                for (const p of common) {
                    if (await bcrypt.compare(p, u.password_hash)) {
                        found = p;
                        break;
                    }
                }
                status = found ? `Matches known test password: "${found}"` : 'Valid bcrypt hash present';
            }
            console.log(`User ${u.id} | ${u.email} | ${status}`);
        }
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

verifyLogins();
