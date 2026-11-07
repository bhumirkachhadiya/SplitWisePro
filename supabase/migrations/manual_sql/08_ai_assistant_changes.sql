-- ==============================================================================
-- 08_ai_assistant_changes.sql
-- Incremental Migration: AI Agent Tool Executions & Audit Trail
-- Safe & Idempotent: Run directly in Supabase SQL Editor
-- ==============================================================================

-- 1. Create public.ai_agent_actions table
CREATE TABLE IF NOT EXISTS public.ai_agent_actions (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES public.users(id) ON DELETE SET NULL,
  command_text TEXT NOT NULL,
  action_type VARCHAR(50) NOT NULL, -- e.g. 'CREATE_GROUP', 'ADD_EXPENSE', 'NAVIGATE'
  action_payload JSONB DEFAULT '{}'::jsonb,
  status VARCHAR(30) DEFAULT 'PENDING_CONFIRMATION', -- 'PENDING_CONFIRMATION', 'EXECUTED', 'CANCELLED', 'FAILED'
  execution_result JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Fast lookup index for user action history
CREATE INDEX IF NOT EXISTS idx_ai_agent_actions_user_created 
  ON public.ai_agent_actions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_agent_actions_status 
  ON public.ai_agent_actions(status);
