const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');
const reps = [
  // group create
  ["        const groupName = name || title;\n        if (!groupName || groupName.trim() === '') {",
   "        const groupName = sanitizeText(name || title, 200);\n        if (!groupName) {"],
  // events create
  ["        const groupName = (title || name || 'New Group').trim();",
   "        const groupName = sanitizeText(title || name || 'New Group', 200);"],
  // group update
  ["        const groupName = (name || title || '').trim();",
   "        const groupName = sanitizeText(name || title, 200);"],
  // expense create
  ["        const expDesc = (description || req.body.title || '').trim();",
   "        const expDesc = sanitizeText(description || req.body.title, 255);"],
  // expense update
  ["        const expDesc = (description || title || '').trim();",
   "        const expDesc = sanitizeText(description || title, 255);"],
  // expense insert values
  ["[effectiveGroupId, paid_by, totalAmount, expCurrency, expDesc, category, effectiveSplitType, notes, receipt_url, expense_date, originalAmount, exchangeRate, convertedAmount, rateProvider, rateTimestamp]",
   "[effectiveGroupId, paid_by, totalAmount, expCurrency, expDesc, sanitizeText(category, 50) || 'General', effectiveSplitType, sanitizeText(notes, 2000), sanitizeText(receipt_url, 1000), expense_date, originalAmount, exchangeRate, convertedAmount, rateProvider, rateTimestamp]"],
  // expense update values
  ["[expDesc, totalAmount, paid_by || existingExp.paid_by, category || existingExp.category, effectiveSplitType, notes, expense_date || null, expCurrency, originalAmount, exchangeRate, convertedAmount, rateProvider, rateTimestamp, expenseId]",
   "[expDesc, totalAmount, paid_by || existingExp.paid_by, sanitizeText(category || existingExp.category, 50) || 'General', effectiveSplitType, sanitizeText(notes, 2000), expense_date || null, expCurrency, originalAmount, exchangeRate, convertedAmount, rateProvider, rateTimestamp, expenseId]"],
  // correction
  ["        const nextDesc = (new_description || prevDesc).trim();",
   "        const nextDesc = sanitizeText(new_description || prevDesc, 255);\n        const safeReason = sanitizeText(reason, 500);"],
  ["`, [nextAmount, totalBase, nextDesc, reason.trim(), expenseId]);",
   "`, [nextAmount, totalBase, nextDesc, safeReason, expenseId]);"],
  ["`, [expenseId, requesterId, prevAmount, nextAmount, prevDesc, nextDesc, reason.trim()]);",
   "`, [expenseId, requesterId, prevAmount, nextAmount, prevDesc, nextDesc, safeReason]);"],
  ["nextAmount.toFixed(2), reason.trim()]);",
   "nextAmount.toFixed(2), safeReason]);"],
  // user profile name
  ["            name.trim(), \n            email.trim().toLowerCase(), ",
   "            sanitizeText(name, 150), \n            email.trim().toLowerCase(), "],
  // AI group name
  ["            const groupName = (params.name || 'New Group').trim();",
   "            const groupName = sanitizeText(params.name || 'New Group', 200);"],
  // AI expense description
  ["            const expDesc = description || 'Expense';",
   "            const expDesc = sanitizeText(description || 'Expense', 255);"],
  // settlement notes
  ["[effectiveGroupId, pId, rId, applied.appliedTotal, payment_method, ref, notes || '']",
   "[effectiveGroupId, pId, rId, applied.appliedTotal, payment_method, ref, sanitizeText(notes, 1000) || '']"]
];
let missed = 0;
for (const [a, b] of reps) {
  const n = c.split(a).length - 1;
  if (n === 0) { console.error('MISS: ' + a.slice(0, 90).replace(/\n/g, '\\n')); missed++; continue; }
  c = c.split(a).join(b);
  console.log('OK(' + n + ') ' + a.slice(0, 60).replace(/\n/g, '\\n'));
}
if (missed) { console.error(missed + ' misses'); process.exit(1); }
fs.writeFileSync('server.js', c);
console.log('done');
