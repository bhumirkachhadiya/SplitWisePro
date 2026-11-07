/**
 * ==============================================================================
 * MASTER ADMIN SECURE PROVISIONING SCRIPT
 * ==============================================================================
 * Trusted server-side CLI tool to provision or promote a Master Admin.
 * Usage:
 *   node scripts/provision-master-admin.js [email_or_username] [optional_password]
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

async function provisionAdmin() {
    const targetIdentifier = process.argv[2] || 'alex@splitease.io';
    const newPassword = process.argv[3];

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log(`\n======================================================`);
        console.log(` PROVISIONING MASTER ADMIN: "${targetIdentifier}"`);
        console.log(`======================================================`);

        // Check if user exists
        const userRes = await client.query(`
            SELECT id, name, email, username, role, password_hash 
            FROM public.users 
            WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)
        `, [targetIdentifier]);

        let adminUser = null;

        if (userRes.rows.length > 0) {
            adminUser = userRes.rows[0];
            console.log(`✓ Found existing user: ${adminUser.name} (ID: ${adminUser.id}, Email: ${adminUser.email})`);

            let updateSql = `UPDATE public.users SET role = 'master_admin', is_active = TRUE, updated_at = NOW()`;
            const params = [];
            let pIdx = 1;

            if (newPassword) {
                if (newPassword.length < 10) {
                    throw new Error('Master Admin password must be at least 10 characters long.');
                }
                const passHash = await bcrypt.hash(newPassword, 10);
                updateSql += `, password_hash = $${pIdx++}`;
                params.push(passHash);
            }

            updateSql += ` WHERE id = $${pIdx} RETURNING id, name, email, username, role`;
            params.push(adminUser.id);

            const updatedRes = await client.query(updateSql, params);
            adminUser = updatedRes.rows[0];
            console.log(`✓ Role elevated to: ${adminUser.role}`);
        } else {
            // Provision new Master Admin
            if (!newPassword || newPassword.length < 10) {
                throw new Error('When creating a new Master Admin, provide a secure password of at least 10 characters.');
            }

            const email = targetIdentifier.includes('@') ? targetIdentifier.toLowerCase() : `${targetIdentifier}@splitease.internal`;
            const username = targetIdentifier.includes('@') ? targetIdentifier.split('@')[0] : targetIdentifier;
            const passHash = await bcrypt.hash(newPassword, 10);
            const userCode = `MA-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
            const initials = 'MA';

            const insertRes = await client.query(`
                INSERT INTO public.users 
                (name, email, username, password_hash, role, is_active, is_verified, user_code, avatar_initials, upi_id, phone)
                VALUES ($1, $2, $3, $4, 'master_admin', TRUE, TRUE, $5, $6, $7, $8)
                RETURNING id, name, email, username, role
            `, [
                'Master Administrator',
                email,
                username,
                passHash,
                userCode,
                initials,
                `${username}@splitease`,
                '+91 99999 00000'
            ]);

            adminUser = insertRes.rows[0];
            console.log(`✓ Created new Master Admin User (ID: ${adminUser.id}, Username: ${adminUser.username})`);
        }

        // Record in Admin Audit Log
        await client.query(`
            INSERT INTO public.admin_audit_logs 
            (admin_id, admin_email, action, target_type, target_id, details)
            VALUES ($1, $2, 'MASTER_ADMIN_PROVISIONED', 'USER', $3, $4)
        `, [
            adminUser.id,
            adminUser.email,
            adminUser.id.toString(),
            JSON.stringify({
                action: 'PROVISION_ROLE',
                role: 'master_admin',
                timestamp: new Date().toISOString()
            })
        ]);

        await client.query('COMMIT');
        console.log(`\n======================================================`);
        console.log(`✓ MASTER ADMIN PROVISIONED SUCCESSFULLY:`);
        console.log(`  User ID:    ${adminUser.id}`);
        console.log(`  Name:       ${adminUser.name}`);
        console.log(`  Email:      ${adminUser.email}`);
        console.log(`  Username:   ${adminUser.username}`);
        console.log(`  Role:       ${adminUser.role}`);
        console.log(`======================================================\n`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Master Admin provisioning failed:', err.message);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

provisionAdmin().catch(() => process.exit(1));
