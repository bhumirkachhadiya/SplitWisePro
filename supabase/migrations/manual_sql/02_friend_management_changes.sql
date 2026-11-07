-- ==============================================================================
-- 02_friend_management_changes.sql
-- Incremental Migration: Friends Network & Connection Requests
-- Safe & Idempotent: Run directly in Supabase SQL Editor
-- ==============================================================================

-- 1. Create public.friends table if not exists
CREATE TABLE IF NOT EXISTS public.friends (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  friend_id INT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_friends_no_self CHECK (user_id <> friend_id),
  CONSTRAINT uq_friend_pair UNIQUE (user_id, friend_id)
);

-- 2. Create public.friend_requests table if not exists
CREATE TABLE IF NOT EXISTS public.friend_requests (
  id SERIAL PRIMARY KEY,
  sender_id INT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  receiver_id INT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'rejected', 'cancelled'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_friend_req_no_self CHECK (sender_id <> receiver_id)
);

-- 3. Unique index to prevent duplicate pending requests between same pair
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_pending_friend_request 
  ON public.friend_requests(sender_id, receiver_id) 
  WHERE status = 'pending';

-- 4. Fast lookup indexes for friends and requests
CREATE INDEX IF NOT EXISTS idx_friends_user_id ON public.friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend_id ON public.friends(friend_id);
CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver ON public.friend_requests(receiver_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_requests_sender ON public.friend_requests(sender_id, status);
