-- ==============================================================================
-- 04_expense_and_split_changes.sql
-- Incremental Migration: Multi-Currency Expense Columns & Split Percentages
-- Safe & Idempotent: Run directly in Supabase SQL Editor
-- ==============================================================================

-- 1. Ensure multi-currency tracking columns exist on public.expenses
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS original_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(14,6) DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS converted_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS rate_provider VARCHAR(50) DEFAULT 'open.er-api.com',
  ADD COLUMN IF NOT EXISTS rate_timestamp TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS expense_date DATE DEFAULT CURRENT_DATE;

-- 2. Backfill existing expenses to set original_amount and converted_amount
UPDATE public.expenses
SET original_amount = amount,
    converted_amount = amount,
    exchange_rate = 1.0
WHERE original_amount IS NULL;

-- 3. Ensure custom split calculations support on public.expense_splits
ALTER TABLE public.expense_splits
  ADD COLUMN IF NOT EXISTS split_percentage NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS shares NUMERIC(10,2);

-- 4. Fast lookup indexes for expenses and date range queries
CREATE INDEX IF NOT EXISTS idx_expenses_group_date ON public.expenses(group_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_paid_by ON public.expenses(paid_by);
CREATE INDEX IF NOT EXISTS idx_expense_splits_user_settled ON public.expense_splits(user_id, is_settled);
CREATE INDEX IF NOT EXISTS idx_expense_splits_expense_id ON public.expense_splits(expense_id);
