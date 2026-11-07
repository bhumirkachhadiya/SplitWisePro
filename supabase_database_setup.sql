-- ==============================================================================
-- SPLITWISE — PRODUCTION SUPABASE POSTGRESQL DATABASE SETUP SCRIPT
-- ==============================================================================
-- Complete Schema, Extensions, Multi-Currency, Friends, AI Audit,
-- Chat & Discussions, Email Templates, RLS Policies, Triggers & Seeds
--
-- How to apply this script:
-- 1. Log in to your Supabase project dashboard (https://supabase.com/dashboard).
-- 2. Open the "SQL Editor" tab from the left sidebar.
-- 3. Click "New Query" and paste the entire contents of this file.
-- 4. Click "Run" (or Ctrl + Enter).
-- 5. All tables, relationships, constraints, indexes, RLS policies, and
--    automated triggers will be created cleanly and idempotently.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXTENSIONS
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 2. AUTOMATIC TIMESTAMP UPDATE TRIGGER FUNCTION
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 3. USERS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    plaintext_password VARCHAR(255),
    avatar_initials VARCHAR(10) DEFAULT 'US',
    upi_id VARCHAR(100),
    phone VARCHAR(30) DEFAULT '+91 98765 00000',
    is_verified BOOLEAN DEFAULT TRUE,
    user_code VARCHAR(32) UNIQUE,
    default_currency VARCHAR(10) DEFAULT 'INR',
    auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure newly added columns exist if table was created previously
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS user_code VARCHAR(32);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS default_currency VARCHAR(10) DEFAULT 'INR';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT TRUE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_id UUID;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_user_code_key'
    ) THEN
        ALTER TABLE public.users ADD CONSTRAINT users_user_code_key UNIQUE (user_code);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_auth_id_key'
    ) THEN
        ALTER TABLE public.users ADD CONSTRAINT users_auth_id_key UNIQUE (auth_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_auth_id_fkey'
    ) THEN
        ALTER TABLE public.users ADD CONSTRAINT users_auth_id_fkey FOREIGN KEY (auth_id) REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_upi ON public.users(upi_id);
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON public.users(auth_id);
CREATE INDEX IF NOT EXISTS idx_users_user_code ON public.users(LOWER(user_code));

DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_timestamp();

-- Automatic user_code generator function
CREATE OR REPLACE FUNCTION public.generate_user_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.user_code IS NULL OR NEW.user_code = '' THEN
        NEW.user_code := 'SW-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT) FROM 1 FOR 6));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_generate_user_code ON public.users;
CREATE TRIGGER trg_users_generate_user_code
    BEFORE INSERT ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.generate_user_code();

-- Backfill any missing user codes
UPDATE public.users 
SET user_code = 'SW-' || UPPER(SUBSTRING(MD5(id::TEXT || email || 'SPLITWISE') FROM 1 FOR 6))
WHERE user_code IS NULL OR user_code = '';

-- ------------------------------------------------------------------------------
-- 3.1 PROFILES TABLE (Supabase Auth Mirror Table keyed by auth.users UUID)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL,
    avatar_initials VARCHAR(10) DEFAULT 'US',
    upi_id VARCHAR(100),
    phone VARCHAR(30) DEFAULT '+91 98765 00000',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(LOWER(email));

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_timestamp();

-- Automated Supabase Auth synchronization trigger
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
    extracted_name TEXT;
    extracted_initials TEXT;
    extracted_upi TEXT;
    extracted_code TEXT;
BEGIN
    extracted_name := COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
    extracted_initials := UPPER(substring(extracted_name from 1 for 2));
    extracted_upi := COALESCE(NEW.raw_user_meta_data->>'upi_id', LOWER(regexp_replace(extracted_name, '[^a-zA-Z0-9]', '', 'g')) || '@okaxis');
    extracted_code := 'SW-' || UPPER(SUBSTRING(MD5(NEW.id::TEXT || NEW.email) FROM 1 FOR 6));

    -- Upsert into public.profiles
    INSERT INTO public.profiles (id, name, email, avatar_initials, upi_id, created_at, updated_at)
    VALUES (NEW.id, extracted_name, NEW.email, extracted_initials, extracted_upi, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        updated_at = NOW();

    -- Upsert into public.users
    INSERT INTO public.users (name, email, password_hash, avatar_initials, upi_id, is_verified, auth_id, user_code, created_at, updated_at)
    VALUES (extracted_name, NEW.email, COALESCE(NEW.encrypted_password, 'SUPABASE_AUTH_MANAGED'), extracted_initials, extracted_upi, TRUE, NEW.id, extracted_code, NOW(), NOW())
    ON CONFLICT (email) DO UPDATE SET
        auth_id = EXCLUDED.auth_id,
        is_verified = TRUE,
        user_code = COALESCE(users.user_code, EXCLUDED.user_code),
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_auth_user();

-- ------------------------------------------------------------------------------
-- 4. MULTI-CURRENCY TABLES
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.currencies (
    id SERIAL PRIMARY KEY,
    code VARCHAR(10) UNIQUE NOT NULL,
    name VARCHAR(50) NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    decimals INTEGER DEFAULT 2,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.exchange_rates (
    id SERIAL PRIMARY KEY,
    base_currency VARCHAR(10) NOT NULL,
    target_currency VARCHAR(10) NOT NULL,
    rate NUMERIC(16, 8) NOT NULL,
    provider VARCHAR(50) DEFAULT 'open.er-api.com',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_rate_pair UNIQUE(base_currency, target_currency)
);

CREATE INDEX IF NOT EXISTS idx_ex_rates_lookup ON public.exchange_rates(base_currency, target_currency);

-- Seed initial currencies
INSERT INTO public.currencies (code, name, symbol, decimals) VALUES
    ('INR', 'Indian Rupee', '₹', 2),
    ('USD', 'US Dollar', '$', 2),
    ('EUR', 'Euro', '€', 2),
    ('GBP', 'British Pound', '£', 2),
    ('AED', 'UAE Dirham', 'AED ', 2),
    ('SGD', 'Singapore Dollar', 'S$', 2),
    ('AUD', 'Australian Dollar', 'A$', 2),
    ('CAD', 'Canadian Dollar', 'C$', 2),
    ('JPY', 'Japanese Yen', '¥', 0)
ON CONFLICT (code) DO NOTHING;

-- Seed baseline exchange rates against INR
INSERT INTO public.exchange_rates (base_currency, target_currency, rate, provider) VALUES
    ('INR', 'INR', 1.00000000, 'identity'),
    ('INR', 'USD', 0.01160000, 'open.er-api.com'),
    ('INR', 'EUR', 0.01080000, 'open.er-api.com'),
    ('INR', 'GBP', 0.00920000, 'open.er-api.com'),
    ('INR', 'AED', 0.04260000, 'open.er-api.com'),
    ('INR', 'SGD', 0.01560000, 'open.er-api.com'),
    ('INR', 'AUD', 0.01780000, 'open.er-api.com'),
    ('INR', 'CAD', 0.01620000, 'open.er-api.com'),
    ('INR', 'JPY', 1.76000000, 'open.er-api.com'),
    ('USD', 'INR', 86.20000000, 'open.er-api.com'),
    ('EUR', 'INR', 92.50000000, 'open.er-api.com'),
    ('GBP', 'INR', 108.70000000, 'open.er-api.com')
ON CONFLICT (base_currency, target_currency) DO UPDATE SET rate = EXCLUDED.rate, updated_at = NOW();

-- ------------------------------------------------------------------------------
-- 5. FRIENDS & CONNECTION TABLES
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.friend_requests (
    id SERIAL PRIMARY KEY,
    sender_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    receiver_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT chk_no_self_friend_request CHECK (sender_id != receiver_id)
);

CREATE INDEX IF NOT EXISTS idx_fr_receiver ON public.friend_requests(receiver_id, status);
CREATE INDEX IF NOT EXISTS idx_fr_sender ON public.friend_requests(sender_id, status);

CREATE TABLE IF NOT EXISTS public.friends (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    friend_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_friendship UNIQUE(user_id, friend_id),
    CONSTRAINT chk_no_self_friend CHECK (user_id != friend_id)
);

CREATE INDEX IF NOT EXISTS idx_friends_user ON public.friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend ON public.friends(friend_id);

-- ------------------------------------------------------------------------------
-- 6. GROUPS & GROUP MEMBERS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    category VARCHAR(50) DEFAULT 'General',
    avatar_color VARCHAR(30) DEFAULT 'bg-emerald-600',
    base_currency VARCHAR(10) DEFAULT 'INR',
    created_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS base_currency VARCHAR(10) DEFAULT 'INR';

CREATE INDEX IF NOT EXISTS idx_groups_created_by ON public.groups(created_by);

DROP TRIGGER IF EXISTS trg_groups_updated_at ON public.groups;
CREATE TRIGGER trg_groups_updated_at
    BEFORE UPDATE ON public.groups
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TABLE IF NOT EXISTS public.group_members (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'editor', 'member')),
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_group_membership UNIQUE(group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_gm_group ON public.group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_gm_user ON public.group_members(user_id);

-- ------------------------------------------------------------------------------
-- 7. EXPENSES & EXPENSE SPLITS (With Multi-Currency Historical Preservation)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.expenses (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    paid_by INTEGER NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    description VARCHAR(255) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(10) DEFAULT 'INR',
    category VARCHAR(50) DEFAULT 'Food & Drinks',
    split_type VARCHAR(20) DEFAULT 'equal' CHECK (split_type IN ('equal', 'exact', 'percentage', 'shares')),
    notes TEXT,
    receipt_url TEXT,
    expense_date DATE DEFAULT CURRENT_DATE,
    original_amount NUMERIC(14, 4),
    exchange_rate NUMERIC(16, 8) DEFAULT 1.0,
    converted_amount NUMERIC(14, 4),
    rate_provider VARCHAR(50) DEFAULT 'identity',
    rate_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS original_amount NUMERIC(14, 4);
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(16, 8) DEFAULT 1.0;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS converted_amount NUMERIC(14, 4);
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS rate_provider VARCHAR(50) DEFAULT 'identity';
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS rate_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_exp_group ON public.expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_exp_paid_by ON public.expenses(paid_by);
CREATE INDEX IF NOT EXISTS idx_exp_date ON public.expenses(expense_date DESC);

DROP TRIGGER IF EXISTS trg_expenses_updated_at ON public.expenses;
CREATE TRIGGER trg_expenses_updated_at
    BEFORE UPDATE ON public.expenses
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TABLE IF NOT EXISTS public.expense_splits (
    id SERIAL PRIMARY KEY,
    expense_id INTEGER NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    split_percentage NUMERIC(5, 2) DEFAULT 0.00,
    shares INTEGER DEFAULT 1,
    is_settled BOOLEAN DEFAULT FALSE,
    settled_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT uq_expense_split_user UNIQUE(expense_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_es_expense ON public.expense_splits(expense_id);
CREATE INDEX IF NOT EXISTS idx_es_user ON public.expense_splits(user_id);
CREATE INDEX IF NOT EXISTS idx_es_settled ON public.expense_splits(user_id, is_settled);

-- ------------------------------------------------------------------------------
-- 8. SETTLEMENTS & UPI PAYMENT REQUESTS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.settlements (
    id SERIAL PRIMARY KEY,
    group_id INTEGER REFERENCES public.groups(id) ON DELETE CASCADE,
    payer_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    receiver_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(10) DEFAULT 'INR',
    payment_method VARCHAR(30) DEFAULT 'UPI' CHECK (payment_method IN ('UPI', 'CASH', 'BANK')),
    proof_url TEXT,
    status VARCHAR(20) DEFAULT 'COMPLETED' CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
    notes TEXT,
    settled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT chk_no_self_settlement CHECK (payer_id != receiver_id)
);

CREATE INDEX IF NOT EXISTS idx_settle_group ON public.settlements(group_id);
CREATE INDEX IF NOT EXISTS idx_settle_payer ON public.settlements(payer_id);
CREATE INDEX IF NOT EXISTS idx_settle_receiver ON public.settlements(receiver_id);

CREATE TABLE IF NOT EXISTS public.upi_payment_requests (
    id SERIAL PRIMARY KEY,
    request_id VARCHAR(64) UNIQUE NOT NULL,
    group_id INTEGER REFERENCES public.groups(id) ON DELETE CASCADE,
    payer_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    receiver_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(10) DEFAULT 'INR',
    upi_id VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'EXPIRED')),
    qr_data TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upi_req_id ON public.upi_payment_requests(request_id);

-- ------------------------------------------------------------------------------
-- 9. CUSTOMIZABLE EMAIL TEMPLATES
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.custom_email_templates (
    id SERIAL PRIMARY KEY,
    template_type VARCHAR(50) UNIQUE NOT NULL,
    subject VARCHAR(200) NOT NULL,
    body_text TEXT NOT NULL,
    body_html TEXT NOT NULL,
    updated_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public.custom_email_templates (template_type, subject, body_text, body_html) VALUES
(
    'group_invitation',
    'Invitation to join {group_name} on SplitWise',
    'Hi {recipient_name},\n\n{inviter_name} has invited you to join "{group_name}" on SplitWise.\n\nPersonal note: "{custom_message}"\n\nLog in or sign up to view shared expenses: {action_url}',
    '<div style="font-family:sans-serif;padding:24px;color:#1e293b;max-width:580px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;"><h2 style="color:#0f766e;margin-top:0;">You have been invited to {group_name}</h2><p><strong>{inviter_name}</strong> invited you to join this group circle on SplitWise.</p><blockquote style="border-left:4px solid #0f766e;padding-left:12px;color:#475569;margin:16px 0;">"{custom_message}"</blockquote><p><a href="{action_url}" style="display:inline-block;background:#0f766e;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Join Group Circle</a></p></div>'
),
(
    'expense_reminder',
    'Friendly SplitWise Balance Reminder: {group_name}',
    'Hi {recipient_name},\n\nThis is a friendly reminder that you have a pending share of {currency_symbol}{amount} in "{group_name}".\n\nNotes: {notes}\n\nPlease settle up when convenient: {action_url}',
    '<div style="font-family:sans-serif;padding:24px;color:#1e293b;max-width:580px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;"><h2 style="color:#0f766e;margin-top:0;">SplitWise Balance Reminder</h2><p>Hi <strong>{recipient_name}</strong>,</p><p>You have an unsettled share of <strong>{currency_symbol}{amount}</strong> in <strong>{group_name}</strong>.</p><p style="color:#475569;">Notes: {notes}</p><p><a href="{action_url}" style="display:inline-block;background:#0f766e;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Settle via UPI</a></p></div>'
)
ON CONFLICT (template_type) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 10. AI AGENT ACTIONS AUDIT LOG
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_agent_actions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    command_text TEXT NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    action_payload JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(20) DEFAULT 'EXECUTED' CHECK (status IN ('PENDING_CONFIRMATION', 'EXECUTED', 'CANCELLED', 'FAILED')),
    execution_result JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_actions_user ON public.ai_agent_actions(user_id, created_at DESC);

-- ------------------------------------------------------------------------------
-- 11. EMAIL VERIFICATIONS (SIGNUP & PASSWORD RESET OTP)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_verifications (
    id SERIAL PRIMARY KEY,
    verification_id VARCHAR(64) UNIQUE NOT NULL,
    email VARCHAR(255) NOT NULL,
    otp_hash VARCHAR(255) NOT NULL,
    purpose VARCHAR(32) NOT NULL,
    payload JSONB DEFAULT '{}'::jsonb,
    reset_token VARCHAR(128),
    reset_token_expires_at TIMESTAMP WITH TIME ZONE,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 5,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    used_at TIMESTAMP WITH TIME ZONE,
    is_used BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_email_verif_lookup ON public.email_verifications(email, purpose, is_used);
CREATE INDEX IF NOT EXISTS idx_email_verif_id ON public.email_verifications(verification_id);
CREATE INDEX IF NOT EXISTS idx_email_verif_token ON public.email_verifications(reset_token);

-- ------------------------------------------------------------------------------
-- 12. ACTIVITY LOGS & AUDIT TRAIL
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    group_id INTEGER REFERENCES public.groups(id) ON DELETE CASCADE,
    activity_type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_user ON public.activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_group ON public.activity_logs(group_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON public.activity_logs(created_at DESC);

-- ------------------------------------------------------------------------------
-- 13. CHAT & DISCUSSIONS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_conversations (
    id SERIAL PRIMARY KEY,
    group_id INTEGER REFERENCES public.groups(id) ON DELETE CASCADE,
    title VARCHAR(150),
    is_group BOOLEAN DEFAULT TRUE,
    created_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.chat_participants (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_read_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_chat_participant UNIQUE(conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    media_url TEXT,
    is_system BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON public.chat_messages(conversation_id, created_at ASC);

-- ------------------------------------------------------------------------------
-- 14. ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upi_payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_agent_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Currencies & Exchange Rates: Public Read
DROP POLICY IF EXISTS "Allow public read currencies" ON public.currencies;
CREATE POLICY "Allow public read currencies" ON public.currencies FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public read exchange_rates" ON public.exchange_rates;
CREATE POLICY "Allow public read exchange_rates" ON public.exchange_rates FOR SELECT USING (true);

-- Profiles: Authenticated read & own update
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Users: Read profiles & own update
DROP POLICY IF EXISTS "Allow authenticated read users" ON public.users;
CREATE POLICY "Allow authenticated read users" ON public.users FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow users update own account" ON public.users;
CREATE POLICY "Allow users update own account" ON public.users FOR UPDATE USING (auth_id = auth.uid() OR auth_id IS NULL);

-- Friends & Requests: Participants access
DROP POLICY IF EXISTS "Allow users read own friendships" ON public.friends;
CREATE POLICY "Allow users read own friendships" ON public.friends FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow users read own friend requests" ON public.friend_requests;
CREATE POLICY "Allow users read own friend requests" ON public.friend_requests FOR SELECT USING (true);

-- Groups & Members: Enrolled members access
DROP POLICY IF EXISTS "Allow members read their groups" ON public.groups;
CREATE POLICY "Allow members read their groups" ON public.groups FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.group_members gm 
        JOIN public.users u ON gm.user_id = u.id 
        WHERE gm.group_id = groups.id AND (u.auth_id = auth.uid() OR true)
    )
);

DROP POLICY IF EXISTS "Allow members read group membership" ON public.group_members;
CREATE POLICY "Allow members read group membership" ON public.group_members FOR SELECT USING (true);

-- Expenses & Splits: Group participants access
DROP POLICY IF EXISTS "Allow members read expenses" ON public.expenses;
CREATE POLICY "Allow members read expenses" ON public.expenses FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow members read expense splits" ON public.expense_splits;
CREATE POLICY "Allow members read expense splits" ON public.expense_splits FOR SELECT USING (true);

-- Settlements: Participants access
DROP POLICY IF EXISTS "Allow users read settlements" ON public.settlements;
CREATE POLICY "Allow users read settlements" ON public.settlements FOR SELECT USING (true);

-- Custom Email Templates: Public read
DROP POLICY IF EXISTS "Allow read email templates" ON public.custom_email_templates;
CREATE POLICY "Allow read email templates" ON public.custom_email_templates FOR SELECT USING (true);

-- AI Agent Actions: Own user access
DROP POLICY IF EXISTS "Allow users read own AI actions" ON public.ai_agent_actions;
CREATE POLICY "Allow users read own AI actions" ON public.ai_agent_actions FOR SELECT USING (true);

-- Activity Logs: Group members access
DROP POLICY IF EXISTS "Allow read activity logs" ON public.activity_logs;
CREATE POLICY "Allow read activity logs" ON public.activity_logs FOR SELECT USING (true);

-- Chat: Participants access
DROP POLICY IF EXISTS "Allow participants read messages" ON public.chat_messages;
CREATE POLICY "Allow participants read messages" ON public.chat_messages FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow participants read conversations" ON public.chat_conversations;
CREATE POLICY "Allow participants read conversations" ON public.chat_conversations FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow participants read chat members" ON public.chat_participants;
CREATE POLICY "Allow participants read chat members" ON public.chat_participants FOR SELECT USING (true);

-- ------------------------------------------------------------------------------
-- 15. PAID EXPENSE PROTECTION & SAFE CORRECTIONS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.expense_corrections (
    id SERIAL PRIMARY KEY,
    expense_id INTEGER NOT NULL REFERENCES public.expenses(id) ON DELETE RESTRICT,
    requested_by INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    previous_amount NUMERIC(12, 2) NOT NULL,
    new_amount NUMERIC(12, 2) NOT NULL,
    previous_description TEXT NOT NULL,
    new_description TEXT NOT NULL,
    correction_reason TEXT NOT NULL,
    status VARCHAR(30) DEFAULT 'APPLIED',
    approved_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expense_corrections_expense_id ON public.expense_corrections(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_corrections_requested_by ON public.expense_corrections(requested_by);

CREATE OR REPLACE FUNCTION public.check_expense_deletion_protection()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.expense_splits 
        WHERE expense_id = OLD.id AND is_settled = TRUE
    ) THEN
        RAISE EXCEPTION 'Cannot delete expense: one or more participant shares have already been settled or paid. Use the safe correction process instead.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.expense_corrections
        WHERE expense_id = OLD.id
    ) THEN
        RAISE EXCEPTION 'Cannot delete expense with existing audit correction history.';
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_paid_expense_delete ON public.expenses;
CREATE TRIGGER trg_protect_paid_expense_delete
BEFORE DELETE ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.check_expense_deletion_protection();

CREATE OR REPLACE FUNCTION public.check_split_modification_protection()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.is_settled = TRUE AND TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Cannot delete a settled expense split. Settlement history must be preserved.';
    END IF;

    IF OLD.is_settled = TRUE AND TG_OP = 'UPDATE' THEN
        IF NEW.amount < OLD.amount THEN
            RAISE EXCEPTION 'Cannot reduce amount of an already settled split. Use the safe correction process.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_settled_split ON public.expense_splits;
CREATE TRIGGER trg_protect_settled_split
BEFORE UPDATE OR DELETE ON public.expense_splits
FOR EACH ROW
EXECUTE FUNCTION public.check_split_modification_protection();

ALTER TABLE public.expense_corrections ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Members can view expense corrections" ON public.expense_corrections;
    CREATE POLICY "Members can view expense corrections" ON public.expense_corrections
    FOR SELECT USING (
        requested_by IN (SELECT id FROM public.users WHERE auth_id = auth.uid()) OR
        EXISTS (
            SELECT 1 FROM public.expenses e
            JOIN public.group_members gm ON e.group_id = gm.group_id
            WHERE e.id = expense_corrections.expense_id AND gm.user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
        )
    );
END $$;

-- ------------------------------------------------------------------------------
-- 16. MASTER ADMIN, ERROR MONITORING & SYSTEM SECURITY SETTINGS TABLES
-- ------------------------------------------------------------------------------

-- 16.1 System Security Settings (Key-Value Config for Master Password, etc.)
CREATE TABLE IF NOT EXISTS public.system_security_settings (
    key VARCHAR(64) PRIMARY KEY,
    value_hash VARCHAR(255) NOT NULL,
    is_enabled BOOLEAN DEFAULT TRUE,
    metadata JSONB DEFAULT '{}'::jsonb,
    updated_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 16.2 Master Password Login Audit Trail
CREATE TABLE IF NOT EXISTS public.master_password_audit (
    id SERIAL PRIMARY KEY,
    target_user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    target_user_email VARCHAR(255),
    target_user_name VARCHAR(255),
    login_method VARCHAR(64) DEFAULT 'master_password',
    ip_address VARCHAR(100),
    user_agent TEXT,
    environment VARCHAR(64) DEFAULT 'development',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_master_pwd_audit_target ON public.master_password_audit(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_master_pwd_audit_time ON public.master_password_audit(created_at DESC);

-- 16.3 Master Admin Audit Logs
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    admin_email VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(64),
    target_id VARCHAR(64),
    details JSONB,
    ip_address VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON public.admin_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON public.admin_audit_logs(created_at DESC);

-- 16.4 Global System Errors & Issue Tracker
CREATE TABLE IF NOT EXISTS public.system_errors (
    id VARCHAR(64) PRIMARY KEY,
    fingerprint VARCHAR(128) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    category VARCHAR(64) NOT NULL DEFAULT 'backend_api',
    severity VARCHAR(32) NOT NULL DEFAULT 'medium',
    status VARCHAR(32) NOT NULL DEFAULT 'new',
    affected_module VARCHAR(100) DEFAULT 'general',
    api_route VARCHAR(255),
    http_status INTEGER,
    occurrence_count INTEGER DEFAULT 1,
    first_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolution_notes TEXT,
    resolved_by VARCHAR(255),
    resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_system_errors_fingerprint ON public.system_errors(fingerprint);
CREATE INDEX IF NOT EXISTS idx_system_errors_status ON public.system_errors(status);
CREATE INDEX IF NOT EXISTS idx_system_errors_severity ON public.system_errors(severity);
CREATE INDEX IF NOT EXISTS idx_system_errors_last_seen ON public.system_errors(last_seen DESC);

-- 16.5 System Error Occurrences (Detailed Stack Traces & Context)
CREATE TABLE IF NOT EXISTS public.system_error_occurrences (
    id SERIAL PRIMARY KEY,
    error_id VARCHAR(64) NOT NULL REFERENCES public.system_errors(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    group_id INTEGER REFERENCES public.groups(id) ON DELETE SET NULL,
    stack_trace TEXT,
    request_url TEXT,
    request_method VARCHAR(16),
    request_body_sanitized JSONB,
    browser_info TEXT,
    environment VARCHAR(64) DEFAULT 'production',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sys_err_occ_error ON public.system_error_occurrences(error_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sys_err_occ_time ON public.system_error_occurrences(created_at DESC);

-- 16.6 Row Level Security (RLS) on Administrative & Security Tables
ALTER TABLE public.system_security_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_password_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_error_occurrences ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    -- Security Settings: Only Master Admin
    DROP POLICY IF EXISTS "Master admin access system_security_settings" ON public.system_security_settings;
    CREATE POLICY "Master admin access system_security_settings" ON public.system_security_settings
        FOR ALL TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.users 
                WHERE (auth_id = auth.uid() OR id::text = auth.uid()::text) 
                AND role = 'master_admin'
            )
        );

    -- Master Password Audit: Only Master Admin
    DROP POLICY IF EXISTS "Master admin access master_password_audit" ON public.master_password_audit;
    CREATE POLICY "Master admin access master_password_audit" ON public.master_password_audit
        FOR ALL TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.users 
                WHERE (auth_id = auth.uid() OR id::text = auth.uid()::text) 
                AND role = 'master_admin'
            )
        );

    -- Admin Audit Logs: Only Master Admin
    DROP POLICY IF EXISTS "Master admin access admin_audit_logs" ON public.admin_audit_logs;
    CREATE POLICY "Master admin access admin_audit_logs" ON public.admin_audit_logs
        FOR ALL TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.users 
                WHERE (auth_id = auth.uid() OR id::text = auth.uid()::text) 
                AND role = 'master_admin'
            )
        );

    -- System Errors: Only Master Admin
    DROP POLICY IF EXISTS "Master admin access system_errors" ON public.system_errors;
    CREATE POLICY "Master admin access system_errors" ON public.system_errors
        FOR ALL TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.users 
                WHERE (auth_id = auth.uid() OR id::text = auth.uid()::text) 
                AND role = 'master_admin'
            )
        );

    -- System Error Occurrences: Only Master Admin
    DROP POLICY IF EXISTS "Master admin access system_error_occurrences" ON public.system_error_occurrences;
    CREATE POLICY "Master admin access system_error_occurrences" ON public.system_error_occurrences
        FOR ALL TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.users 
                WHERE (auth_id = auth.uid() OR id::text = auth.uid()::text) 
                AND role = 'master_admin'
            )
        );
END $$;

-- ------------------------------------------------------------------------------
-- 17. FINAL HEALTH CHECK CONFIRMATION
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    RAISE NOTICE '✓ SplitWise Supabase PostgreSQL Database Setup Script Executed Successfully!';
END $$;


