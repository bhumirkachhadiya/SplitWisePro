-- ==============================================================================
-- 01_user_profile_changes.sql
-- Incremental Migration: User Account, Profiles & Email Verification
-- Safe & Idempotent: Run directly in Supabase SQL Editor
-- ==============================================================================

-- 1. Ensure columns exist on public.users
ALTER TABLE public.users 
  ADD COLUMN IF NOT EXISTS default_currency VARCHAR(10) DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS user_code VARCHAR(32);

-- 2. Populate user_code for existing users if NULL
UPDATE public.users 
SET user_code = 'SW-' || UPPER(SUBSTRING(MD5(id::text || email || created_at::text) FROM 1 FOR 6))
WHERE user_code IS NULL;

-- 3. Add UNIQUE constraint to user_code if not present
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_user_code_key'
  ) THEN
    ALTER TABLE public.users ADD CONSTRAINT users_user_code_key UNIQUE (user_code);
  END IF;
END $$;

-- 4. Ensure public.profiles table exists for Supabase Auth compatibility
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  avatar_initials VARCHAR(10) DEFAULT 'US',
  upi_id VARCHAR(100),
  phone VARCHAR(50) DEFAULT '+91 98765 00000',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Email verification & OTP table
CREATE TABLE IF NOT EXISTS public.email_verifications (
  id SERIAL PRIMARY KEY,
  verification_id VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL,
  otp_hash VARCHAR(255) NOT NULL,
  purpose VARCHAR(50) NOT NULL DEFAULT 'signup',
  payload JSONB DEFAULT '{}'::jsonb,
  reset_token VARCHAR(64),
  reset_token_expires_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ,
  is_used BOOLEAN NOT NULL DEFAULT FALSE
);

-- 6. Indexes for email verification lookups
CREATE INDEX IF NOT EXISTS idx_email_verif_lookup 
  ON public.email_verifications(email, purpose, is_used);
CREATE INDEX IF NOT EXISTS idx_email_verif_token 
  ON public.email_verifications(reset_token);
CREATE INDEX IF NOT EXISTS idx_users_user_code 
  ON public.users(user_code);
