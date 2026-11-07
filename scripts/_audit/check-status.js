const { pool } = require('../../db');
pool.query("select conname, pg_get_constraintdef(oid) def from pg_constraint where conname in ('upi_payment_requests_status_check','ai_agent_actions_status_check')")
  .then(r => { console.table(r.rows); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
