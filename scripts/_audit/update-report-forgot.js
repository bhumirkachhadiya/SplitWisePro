const fs = require('fs');
const p = 'docs/SPLITWISE_FINAL_AUDIT_REPORT.md';
let c = fs.readFileSync(p, 'utf8');
c = c.replace('| Real-browser E2E tests (Chrome DevTools Protocol) | 127 | 127 | 0 |', '| Real-browser E2E tests (Chrome DevTools Protocol) | 134 | 134 | 0 |');
c = c.replace('| **Total automated checks** | **299** | **299** | **0** |', '| **Total automated checks** | **306** | **306** | **0** |');
c = c.replace('0 errors across 127 E2E checks', '0 errors across 134 E2E checks');
c = c.replace('| Browser console | 0 errors across 127 E2E checks |', '| Browser console | 0 errors across 134 E2E checks |');
c = c.replace('299 automated checks passed', '306 automated checks passed');
c = c.replace('43 bugs fixed', '44 bugs fixed');

const anchor = '| B-43 | Settlement UX |';
const start = c.indexOf(anchor);
if (start === -1) { console.error('B-43 missing'); process.exit(1); }
const eol = c.indexOf('\n', start);
const row = `\n| B-44 | Auth | “Forgot password” stayed on “Sending Code…” indefinitely and ignored API errors | Endpoint awaited SMTP retries (Gmail 550 daily limit); frontend advanced regardless of \`res.ok\` | High | OTP send is non-blocking; resend is non-blocking; frontend shows API errors and only advances on success | 7/7 forgot-password E2E (email → OTP → new password → login) |`;
c = c.slice(0, eol) + row + c.slice(eol);

c = c.replace(
  '- `/#settle` is neutral on load:',
  '- “Forgot password” now responds immediately (SMTP delivery is queued) and shows a real error instead of an endless spinner; the full email → OTP → new-password → login flow is covered by a browser test.\n- `/#settle` is neutral on load:'
);
fs.writeFileSync(p, c);
console.log('report updated for forgot-password fix');
