-- ==============================================================================
-- 06_chat_and_notification_changes.sql
-- Incremental Migration: In-App Chat, Discussions & Activity Feed
-- Safe & Idempotent: Run directly in Supabase SQL Editor
-- ==============================================================================

-- 1. Ensure public.chat_conversations table exists
CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id SERIAL PRIMARY KEY,
  group_id INT REFERENCES public.groups(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  type VARCHAR(20) DEFAULT 'group', -- 'group', 'direct'
  created_by INT REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Ensure public.chat_messages table exists
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id SERIAL PRIMARY KEY,
  conversation_id INT NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  sender_id INT NOT NULL REFERENCES public.users(id),
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Ensure public.chat_conversation_members table exists
CREATE TABLE IF NOT EXISTS public.chat_conversation_members (
  id SERIAL PRIMARY KEY,
  conversation_id INT NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_conv_member UNIQUE (conversation_id, user_id)
);

-- 4. Ensure public.activity_logs table exists
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES public.users(id) ON DELETE SET NULL,
  group_id INT REFERENCES public.groups(id) ON DELETE CASCADE,
  activity_type VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Fast lookup indexes for messaging and activity feeds
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_created ON public.chat_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_conv_members_user ON public.chat_conversation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_group_created ON public.activity_logs(group_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON public.activity_logs(user_id);
