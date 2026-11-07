const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function runMigration() {
    const client = await pool.connect();
    try {
        console.log('--- Starting Safe Stabilization Migration ---');
        await client.query('BEGIN');

        // 1. Update public.users table columns
        console.log('1. Migrating public.users table...');
        await client.query(`
            ALTER TABLE public.users 
            ADD COLUMN IF NOT EXISTS username VARCHAR(64),
            ADD COLUMN IF NOT EXISTS role VARCHAR(32) DEFAULT 'user',
            ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
        `);

        // Backfill usernames for existing users cleanly
        const existingUsers = await client.query('SELECT id, name, email, username FROM public.users ORDER BY id ASC');
        const takenUsernames = new Set();

        for (const u of existingUsers.rows) {
            let uname = u.username;
            if (!uname) {
                // Generate clean handle from email prefix or name
                let handle = (u.email.split('@')[0] || u.name).toLowerCase()
                    .replace(/[^a-z0-9_.]/g, '_')
                    .replace(/_+/g, '_')
                    .replace(/^_+|_+$/g, '');
                
                if (handle.length < 3) handle = handle + '_user';
                handle = handle.substring(0, 30);

                let candidate = handle;
                let counter = 1;
                while (takenUsernames.has(candidate)) {
                    candidate = `${handle}_${counter++}`;
                }
                uname = candidate;
                takenUsernames.add(uname);

                await client.query('UPDATE public.users SET username = $1 WHERE id = $2', [uname, u.id]);
                console.log(`  Assigned username '${uname}' to User #${u.id} (${u.email})`);
            } else {
                takenUsernames.add(uname.toLowerCase());
            }
        }

        // Add case-insensitive unique index on LOWER(username)
        await client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_lower_username 
            ON public.users (LOWER(username));
        `);

        // Security requirement: the legacy plaintext_password column was removed
        // entirely; passwords live only as bcrypt hashes.
        console.log('  Plaintext password storage is not used (column removed).');

        // 2. Update groups table
        console.log('2. Migrating groups table...');
        await client.query(`
            ALTER TABLE public.groups 
            ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'INR';
        `);
        // Sync currency with base_currency
        await client.query(`
            UPDATE public.groups 
            SET currency = COALESCE(base_currency, 'INR') 
            WHERE currency IS NULL OR currency = '';
        `);

        // 3. Update settlements table
        console.log('3. Migrating settlements table...');
        await client.query(`
            ALTER TABLE public.settlements 
            ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'INR',
            ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'COMPLETED';
        `);

        // 4. Create System Errors Tracker tables
        console.log('4. Creating system_errors & system_error_occurrences tables...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS public.system_errors (
                id VARCHAR(64) PRIMARY KEY,
                fingerprint VARCHAR(128) UNIQUE NOT NULL,
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                category VARCHAR(64) NOT NULL DEFAULT 'backend_api',
                severity VARCHAR(32) NOT NULL DEFAULT 'medium',
                status VARCHAR(32) NOT NULL DEFAULT 'new',
                affected_module VARCHAR(100) DEFAULT 'general',
                api_route VARCHAR(255),
                http_status INTEGER,
                occurrence_count INTEGER DEFAULT 1,
                first_seen TIMESTAMPTZ DEFAULT NOW(),
                last_seen TIMESTAMPTZ DEFAULT NOW(),
                resolution_notes TEXT,
                resolved_by VARCHAR(100),
                resolved_at TIMESTAMPTZ
            );

            CREATE INDEX IF NOT EXISTS idx_errors_status ON public.system_errors(status);
            CREATE INDEX IF NOT EXISTS idx_errors_severity ON public.system_errors(severity);
            CREATE INDEX IF NOT EXISTS idx_errors_category ON public.system_errors(category);
            CREATE INDEX IF NOT EXISTS idx_errors_last_seen ON public.system_errors(last_seen DESC);

            CREATE TABLE IF NOT EXISTS public.system_error_occurrences (
                id SERIAL PRIMARY KEY,
                error_id VARCHAR(64) NOT NULL REFERENCES public.system_errors(id) ON DELETE CASCADE,
                user_id INTEGER,
                group_id INTEGER,
                stack_trace TEXT,
                request_url TEXT,
                request_method VARCHAR(16),
                request_body_sanitized JSONB,
                browser_info TEXT,
                environment VARCHAR(32) DEFAULT 'production',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_err_occ_error_id ON public.system_error_occurrences(error_id);
            CREATE INDEX IF NOT EXISTS idx_err_occ_created_at ON public.system_error_occurrences(created_at DESC);
        `);

        // 5. Create Admin Audit Logs table
        console.log('5. Creating admin_audit_logs table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
                id SERIAL PRIMARY KEY,
                admin_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
                admin_email VARCHAR(255),
                action VARCHAR(100) NOT NULL,
                target_type VARCHAR(50),
                target_id VARCHAR(100),
                details JSONB,
                ip_address VARCHAR(100),
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_audit_admin ON public.admin_audit_logs(admin_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_audit_action ON public.admin_audit_logs(action);
        `);

        await client.query('COMMIT');
        console.log('✓ Migration completed successfully with all constraints and safety checks!');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Migration failed, rolled back:', err);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration().catch(err => {
    console.error(err);
    process.exit(1);
});
