const { pool } = require('../db');

async function makeAllUsersFriends() {
    console.log('--- CONNECTING ALL USERS AS MUTUAL FRIENDS ---');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Fetch all active users
        const usersRes = await client.query(`SELECT id, name, username, email FROM public.users WHERE is_active = true ORDER BY id ASC`);
        const users = usersRes.rows;
        console.log(`Found ${users.length} active users:`, users.map(u => `${u.name} (ID: ${u.id})`).join(', '));

        let friendshipCount = 0;
        for (let i = 0; i < users.length; i++) {
            for (let j = 0; j < users.length; j++) {
                if (i === j) continue;
                const u1 = users[i];
                const u2 = users[j];

                const ins = await client.query(`
                    INSERT INTO public.friends (user_id, friend_id, created_at)
                    VALUES ($1, $2, NOW())
                    ON CONFLICT (user_id, friend_id) DO NOTHING
                    RETURNING id
                `, [u1.id, u2.id]);

                if (ins.rows.length > 0) friendshipCount++;
            }
        }
        console.log(`✓ Inserted ${friendshipCount} new mutual friendship links.`);

        // Ensure any friend requests between them are marked ACCEPTED
        await client.query(`
            UPDATE public.friend_requests
            SET status = 'ACCEPTED', updated_at = NOW()
            WHERE status = 'PENDING'
        `);
        console.log('✓ Pending friend requests marked ACCEPTED.');

        // Enroll all users into all active groups as editors/admins so anyone can add expenses & split
        const groupsRes = await client.query(`SELECT id, name, created_by FROM public.groups ORDER BY id ASC`);
        for (const g of groupsRes.rows) {
            for (const u of users) {
                const role = (Number(u.id) === Number(g.created_by) || Number(u.id) === 1) ? 'admin' : 'editor';
                await client.query(`
                    INSERT INTO public.group_members (group_id, user_id, role)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (group_id, user_id) DO UPDATE SET role = EXCLUDED.role
                `, [g.id, u.id, role]);
            }
            console.log(`✓ Synchronized all members with role 'editor'/'admin' in group "${g.name}" (#${g.id}).`);
        }

        await client.query('COMMIT');
        console.log('\n=============================================================');
        console.log('✓ ALL USERS ARE NOW MUTUAL FRIENDS & GROUP EDITORS!');
        console.log('=============================================================');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Failed to connect users as friends:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

makeAllUsersFriends();
