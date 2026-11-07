const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');
const reps = [
  ['[pId, effectiveGroupId, pName, amt.toFixed(2), rName]', '[pId, effectiveGroupId, pName, applied.appliedTotal.toFixed(2), rName]'],
  ['message: `Settlement of ₹${amt.toFixed(2)} automatically recorded from UPI QR payment!`', 'message: `Settlement of ₹${applied.appliedTotal.toFixed(2)} automatically recorded from UPI QR payment!`'],
  ['                    amount: amt,\n                    paymentMethod: \'UPI_QR\',', '                    amount: applied.appliedTotal,\n                    paymentMethod: \'UPI_QR\','],
  ['                amount: amt,\n                payment_method: \'UPI_QR\'', '                amount: applied.appliedTotal,\n                payment_method: \'UPI_QR\'']
];
for (const [a, b] of reps) {
  const n = c.split(a).length - 1;
  if (n === 0) { console.error('MISS: ' + a.slice(0, 60)); process.exit(1); }
  c = c.split(a).join(b);
  console.log('OK(' + n + ') ' + a.slice(0, 50).replace(/\n/g, '\\n'));
}
fs.writeFileSync('server.js', c);
console.log('done');
