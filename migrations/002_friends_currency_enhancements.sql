-- ==============================================================================
-- MIGRATION 002: FRIENDS, MULTI-CURRENCY, GROUP PRIVACY, AND REALTIME CHAT
-- ==============================================================================

-- 1. Currencies Master Table
CREATE TABLE IF NOT EXISTS public.currencies (
    code VARCHAR(3) PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    decimals INTEGER DEFAULT 2,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed Supported Currencies
INSERT INTO public.currencies (code, name, symbol, decimals) VALUES
    ('INR', 'Indian Rupee', '₹', 2),
    ('USD', 'US Dollar', '$', 2),
    ('EUR', 'Euro', '€', 2),
    ('GBP', 'British Pound', '£', 2),
    ('AED', 'UAE Dirham', 'AED', 2),
    ('SGD', 'Singapore Dollar', 'S$', 2),
    ('AUD', 'Australian Dollar', 'A$', 2),
    ('CAD', 'Canadian Dollar', 'C$', 2),
    ('JPY', 'Japanese Yen', '¥', 0)
ON CONFLICT (code) DO NOTHING;

-- 2. Exchange Rates Cache Table
CREATE TABLE IF NOT EXISTS public.exchange_rates (
    base_currency VARCHAR(3) NOT NULL REFERENCES public.currencies(code),
    target_currency VARCHAR(3) NOT NULL REFERENCES public.currencies(code),
    rate NUMERIC(16, 6) NOT NULL CHECK (rate > 0),
    provider VARCHAR(50) DEFAULT 'exchangerate-api',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (base_currency, target_currency)
);

-- Seed initial exchange rates relative to INR
INSERT INTO public.exchange_rates (base_currency, target_currency, rate, provider, updated_at) VALUES
    ('INR', 'INR', 1.000000, 'system', NOW()),
    ('INR', 'USD', 0.011600, 'system', NOW()),
    ('INR', 'EUR', 0.010800, 'system', NOW()),
    ('INR', 'GBP', 0.009200, 'system', NOW()),
    ('INR', 'AED', 0.042600, 'system', NOW()),
    ('INR', 'SGD', 0.015600, 'system', NOW()),
    ('INR', 'AUD', 0.017800, 'system', NOW()),
    ('INR', 'CAD', 0.016200, 'system', NOW()),
    ('INR', 'JPY', 1.760000, 'system', NOW()),
    ('USD', 'INR', 86.200000, 'system', NOW()),
    ('EUR', 'INR', 92.500000, 'system', NOW()),
    ('GBP', 'INR', 108.700000, 'system', NOW()),
    ('AED', 'INR', 23.470000, 'system', NOW()),
    ('SGD', 'INR', 64.100000, 'system', NOW()),
    ('AUD', 'INR', 56.180000, 'system', NOW()),
    ('CAD', 'INR', 61.730000, 'system', NOW()),
    ('JPY', 'INR', 0.568000, 'system', NOW())
ON CONFLICT (base_currency, target_currency) DO UPDATE SET
    rate = EXCLUDED.rate,
    updated_at = NOW();

-- 3. Users Table Enhancements
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS default_currency VARCHAR(3) DEFAULT 'INR' REFERENCES public.currencies(code);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS user_code VARCHAR(20) UNIQUE;

-- Generate unique user_code for existing users if NULL
UPDATE public.users 
SET user_code = 'SW-' || UPPER(SUBSTRING(MD5(id::text || email || 'salt2026') FROM 1 FOR 6))
WHERE user_code IS NULL;

-- 4. Groups Table Enhancements
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS base_currency VARCHAR(3) DEFAULT 'INR' REFERENCES public.currencies(code);

-- 5. Expenses Table Enhancements for Historical Exchange Rates
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS original_amount NUMERIC(12, 2);
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(16, 6) DEFAULT 1.000000;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS converted_amount NUMERIC(12, 2);
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS rate_provider VARCHAR(50) DEFAULT 'system';
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS rate_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Backfill existing expenses
UPDATE public.expenses 
SET original_amount = amount,
    converted_amount = amount,
    exchange_rate = 1.000000,
    rate_provider = 'system',
    rate_timestamp = created_at
WHERE original_amount IS NULL;

-- 6. Friends and Friend Requests Tables
CREATE TABLE IF NOT EXISTS public.friend_requests (
    id SERIAL PRIMARY KEY,
    sender_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    receiver_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_friend_request UNIQUE(sender_id, receiver_id),
    CONSTRAINT chk_no_self_request CHECK (sender_id != receiver_id)
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

-- 7. Customizable Email Templates Table
CREATE TABLE IF NOT EXISTS public.custom_email_templates (
    id SERIAL PRIMARY KEY,
    template_type VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'group_invitation', 'expense_reminder'
    subject VARCHAR(200) NOT NULL,
    body_text TEXT NOT NULL,
    body_html TEXT NOT NULL,
    updated_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed default customizable templates
INSERT INTO public.custom_email_templates (template_type, subject, body_text, body_html) VALUES
(
    'group_invitation',
    'Invitation to join {group_name} on SplitWise',
    'Hi {recipient_name},\n\n{inviter_name} has invited you to join "{group_name}" on SplitWise.\n\nPersonal note from {inviter_name}:\n"{custom_message}"\n\nLog in or sign up to view shared expenses.',
    '<div style="font-family:sans-serif;padding:24px;color:#1e293b;"><h2 style="color:#0f766e;">You''ve been invited to {group_name}</h2><p><strong>{inviter_name}</strong> invited you to collaborate on group expenses.</p><blockquote style="border-left:4px solid #0f766e;padding-left:12px;color:#475569;margin:16px 0;">"{custom_message}"</blockquote><p><a href="{action_url}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">View Group on SplitWise</a></p></div>'
),
(
    'expense_reminder',
    'Friendly SplitWise Balance Reminder: {group_name}',
    'Hi {recipient_name},\n\nThis is a friendly reminder that you have a pending share of {currency_symbol}{amount} in "{group_name}".\n\nNotes: {notes}\n\nPlease settle up when convenient via UPI.',
    '<div style="font-family:sans-serif;padding:24px;color:#1e293b;"><h2 style="color:#0f766e;">SplitWise Balance Reminder</h2><p>Hi <strong>{recipient_name}</strong>,</p><p>You have a pending share of <strong>{currency_symbol}{amount}</strong> in <strong>{group_name}</strong>.</p><p style="color:#475569;">Note: {notes}</p><p><a href="{action_url}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Settle via UPI</a></p></div>'
)
ON CONFLICT (template_type) DO NOTHING;

-- 8. AI Assistant Actions Audit Log Table
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

-- Enable RLS on new tables
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_agent_actions ENABLE ROW LEVEL SECURITY;

-- Public read for currencies and exchange rates
DROP POLICY IF EXISTS "Currencies readable by all" ON public.currencies;
CREATE POLICY "Currencies readable by all" ON public.currencies FOR SELECT USING (true);

DROP POLICY IF EXISTS "Exchange rates readable by all" ON public.exchange_rates;
CREATE POLICY "Exchange rates readable by all" ON public.exchange_rates FOR SELECT USING (true);

-- Friends policies
DROP POLICY IF EXISTS "Users can read own friends" ON public.friends;
CREATE POLICY "Users can read own friends" ON public.friends FOR SELECT USING (
    auth.role() = 'service_role' OR
    user_id::text = auth.uid()::text OR
    friend_id::text = auth.uid()::text
);

-- Friend requests policies
DROP POLICY IF EXISTS "Users can read own friend requests" ON public.friend_requests;
CREATE POLICY "Users can read own friend requests" ON public.friend_requests FOR SELECT USING (
    auth.role() = 'service_role' OR
    sender_id::text = auth.uid()::text OR
    receiver_id::text = auth.uid()::text
);

-- AI actions policies
DROP POLICY IF EXISTS "Users can view own AI actions" ON public.ai_agent_actions;
CREATE POLICY "Users can view own AI actions" ON public.ai_agent_actions FOR ALL USING (
    auth.role() = 'service_role' OR
    user_id::text = auth.uid()::text
);
