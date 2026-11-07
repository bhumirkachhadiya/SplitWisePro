const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');
const reps = [
  // expense list protection
  ['            const hasSettledSplits = splits.some(s => s.is_settled === true);',
   '            const hasSettledSplits = splits.some(s => parseInt(s.user_id) !== parseInt(exp.paid_by) && (parseFloat(s.settled_amount || 0) > 0.005 || parseFloat(s.settled_amount_base || 0) > 0.005));'],
  // single expense protection
  ['        const hasSettledSplits = splitsRes.rows.some(s => s.is_settled === true && parseInt(s.user_id) !== parseInt(expense.paid_by));',
   '        const hasSettledSplits = splitsRes.rows.some(s => parseInt(s.user_id) !== parseInt(expense.paid_by) && (parseFloat(s.settled_amount || 0) > 0.005 || parseFloat(s.settled_amount_base || 0) > 0.005));']
];
for (const [a, b] of reps) {
  const n = c.split(a).length - 1;
  if (n === 0) { console.error('MISS: ' + a.slice(0, 70)); process.exit(1); }
  c = c.split(a).join(b);
  console.log('OK(' + n + ')');
}
fs.writeFileSync('server.js', c);
console.log('done');
