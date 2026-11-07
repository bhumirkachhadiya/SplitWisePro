const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');
const reps = [
  // computeGroupNetForUser (2)
  ['THEN es.amount - es.settled_amount ELSE 0 END), 0)', 'THEN es.base_amount - es.settled_amount_base ELSE 0 END), 0)'],
  ['AND (es.amount - es.settled_amount) > 0.005\n    `, [groupId, userId]);', 'AND (es.base_amount - es.settled_amount_base) > 0.005\n    `, [groupId, userId]);'],
  // group balances
  ['SUM(es.amount - es.settled_amount) AS outstanding', 'SUM(es.base_amount - es.settled_amount_base) AS outstanding'],
  ['AND (es.amount - es.settled_amount) > 0.005\n            GROUP BY es.user_id, e.paid_by', 'AND (es.base_amount - es.settled_amount_base) > 0.005\n            GROUP BY es.user_id, e.paid_by'],
  // personal balances
  ['AND (es.amount - es.settled_amount) > 0.005\n        GROUP BY es.user_id, e.paid_by', 'AND (es.base_amount - es.settled_amount_base) > 0.005\n        GROUP BY es.user_id, e.paid_by'],
  // monthly personal spend (base)
  ['SELECT COALESCE(SUM(es.amount), 0) AS total\n        FROM expense_splits es\n        JOIN expenses e ON e.id = es.expense_id\n        WHERE es.user_id = $1\n          AND e.expense_date >= date_trunc', 'SELECT COALESCE(SUM(es.base_amount), 0) AS total\n        FROM expense_splits es\n        JOIN expenses e ON e.id = es.expense_id\n        WHERE es.user_id = $1\n          AND e.expense_date >= date_trunc'],
  // simplify debts
  ['SUM(es.amount - es.settled_amount) as amount\n            FROM expense_splits es\n            JOIN expenses e ON es.expense_id = e.id\n            WHERE es.user_id <> e.paid_by\n              AND (es.amount - es.settled_amount) > 0.005', 'SUM(es.base_amount - es.settled_amount_base) as amount\n            FROM expense_splits es\n            JOIN expenses e ON es.expense_id = e.id\n            WHERE es.user_id <> e.paid_by\n              AND (es.base_amount - es.settled_amount_base) > 0.005'],
  // UPI create outstanding
  ['SELECT COALESCE(SUM(es.amount - es.settled_amount), 0) AS outstanding\n            FROM expense_splits es\n            JOIN expenses e ON e.id = es.expense_id\n            WHERE es.user_id = $1 AND e.paid_by = $2 AND (es.amount - es.settled_amount) > 0.005', 'SELECT COALESCE(SUM(es.base_amount - es.settled_amount_base), 0) AS outstanding\n            FROM expense_splits es\n            JOIN expenses e ON e.id = es.expense_id\n            WHERE es.user_id = $1 AND e.paid_by = $2 AND (es.base_amount - es.settled_amount_base) > 0.005'],
  // UPI claim finder group
  ['WHERE es.user_id = $1 AND e.paid_by = $2 AND (es.amount - es.settled_amount) > 0.005\n                ORDER BY e.expense_date ASC\n                LIMIT 1', 'WHERE es.user_id = $1 AND e.paid_by = $2 AND (es.base_amount - es.settled_amount_base) > 0.005\n                ORDER BY e.expense_date ASC\n                LIMIT 1'],
  // group list total spend (base)
  ['COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.group_id = g.id), 0) as total_spend', 'COALESCE((SELECT SUM(COALESCE(e.converted_amount, e.amount)) FROM expenses e WHERE e.group_id = g.id), 0) as total_spend'],
  // group details spend
  ["'SELECT COALESCE(SUM(amount), 0) as total_spend FROM expenses WHERE group_id = $1'", "'SELECT COALESCE(SUM(COALESCE(converted_amount, amount)), 0) as total_spend FROM expenses WHERE group_id = $1'"],
  // analytics category (base)
  ['SELECT e.category, SUM(es.amount) as total_amount, COUNT(e.id) as count', 'SELECT e.category, SUM(es.base_amount) as total_amount, COUNT(e.id) as count'],
  // analytics monthly inner
  ['SUM(es.amount) AS your_spend,\n                       MAX(e.amount) AS group_spend', 'SUM(es.base_amount) AS your_spend,\n                       MAX(COALESCE(e.converted_amount, e.amount)) AS group_spend'],
  // analytics total share
  ['SELECT COALESCE(SUM(es.amount), 0) as total \n            FROM expense_splits es', 'SELECT COALESCE(SUM(es.base_amount), 0) as total \n            FROM expense_splits es']
];
for (const [a, b] of reps) {
  const n = c.split(a).length - 1;
  if (n === 0) { console.error('MISS: ' + a.slice(0, 80).replace(/\n/g, '\\n')); process.exit(1); }
  c = c.split(a).join(b);
  console.log('OK(' + n + ') ' + a.slice(0, 60).replace(/\n/g, '\\n'));
}
fs.writeFileSync('server.js', c);
console.log('done');
