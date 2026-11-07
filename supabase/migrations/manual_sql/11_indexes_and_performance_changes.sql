-- ==============================================================================
-- 11_indexes_and_performance_changes.sql
-- Incremental Migration: High-Performance Indexes for Scale & Query Speed
-- Safe & Idempotent: Run directly in Supabase SQL Editor
-- ==============================================================================

-- 1. User & Auth performance indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON public.users(auth_id);
CREATE INDEX IF NOT EXISTS idx_users_user_code ON public.users(user_code);

-- 2. Friends & Requests performance indexes
CREATE INDEX IF NOT EXISTS idx_friends_user_id ON public.friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend_id ON public.friends(friend_id);
CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver ON public.friend_requests(receiver_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_requests_sender ON public.friend_requests(sender_id, status);

-- 3. Group membership & role indexes
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON public.group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group_role ON public.group_members(group_id, role);

-- 4. Expenses & Splits date-range and reporting indexes
CREATE INDEX IF NOT EXISTS idx_expenses_group_date ON public.expenses(group_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_paid_by ON public.expenses(paid_by);
CREATE INDEX IF NOT EXISTS idx_expense_splits_user_settled ON public.expense_splits(user_id, is_settled);
CREATE INDEX IF NOT EXISTS idx_expense_splits_expense_id ON public.expense_splits(expense_id);

-- 5. Settlements & UPI requests indexes
CREATE INDEX IF NOT EXISTS idx_settlements_payer ON public.settlements(payer_id);
CREATE INDEX IF NOT EXISTS idx_settlements_receiver ON public.settlements(receiver_id);
CREATE INDEX IF NOT EXISTS idx_settlements_group ON public.settlements(group_id);
CREATE INDEX IF NOT EXISTS idx_upi_payment_requests_lookup ON public.upi_payment_requests(request_id, status);

-- 6. Chat & Activity logs timeline indexes
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_created ON public.chat_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_group_created ON public.activity_logs(group_id, created_at);

-- 7. Exchange rates & AI action history indexes
CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup ON public.exchange_rates(base_currency, target_currency);
CREATE INDEX IF NOT EXISTS idx_ai_agent_actions_user_created ON public.ai_agent_actions(user_id, created_at);
