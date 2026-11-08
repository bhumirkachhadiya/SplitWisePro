-- ==============================================================================
-- MIGRATION 003: END-USER FEEDBACK IMPROVEMENTS & WORKFLOW ENHANCEMENTS
-- ==============================================================================
-- Safe, idempotent migration supporting:
-- 1. User Profile Picture (DP) persistence (users.avatar_url, profiles.avatar_url)
-- 2. Group Cover Photo, Group Icon, and Secure Invitation Code (groups.cover_photo_url, icon_url, invite_code)
-- 3. Rich Chat Attachments (chat_messages.message_type, media_url, file_name, file_size, read_at)
-- ==============================================================================

BEGIN;

-- 1. User Profile Display Picture Support
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 2. Group Customization & WhatsApp Invitation Support
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS cover_photo_url TEXT;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS icon_url TEXT;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS invite_code VARCHAR(64) UNIQUE;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_groups_invite_code ON public.groups(invite_code);

-- Seed existing groups with unique invite codes if null
UPDATE public.groups 
SET invite_code = LOWER(SUBSTRING(MD5(RANDOM()::TEXT || id::TEXT || NOW()::TEXT) FROM 1 FOR 12))
WHERE invite_code IS NULL;

-- 3. Chat Media, GIF, Sticker & Document Attachment Support
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(20) DEFAULT 'text';
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS file_name VARCHAR(255);
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS file_size INT;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_created ON public.chat_messages(conversation_id, created_at);

COMMIT;
