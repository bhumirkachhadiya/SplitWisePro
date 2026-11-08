const fs = require('fs');
const p = 'docs/SPLITWISE_FINAL_AUDIT_REPORT.md';
let c = fs.readFileSync(p, 'utf8');

c = c.replace('| API / integration / security tests | 135 | 135 | 0 |', '| API / integration / security tests | 169 | 169 | 0 |');
c = c.replace('| Real-browser E2E tests (Chrome DevTools Protocol) | 102 | 102 | 0 |', '| Real-browser E2E tests (Chrome DevTools Protocol) | 125 | 125 | 0 |');
c = c.replace('| **Total automated checks** | **237** | **237** | **0** |', '| **Total automated checks** | **294** | **294** | **0** |');
c = c.replace('0 errors across 102 E2E checks', '0 errors across 125 E2E checks');
c = c.replace('| Browser console | 0 errors across 102 E2E checks |', '| Browser console | 0 errors across 125 E2E checks |');
c = c.replace('| API | 125/125 checks passed |', '| API | 169/169 checks passed |');
c = c.replace('**Totals:** 16 modules, 87 APIs, 30 base tables + 2 views, 237 automated checks passed, 0 failed in the final regression. 43 bugs fixed. 10 limitations documented.',
  '**Totals:** 16 modules, 92 APIs, 31 base tables + 2 views, 294 automated checks passed, 0 failed in the final regression. 43 bugs fixed. 10 limitations documented.');

c = c.replace('- New: `user_sessions`, `expense_splits.settled_amount`, `.base_amount`, `.settled_amount_base`, `upi_payment_requests.claimed_at/.claimed_utr/.confirmed_by`, integrity constraints, backups.',
  '- New: `user_sessions`, `payment_requests` (manual Mark as Paid / receiver-confirmed settlement workflow), `expense_splits.settled_amount`, `.base_amount`, `.settled_amount_base`, `upi_payment_requests.claimed_at/.claimed_utr/.confirmed_by`, integrity constraints, backups.');

const feature = `
---

## 17. Delivered feature — Mark as Paid & payment confirmation requests

### What was built

A debtor can now claim an external payment (cash, UPI, bank transfer, other) against a specific expense or their overall outstanding balance. The request is only a claim; the ledger changes **only when the actual receiver accepts**.

- **Schema:** \`payment_requests\` — payer, receiver, group, expense, amount, currency, method, transaction reference, note, status (\`PENDING/ACCEPTED/REJECTED/CANCELLED\`), \`verification_source='RECEIVER_CONFIRMED'\`, settlement link, timestamps, responder, rejection reason, idempotency key, expense description/date snapshots.
- **Constraints:** one pending request per payer/receiver/expense; unique idempotency key; overpayment rejected against the live base-currency outstanding balance; locked circles blocked; accepted UTR cannot be reused.
- **API:**
  - \`POST /api/payment-requests\` — debtor creates an expense-wise or balance-wise request (partial allowed).
  - \`GET /api/payment-requests\` — received/sent/history with counts.
  - \`POST /api/payment-requests/:id/accept\` — receiver only; applies the exact amount FIFO or to the linked expense, creates one settlement, updates the split/ledger atomically.
  - \`POST /api/payment-requests/:id/reject\` — receiver only; no ledger change.
  - \`POST /api/payment-requests/:id/cancel\` — payer only while pending.
- **Notifications:** in-app activity entries for both users on send, accept and reject; a live count on the **Settle Up** sidebar badge and the **Pending Received** tab.
- **UI:** Mark Paid buttons on the Ledger expense rows, inside the group-expense split table, and on the settlement screen; a **Mark as Paid** modal with amount/method/reference/note; tabs for **Pending Received**, **Sent Requests**, and **Payment History**.
- **Manual vs online:** every request is labelled **Manual confirmation · receiver-confirmed** and stored with \`gateway_verified=false\`. It is never presented as UPI/gateway-verified; the separate online UPI confirmation inbox remains unchanged.

### Business rules verified

- Only the debtor can create the request; only the receiver can accept/reject.
- No ledger mutation while pending or after rejection.
- Acceptance settles the exact amount, partially or fully, and is idempotent.
- Duplicate pending requests, duplicate acceptance, duplicate UTR and concurrent acceptance are blocked.
- Deleting an expense cancels its pending request and keeps the expense snapshot in history.
- Locked circles block new requests and acceptance until unlocked.
- Group permissions and membership are rechecked at creation and acceptance.

### Test evidence

- API workflow: **34/34** (\`scripts/_audit/test-payment-requests.js\`).
- Browser debtor/receiver workflow: **23/23** (\`scripts/_audit/test-browser-mark-paid.js\`).
- Screenshots: \`scripts/_audit/shots/mark-paid-modal.png\`, \`mark-paid-sent-tab.png\`, \`mark-paid-received-tab.png\`, \`mark-paid-history.png\`.

---
`;

const marker = '\n---\n\n*End of report.*';
if (!c.includes(marker)) { console.error('end marker missing'); process.exit(1); }
c = c.replace(marker, '\n' + feature + '\n*End of report.*');
fs.writeFileSync(p, c);
console.log('report updated with feature');
