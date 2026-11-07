const fs = require('fs');
const p = 'scripts/_audit/test-payment-requests.js';
let c = fs.readFileSync(p, 'utf8');
const needle = `  // Group lock blocks new requests`;
const add = `  // Duplicate transaction reference across accepted requests
  const refExp = await api('POST', '/api/expenses', debtor.token, {
    group_id: gid, paid_by: receiver.id, amount: 100, description: 'Duplicate UTR test',
    split_type: 'equal', splits: [{ user_id: debtor.id }, { user_id: receiver.id }]
  });
  const refReq = await api('POST', '/api/payment-requests', debtor.token, { expense_id: refExp.data.id, amount: 50, payment_method: 'UPI', transaction_reference: 'UTR-MKT-1' });
  const refAccept = await api('POST', \`/api/payment-requests/\${refReq.data.request.id}/accept\`, receiver.token);
  check('reusing an already accepted UTR is blocked', refAccept.status === 409 && refAccept.data.code === 'DUPLICATE_TRANSACTION_REFERENCE', 'status=' + refAccept.status + ' ' + refAccept.text.slice(0, 100));

  // Deleting an expense cancels its pending request and preserves the snapshot
  const delExp = await api('POST', '/api/expenses', debtor.token, {
    group_id: gid, paid_by: receiver.id, amount: 100, description: 'Deleted expense snapshot',
    split_type: 'equal', splits: [{ user_id: debtor.id }, { user_id: receiver.id }]
  });
  const delReq = await api('POST', '/api/payment-requests', debtor.token, { expense_id: delExp.data.id, amount: 50, payment_method: 'CASH' });
  const del = await api('DELETE', \`/api/expenses/\${delExp.data.id}\`, receiver.token);
  check('payer can still delete an expense with only a pending request', del.status === 200, 'status=' + del.status + ' ' + del.text.slice(0, 80));
  const delReqRow = await pool.query('SELECT status, expense_description_snapshot FROM payment_requests WHERE id=$1', [delReq.data.request.id]);
  check('expense deletion cancels the pending request', delReqRow.rows[0].status === 'CANCELLED', delReqRow.rows[0].status);
  check('request history retains the deleted expense description', delReqRow.rows[0].expense_description_snapshot === 'Deleted expense snapshot', delReqRow.rows[0].expense_description_snapshot);

  // Group lock blocks new requests`;
if (!c.includes(needle)) { console.error('anchor missing'); process.exit(1); }
c = c.replace(needle, add);
fs.writeFileSync(p, c);
console.log('extended payment request API tests');
