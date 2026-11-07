const fs = require('fs');
const p = 'scripts/_audit/test-browser-expense-status.js';
let c = fs.readFileSync(p, 'utf8');
const oldRead = `    text: document.getElementById('groupExpensesModalList').innerText.replace(/\\\\s+/g,' ')
  }))()\`);`;
const newRead = `    text: document.getElementById('groupExpensesModalList').innerText.replace(/\\\\s+/g,' '),
    statuses: Array.from(document.querySelectorAll('#groupExpensesModalList tbody tr')).map(tr => tr.children[2] ? tr.children[2].innerText.trim() : '')
  }))()\`);`;
if (!c.includes(oldRead)) { console.error('read block not found'); process.exit(1); }
c = c.replace(oldRead, newRead);
c = c.replace(
  "check('new expense shows payer Paid and others Pending', (before.text.match(/Paid/g) || []).length === 1 && (before.text.match(/Pending/g) || []).length === 2, before.text.slice(0, 200));",
  "check('new expense shows payer Paid and others Pending', before.statuses.filter(s => s === '✓ Paid').length === 1 && before.statuses.filter(s => s === 'Pending').length === 2, JSON.stringify(before.statuses));"
);
c = c.replace(
  "check('partially paid member is labelled Paid ₹200.00', /Paid ₹200\\.00/.test(after.text), after.text.slice(0, 240));",
  "check('partially paid member is labelled Paid ₹200.00', after.statuses.some(s => /Paid ₹200\\.00/.test(s)), JSON.stringify(after.statuses));"
);
fs.writeFileSync(p, c);
console.log('patched status assertions');
