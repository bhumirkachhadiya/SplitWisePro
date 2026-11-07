const { pool } = require('../../db');
const EPS = 0.005;

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE expense_splits ADD COLUMN IF NOT EXISTS base_amount NUMERIC(12,2) NOT NULL DEFAULT 0');
    await client.query('ALTER TABLE expense_splits ADD COLUMN IF NOT EXISTS settled_amount_base NUMERIC(12,2) NOT NULL DEFAULT 0');

    // Backfill base_amount per expense, distributing converted_amount exactly.
    const expenses = await client.query(`
      SELECT id, amount, COALESCE(converted_amount, amount) AS converted_amount, COALESCE(exchange_rate, 1) AS exchange_rate
      FROM expenses
    `);
    for (const e of expenses.rows) {
      const splits = await client.query(
        'SELECT id, amount, settled_amount FROM expense_splits WHERE expense_id = $1 ORDER BY id ASC',
        [e.id]
      );
      if (splits.rows.length === 0) continue;
      const convertedUnits = Math.round(parseFloat(e.converted_amount) * 100);
      const amounts = splits.rows.map(s => parseFloat(s.amount));
      const total = amounts.reduce((a, b) => a + b, 0);
      if (total <= 0) continue;
      let allocated = 0;
      const bases = amounts.map((a, i) => {
        if (i === amounts.length - 1) return convertedUnits - allocated;
        const u = Math.round((a / total) * convertedUnits);
        allocated += u;
        return u;
      });
      for (let i = 0; i < splits.rows.length; i++) {
        const s = splits.rows[i];
        const base = bases[i] / 100;
        const rate = parseFloat(e.exchange_rate) || 1;
        const settledBase = Math.round(parseFloat(s.settled_amount || 0) * rate * 100) / 100;
        await client.query(
          'UPDATE expense_splits SET base_amount = $1, settled_amount_base = $2 WHERE id = $3',
          [base, settledBase, s.id]
        );
      }
    }

    // Normalise flags once more against base amounts.
    await client.query(`
      UPDATE expense_splits
      SET is_settled = (settled_amount_base >= base_amount - ${EPS}),
          settled_at = CASE WHEN settled_amount_base >= base_amount - ${EPS} THEN COALESCE(settled_at, NOW()) ELSE NULL END
    `);

    await client.query('COMMIT');
    console.log('base_amount / settled_amount_base backfilled.');
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
  }
})();
