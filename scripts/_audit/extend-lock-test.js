const fs = require('fs');
const p = 'scripts/_audit/test-payment-requests.js';
let c = fs.readFileSync(p, 'utf8');
const needle = `  // Group lock blocks new requests`;
const add = `  const forged = await api('POST', '/api/payment-requests', outsider.token, {
    payer_id: debtor.id, receiver_id: receiver.id, expense_id: expenseId, amount: 10, payment_method: 'CASH'
  });
  check('an unrelated user cannot forge a request for another payer', forged.status === 404 || forged.status === 400, 'status=' + forged.status + ' ' + forged.text.slice(0, 80));

  // Locked circle also blocks approval of an existing request
  const lockExp = await api('POST', '/api/expenses', debtor.token, {
    group_id: gid, paid_by: receiver.id, amount: 100, description: 'Locked approval test',
    split_type: 'equal', splits: [{ user_id: debtor.id }, { user_id: receiver.id }]
  });
  const lockReq = await api('POST', '/api/payment-requests', debtor.token, { expense_id: lockExp.data.id, amount: 50, payment_method: 'CASH' });
  await api('POST', \`/api/groups/\${gid}/lock\`, debtor.token, {});
  const lockedAccept = await api('POST', \`/api/payment-requests/\${lockReq.data.request.id}/accept\`, receiver.token);
  check('locked circle blocks approval of a pending request', lockedAccept.status === 400, 'status=' + lockedAccept.status + ' ' + lockedAccept.text.slice(0, 80));
  await api('POST', \`/api/groups/\${gid}/unlock\`, debtor.token, {});
  const unlockedAccept = await api('POST', \`/api/payment-requests/\${lockReq.data.request.id}/accept\`, receiver.token);
  check('unlocking allows the pending request to be approved', unlockedAccept.status === 200, 'status=' + unlockedAccept.status);

  // Group lock blocks new requests`;
if (!c.includes(needle)) { console.error('anchor missing'); process.exit(1); }
c = c.replace(needle, add);
fs.writeFileSync(p, c);
console.log('added lock approval and forged payer tests');
