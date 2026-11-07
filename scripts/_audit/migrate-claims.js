const { pool } = require('../../db');
(async () => {
  await pool.query(`
    ALTER TABLE upi_payment_requests ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
    ALTER TABLE upi_payment_requests ADD COLUMN IF NOT EXISTS claimed_utr VARCHAR(100);
    ALTER TABLE upi_payment_requests ADD COLUMN IF NOT EXISTS confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_upr_claimed ON upi_payment_requests(claimed_at) WHERE claimed_at IS NOT NULL;
    ALTER TABLE expense_splits DROP CONSTRAINT IF EXISTS chk_expenses_split_type;
    ALTER TABLE expenses DROP CONSTRAINT IF EXISTS chk_expenses_split_type;
    ALTER TABLE expenses ADD CONSTRAINT chk_expenses_split_type
      CHECK (split_type IN ('equal','exact','percentage','shares','smart_custom','single')) NOT VALID;
  `);
  console.log('payment-claim columns ready');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
