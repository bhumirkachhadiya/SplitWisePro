const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');
const reps = [
  ['SELECT e.id, e.paid_by, e.group_id, e.amount, e.description, gm.role', 'SELECT e.id, e.paid_by, e.group_id, e.amount, e.currency, e.description, gm.role'],
  ["SELECT COUNT(*)::int as count FROM expense_splits \n                WHERE expense_id = $1 AND is_settled = TRUE", "SELECT COUNT(*)::int as count FROM expense_splits \n                WHERE expense_id = $1 AND (settled_amount > 0.005 OR settled_amount_base > 0.005)"]
];
for (const [a, b] of reps) {
  const n = c.split(a).length - 1;
  if (n === 0) { console.error('MISS: ' + a.slice(0, 60)); process.exit(1); }
  c = c.split(a).join(b);
  console.log('OK(' + n + ')');
}
fs.writeFileSync('server.js', c);
console.log('done');
