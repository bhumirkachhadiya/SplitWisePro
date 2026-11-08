const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function seed() {
    console.log('Seeding curated cover photos and icons for existing groups...');
    
    // Goa Vacation Trip (id: 13)
    await pool.query(`
        UPDATE groups 
        SET cover_photo_url = 'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=1200&q=80',
            icon_url = 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=300&q=80'
        WHERE id = 13
    `);

    // Manali Trip (id: 19)
    await pool.query(`
        UPDATE groups 
        SET cover_photo_url = 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=1200&q=80',
            icon_url = 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=300&q=80'
        WHERE id = 19
    `);

    // Goa 2026 (id: 25)
    await pool.query(`
        UPDATE groups 
        SET cover_photo_url = 'https://images.unsplash.com/photo-1544735716-392fe2489ffa?auto=format&fit=crop&w=1200&q=80',
            icon_url = 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=300&q=80'
        WHERE id = 25
    `);

    // Also populate default cover/icon for any other group missing them
    await pool.query(`
        UPDATE groups
        SET cover_photo_url = 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1200&q=80'
        WHERE cover_photo_url IS NULL;
    `);

    await pool.query(`
        UPDATE groups
        SET icon_url = 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=300&q=80'
        WHERE icon_url IS NULL;
    `);

    const res = await pool.query('SELECT id, name, category, cover_photo_url, icon_url FROM groups ORDER BY id ASC');
    console.log('Updated groups in database:');
    res.rows.forEach(g => {
        console.log(`- [${g.id}] ${g.name}: icon=${g.icon_url ? 'YES' : 'NO'}, cover=${g.cover_photo_url ? 'YES' : 'NO'}`);
    });

    await pool.end();
}

seed().catch(err => {
    console.error('Error seeding group media:', err);
    process.exit(1);
});
