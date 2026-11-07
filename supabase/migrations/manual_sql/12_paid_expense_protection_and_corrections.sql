-- ==============================================================================
-- 12_paid_expense_protection_and_corrections.sql
-- SplitEase: Paid Expense & Settlement History Protection + Safe Corrections
-- ==============================================================================

-- 1. Create expense_corrections audit table
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

-- 2. Trigger Function: Prevent deletion of expenses that have settled shares
CREATE OR REPLACE FUNCTION public.check_expense_deletion_protection()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if any split is marked as settled
    IF EXISTS (
        SELECT 1 FROM public.expense_splits 
        WHERE expense_id = OLD.id AND is_settled = TRUE
    ) THEN
        RAISE EXCEPTION 'Cannot delete expense: one or more participant shares have already been settled or paid. Use the safe correction process instead.';
    END IF;

    -- Check if any correction record exists
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

-- 3. Trigger Function: Prevent modification or deletion of settled splits
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

-- 4. Enable Row Level Security (RLS) on expense_corrections
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
