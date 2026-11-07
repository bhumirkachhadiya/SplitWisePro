-- ==============================================================================
-- 07_currency_and_exchange_rate_changes.sql
-- Incremental Migration: Currency Master, Precision & Live Exchange Rate Cache
-- Safe & Idempotent: Run directly in Supabase SQL Editor
-- ==============================================================================

-- 1. Create public.currencies master table
CREATE TABLE IF NOT EXISTS public.currencies (
  code VARCHAR(10) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  symbol VARCHAR(10) NOT NULL,
  decimals INT NOT NULL DEFAULT 2,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create public.exchange_rates cache table
CREATE TABLE IF NOT EXISTS public.exchange_rates (
  base_currency VARCHAR(10) NOT NULL,
  target_currency VARCHAR(10) NOT NULL,
  rate NUMERIC(14,6) NOT NULL,
  provider VARCHAR(50) DEFAULT 'open.er-api.com',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (base_currency, target_currency)
);

-- 3. Seed 9 Supported Currencies idempotently
INSERT INTO public.currencies (code, name, symbol, decimals) VALUES
  ('INR', 'Indian Rupee', '₹', 2),
  ('USD', 'US Dollar', '$', 2),
  ('EUR', 'Euro', '€', 2),
  ('GBP', 'British Pound', '£', 2),
  ('AED', 'UAE Dirham', 'د.إ', 2),
  ('SGD', 'Singapore Dollar', 'S$', 2),
  ('AUD', 'Australian Dollar', 'A$', 2),
  ('CAD', 'Canadian Dollar', 'C$', 2),
  ('JPY', 'Japanese Yen', '¥', 0)
ON CONFLICT (code) DO UPDATE 
SET name = EXCLUDED.name, symbol = EXCLUDED.symbol, decimals = EXCLUDED.decimals;

-- 4. Initial identity exchange rates for same-currency conversions
INSERT INTO public.exchange_rates (base_currency, target_currency, rate, provider, updated_at) VALUES
  ('INR', 'INR', 1.000000, 'system', NOW()),
  ('USD', 'USD', 1.000000, 'system', NOW()),
  ('EUR', 'EUR', 1.000000, 'system', NOW()),
  ('GBP', 'GBP', 1.000000, 'system', NOW()),
  ('AED', 'AED', 1.000000, 'system', NOW()),
  ('SGD', 'SGD', 1.000000, 'system', NOW()),
  ('AUD', 'AUD', 1.000000, 'system', NOW()),
  ('CAD', 'CAD', 1.000000, 'system', NOW()),
  ('JPY', 'JPY', 1.000000, 'system', NOW())
ON CONFLICT (base_currency, target_currency) DO NOTHING;

-- 5. Fast lookup index for rates
CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup 
  ON public.exchange_rates(base_currency, target_currency);
