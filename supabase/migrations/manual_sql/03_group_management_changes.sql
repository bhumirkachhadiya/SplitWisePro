-- ==============================================================================
-- 03_group_management_changes.sql
-- Incremental Migration: Group Settings, Base Currency & Role Safeguards
-- Safe & Idempotent: Run directly in Supabase SQL Editor
-- ==============================================================================

-- 1. Ensure base_currency exists on groups
ALTER TABLE public.groups 
  ADD COLUMN IF NOT EXISTS base_currency VARCHAR(10) DEFAULT 'INR';

-- 2. Ensure role exists on group_members
ALTER TABLE public.group_members 
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'member';

-- 3. Set existing NULL roles to 'member' or 'admin' for group creators
UPDATE public.group_members gm
SET role = 'admin'
FROM public.groups g
WHERE gm.group_id = g.id AND gm.user_id = g.created_by AND (gm.role IS NULL OR gm.role = 'member');

UPDATE public.group_members
SET role = 'member'
WHERE role IS NULL;

-- 4. Fast lookup indexes for group membership & roles
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON public.group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group_role ON public.group_members(group_id, role);
CREATE INDEX IF NOT EXISTS idx_groups_created_by ON public.groups(created_by);
