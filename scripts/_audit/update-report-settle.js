const fs = require('fs');
const p = 'docs/SPLITWISE_FINAL_AUDIT_REPORT.md';
let c = fs.readFileSync(p, 'utf8');
c = c.replace('| API / integration / security tests | 135 | 135 | 0 |', '| API / integration / security tests | 135 | 135 | 0 |');
c = c.replace('| Real-browser E2E tests (Chrome DevTools Protocol) | 88 | 88 | 0 |', '| Real-browser E2E tests (Chrome DevTools Protocol) | 102 | 102 | 0 |');
c = c.replace('| **Total automated checks** | **223** | **223** | **0** |', '| **Total automated checks** | **237** | **237** | **0** |');
c = c.replace('0 errors across 88 E2E checks', '0 errors across 102 E2E checks');
c = c.replace('223 automated checks passed', '237 automated checks passed');
c = c.replace('39 bugs fixed', '43 bugs fixed');

const anchor = '| B-39 | Group expenses |';
const row = c.indexOf(anchor);
if (row === -1) { console.error('B-39 anchor missing'); process.exit(1); }
const endOfLine = c.indexOf('\n', row);
const additions = `
| B-40 | Settlement | Opening \`/#settle\` auto-selected the top debtor (Rahul – ₹601) and silently created UPI payment requests, producing duplicate “Awaiting Confirmation” rows with no user action | \`renderSettleUp()\` auto-called \`openSettleForPeer\`; \`setPaymentMethod('UPI')\` auto-called \`initUpiPaymentRequest()\`; no dedupe | Critical | No auto peer/amount; explicit **Generate Payment QR**; no implicit request; identical requests reused; own unclaimed QR hidden; stale requests expired | 14/14 settle E2E |
| B-41 | Navigation / DOM | Dashboard overwrote the settle view’s \`tabContentOwe\` / \`tabContentOwed\`, deleting the peer list and cross-writing dashboard lists into the settle page | Duplicate element IDs used by \`renderDashboard()\` | High | Removed the dashboard writes; settle owns its containers; counts updated in \`renderSettleUp()\` | 27/27 main + 14/14 settle |
| B-42 | Settlement | “I Have Paid” did nothing; the claim never reached the API | Early self-referencing \`window.handleQrPaymentAutoSettlement\` wrapper overwrote the real implementation | Critical | Removed the wrapper; bound the real async handler; claim and inbox verified | 14/14 settle E2E |
| B-43 | Settlement UX | “You Owe” listed every peer as “Settled up”; “Owes You” was never populated | \`renderSettleUp()\` rendered \`allUsers\`; \`settleOwedCardsContainer\` had no renderer | Medium | “You Owe” shows only actual debts; “Owes You” lists receivables with Remind/email actions; empty states added | 14/14 settle E2E + screenshot |`;
c = c.slice(0, endOfLine) + additions + c.slice(endOfLine);

c = c.replace(
  '- Deep links such as `/#friends` now open the requested view instead of being reset to the dashboard.',
  '- Deep links such as `/#friends` now open the requested view instead of being reset to the dashboard.\n- `/#settle` is neutral on load: no peer, amount, QR, or payment request is created until you explicitly choose a peer and press **Generate Payment QR**. “Awaiting Confirmation” only appears after you press **I Have Paid**.'
);
c = c.replace(
  '- Group expense totals now reconcile: payer share is counted once, and a partially paid member is shown as **◐ Paid ₹X** instead of a misleading “Pending”. New expenses correctly show the payer as Paid and every other participant as Pending.',
  '- Group expense totals now reconcile: payer share is counted once, and a partially paid member is shown as **◐ Paid ₹X** instead of a misleading “Pending”. New expenses correctly show the payer as Paid and every other participant as Pending.\n- Settle tabs are accurate: “You Owe” shows only people you actually owe; “Owes You” shows real receivables with Remind and email actions.'
);
fs.writeFileSync(p, c);
console.log('report updated');
