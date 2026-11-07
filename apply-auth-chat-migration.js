const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function applyMigration() {
  const client = await pool.connect();
  try {
    console.log('Applying Supabase Auth & Chat migration...');
    await client.query('BEGIN');

    // 1. Extensions
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);

    // 2. Add auth_id to public.users
    await client.query(`
      ALTER TABLE public.users 
      ADD COLUMN IF NOT EXISTS auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
      
      CREATE INDEX IF NOT EXISTS idx_users_auth_id ON public.users(auth_id);
    `);

    // 3. Create public.profiles table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.profiles (
        id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
        name VARCHAR(150) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        avatar_initials VARCHAR(10) DEFAULT 'US',
        upi_id VARCHAR(100),
        phone VARCHAR(30) DEFAULT '+91 98765 00000',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(LOWER(email));
      ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS "Public profiles readable" ON public.profiles;
      CREATE POLICY "Public profiles readable" ON public.profiles
        FOR SELECT USING (true);

      DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
      CREATE POLICY "Users can update own profile" ON public.profiles
        FOR UPDATE USING (auth.uid() = id OR auth.role() = 'service_role');

      DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
      CREATE POLICY "Users can insert own profile" ON public.profiles
        FOR INSERT WITH CHECK (auth.uid() = id OR auth.role() = 'service_role');
    `);

    // 4. Trigger on auth.users for profile creation & sync
    await client.query(`
      CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
      RETURNS trigger AS $$
      DECLARE
        user_name VARCHAR(150);
        user_initials VARCHAR(10);
        user_upi VARCHAR(100);
        user_phone VARCHAR(30);
      BEGIN
        user_name := COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
        user_initials := COALESCE(NEW.raw_user_meta_data->>'avatar_initials', UPPER(SUBSTRING(user_name, 1, 2)), 'US');
        user_upi := COALESCE(NEW.raw_user_meta_data->>'upi_id', LOWER(REGEXP_REPLACE(user_name, '[^a-zA-Z0-9]', '', 'g')) || '@okaxis');
        user_phone := COALESCE(NEW.raw_user_meta_data->>'phone', '+91 98765 00000');

        -- 1. Insert into public.profiles (id matches auth.users.id UUID)
        INSERT INTO public.profiles (id, name, email, avatar_initials, upi_id, phone, created_at, updated_at)
        VALUES (NEW.id, user_name, NEW.email, user_initials, user_upi, user_phone, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          avatar_initials = EXCLUDED.avatar_initials,
          upi_id = EXCLUDED.upi_id,
          phone = EXCLUDED.phone,
          updated_at = NOW();

        -- 2. Insert or link to public.users
        INSERT INTO public.users (auth_id, name, email, password_hash, avatar_initials, upi_id, phone, is_verified, created_at, updated_at)
        VALUES (NEW.id, user_name, NEW.email, COALESCE(NEW.encrypted_password, ''), user_initials, user_upi, user_phone, TRUE, NOW(), NOW())
        ON CONFLICT (email) DO UPDATE SET
          auth_id = EXCLUDED.auth_id,
          name = EXCLUDED.name,
          avatar_initials = EXCLUDED.avatar_initials,
          upi_id = EXCLUDED.upi_id,
          phone = EXCLUDED.phone,
          is_verified = TRUE,
          updated_at = NOW();

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;

      DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
      CREATE TRIGGER on_auth_user_created
        AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
    `);

    // 5. Create Chat tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.chat_conversations (
        id SERIAL PRIMARY KEY,
        group_id INT REFERENCES public.groups(id) ON DELETE CASCADE,
        title VARCHAR(200) NOT NULL,
        type VARCHAR(20) DEFAULT 'group' CHECK (type IN ('direct', 'group', 'assistant')),
        created_by INT REFERENCES public.users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.chat_conversation_members (
        id SERIAL PRIMARY KEY,
        conversation_id INT NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_read_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT uq_chat_conv_user UNIQUE(conversation_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS public.chat_messages (
        id SERIAL PRIMARY KEY,
        conversation_id INT NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
        sender_id INT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_chat_conv_members ON public.chat_conversation_members(conversation_id, user_id);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON public.chat_messages(conversation_id, created_at);

      ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.chat_conversation_members ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

      -- Conversations policy: Members can view their conversations
      DROP POLICY IF EXISTS "Members can view conversations" ON public.chat_conversations;
      CREATE POLICY "Members can view conversations" ON public.chat_conversations
        FOR SELECT USING (
          auth.role() = 'service_role' OR
          EXISTS (
            SELECT 1 FROM public.chat_conversation_members cm
            WHERE cm.conversation_id = chat_conversations.id 
            AND cm.user_id::text = auth.uid()::text
          )
        );

      -- Messages policy: Members can view conversation messages
      DROP POLICY IF EXISTS "Members can view messages" ON public.chat_messages;
      CREATE POLICY "Members can view messages" ON public.chat_messages
        FOR SELECT USING (
          auth.role() = 'service_role' OR
          EXISTS (
            SELECT 1 FROM public.chat_conversation_members cm
            WHERE cm.conversation_id = chat_messages.conversation_id 
            AND cm.user_id::text = auth.uid()::text
          )
        );

      -- Messages insert policy: Members can send messages
      DROP POLICY IF EXISTS "Members can insert messages" ON public.chat_messages;
      CREATE POLICY "Members can insert messages" ON public.chat_messages
        FOR INSERT WITH CHECK (
          auth.role() = 'service_role' OR
          (
            sender_id::text = auth.uid()::text AND
            EXISTS (
              SELECT 1 FROM public.chat_conversation_members cm
              WHERE cm.conversation_id = chat_messages.conversation_id 
              AND cm.user_id::text = auth.uid()::text
            )
          )
        );
    `);

    // 6. Backfill existing users into auth.users and public.profiles
    const existingUsers = await client.query('SELECT id, name, email, password_hash, avatar_initials, upi_id, phone, auth_id FROM public.users');
    console.log(`Backfilling ${existingUsers.rows.length} existing users into auth.users & public.profiles...`);

    for (const u of existingUsers.rows) {
      let authUserId = u.auth_id;
      if (!authUserId) {
        // Check if already in auth.users
        const checkAuth = await client.query('SELECT id FROM auth.users WHERE email = $1', [u.email]);
        if (checkAuth.rows.length > 0) {
          authUserId = checkAuth.rows[0].id;
        } else {
          authUserId = crypto.randomUUID();
          await client.query(`
            INSERT INTO auth.users (
              id, instance_id, email, encrypted_password, email_confirmed_at,
              created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
              is_super_admin, role, aud
            ) VALUES (
              $1::uuid, '00000000-0000-0000-0000-000000000000', $2, $3, NOW(),
              NOW(), NOW(), '{"provider":"email","providers":["email"]}'::jsonb,
              $4, FALSE, 'authenticated', 'authenticated'
            )
          `, [
            authUserId,
            u.email,
            u.password_hash,
            JSON.stringify({ name: u.name, avatar_initials: u.avatar_initials, upi_id: u.upi_id, phone: u.phone })
          ]);

          // Also insert into auth.identities
          await client.query(`
            INSERT INTO auth.identities (
              id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
            ) VALUES (
              gen_random_uuid(), $1::uuid, $1::text,
              json_build_object('sub', $1::text, 'email', $2::text),
              'email', NOW(), NOW(), NOW()
            ) ON CONFLICT DO NOTHING
          `, [authUserId, u.email]);
        }

        // Link in public.users
        await client.query('UPDATE public.users SET auth_id = $1::uuid WHERE id = $2', [authUserId, u.id]);
      }

      // Ensure profile exists in public.profiles
      await client.query(`
        INSERT INTO public.profiles (id, name, email, avatar_initials, upi_id, phone, created_at, updated_at)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          avatar_initials = EXCLUDED.avatar_initials,
          upi_id = EXCLUDED.upi_id,
          phone = EXCLUDED.phone,
          updated_at = NOW()
      `, [authUserId, u.name, u.email, u.avatar_initials, u.upi_id, u.phone]);
    }

    // 7. Seed initial default group chat for existing groups
    const groups = await client.query('SELECT id, name, created_by FROM public.groups');
    for (const g of groups.rows) {
      const convCheck = await client.query('SELECT id FROM public.chat_conversations WHERE group_id = $1', [g.id]);
      let convId;
      if (convCheck.rows.length === 0) {
        const newConv = await client.query(`
          INSERT INTO public.chat_conversations (group_id, title, type, created_by)
          VALUES ($1, $2, 'group', $3) RETURNING id
        `, [g.id, `${g.name} Group Chat`, g.created_by]);
        convId = newConv.rows[0].id;

        // Add all group members to conversation
        const members = await client.query('SELECT user_id FROM public.group_members WHERE group_id = $1', [g.id]);
        for (const m of members.rows) {
          await client.query(`
            INSERT INTO public.chat_conversation_members (conversation_id, user_id)
            VALUES ($1, $2) ON CONFLICT DO NOTHING
          `, [convId, m.user_id]);
        }

        // Add welcome message
        if (members.rows.length > 0) {
          await client.query(`
            INSERT INTO public.chat_messages (conversation_id, sender_id, message)
            VALUES ($1, $2, $3)
          `, [convId, members.rows[0].user_id, `Welcome to the ${g.name} group chat! Coordinate expenses and settlements here.`]);
        }
      }
    }

    await client.query('COMMIT');
    console.log('🎉 Migration applied successfully!');

    // Verify auth.users count and public.profiles count
    const authCount = await client.query('SELECT COUNT(*) FROM auth.users');
    const profCount = await client.query('SELECT COUNT(*) FROM public.profiles');
    const userCount = await client.query('SELECT COUNT(*) FROM public.users');
    console.log(`Summary: auth.users=${authCount.rows[0].count}, public.profiles=${profCount.rows[0].count}, public.users=${userCount.rows[0].count}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

applyMigration();
