const fs = require('fs');
const p = 'index.html';
let c = fs.readFileSync(p, 'utf8');
const startMarker = '            const oweList = balanceSummary.you_owe_list || [];';
const endMarker = '            renderDashboardRecentList(allExpenses.slice(0, 5));';
const start = c.indexOf(startMarker);
const end = c.indexOf(endMarker);
if (start === -1 || end === -1 || end <= start) {
  console.error('markers missing', start, end);
  process.exit(1);
}
const replacement = `            // Dashboard summary cards are updated above. The detailed "You Owe"
            // and "Owes You" lists belong to the Settle view; do not overwrite
            // those containers from the dashboard (that used to delete the peer
            // selection list and prefill stale settle data).

`;
c = c.slice(0, start) + replacement + c.slice(end);
fs.writeFileSync(p, c);
console.log('removed dashboard collision block');
