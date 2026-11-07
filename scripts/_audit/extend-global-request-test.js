const fs = require('fs');
const p = 'scripts/_audit/test-payment-requests.js';
let c = fs.readFileSync(p, 'utf8');
const needle = `  // Duplicate transaction reference across accepted requests`;
const add = `  // Global (non-expense) request applies across multiple outstanding expenses
  const globalExp = await api('POST', '/api/expenses', debtor.token, {
    group_id: gid, paid_by: receiver.id, amount: 200, description: 'Global request expense',
    split_type: 'equal', splits: [{ user_id: debtor.id }, { user_id: receiver.id }]
  });
  const globalReq = await api('POST', '/api/payment-requests', debtor.token, { group_id: gid, receiver_id: receiver.id, amount: 100, payment_method: 'CASH' });
  check('outstanding-balance request can be sent without an expense id', globalReq.status === 201, 'status=' + globalReq.status + ' ' + globalReq.text.slice(0, 100));
  const globalAccept = await api('POST', \`/api/payment-requests/\${globalReq.data.request.id}/accept\`, receiver.token);
  check('outstanding-balance request is accepted', globalAccept.status === 200, 'status=' + globalAccept.status);
  const geRow = await pool.query('SELECT settled_amount_base FROM expense_splits WHERE expense_id=$1 AND user_id=$2', [globalExp.data.id, debtor.id]);
  check('global request allocates across the oldest outstanding expenses', Math.abs(Number(geRow.rows[0].settled_amount_base) - 50) < 0.01, geRow.rows[0].settled_amount_base);

  // Duplicate transaction reference across accepted requests`;
if (!c.includes(needle)) { console.error('anchor missing'); process.exit(1); }
c = c.replace(needle, add);
fs.writeFileSync(p, c);
console.log('added global request test');
