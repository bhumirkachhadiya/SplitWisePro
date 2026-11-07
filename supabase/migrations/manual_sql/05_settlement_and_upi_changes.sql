-- ==============================================================================
-- 05_settlement_and_upi_changes.sql
-- Incremental Migration: Settlements & Automated UPI Payment Tracking
-- Safe & Idempotent: Run directly in Supabase SQL Editor
-- ==============================================================================

-- 1. Ensure public.settlements table exists
CREATE TABLE IF NOT EXISTS public.settlements (
  id SERIAL PRIMARY KEY,
  group_id INT REFERENCES public.groups(id) ON DELETE CASCADE,
  payer_id INT NOT NULL REFERENCES public.users(id),
  receiver_id INT NOT NULL REFERENCES public.users(id),
  amount NUMERIC(12,2) NOT NULL,
  payment_method VARCHAR(50) DEFAULT 'UPI', -- 'UPI', 'CASH', 'BANK_TRANSFER'
  transaction_reference VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_settlement_positive_amount CHECK (amount > 0),
  CONSTRAINT chk_settlement_different_users CHECK (payer_id <> receiver_id)
);

-- 2. Ensure public.upi_payment_requests table exists
CREATE TABLE IF NOT EXISTS public.upi_payment_requests (
  id SERIAL PRIMARY KEY,
  request_id VARCHAR(64) NOT NULL UNIQUE,
  payer_id INT NOT NULL REFERENCES public.users(id),
  receiver_id INT NOT NULL REFERENCES public.users(id),
  group_id INT REFERENCES public.groups(id),
  amount NUMERIC(12,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'INR',
  status VARCHAR(30) DEFAULT 'PENDING', -- 'PENDING', 'SUCCESS', 'FAILED', 'EXPIRED'
  upi_id VARCHAR(100) NOT NULL,
  upi_string TEXT,
  transaction_ref VARCHAR(100),
  utr VARCHAR(100),
  notes TEXT,
  settlement_id INT REFERENCES public.settlements(id),
  idempotency_key VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  CONSTRAINT chk_upi_req_positive CHECK (amount > 0)
);

-- 3. Idempotency unique index to prevent duplicate automated settlements
CREATE UNIQUE INDEX IF NOT EXISTS idx_upi_req_idempotency 
  ON public.upi_payment_requests(idempotency_key) 
  WHERE idempotency_key IS NOT NULL;

-- 4. Fast lookup indexes
CREATE INDEX IF NOT EXISTS idx_settlements_payer ON public.settlements(payer_id);
CREATE INDEX IF NOT EXISTS idx_settlements_receiver ON public.settlements(receiver_id);
CREATE INDEX IF NOT EXISTS idx_settlements_group ON public.settlements(group_id);
CREATE INDEX IF NOT EXISTS idx_upi_req_lookup ON public.upi_payment_requests(request_id, status);
