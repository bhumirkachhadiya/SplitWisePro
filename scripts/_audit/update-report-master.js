const fs = require('fs');
const p = 'docs/SPLITWISE_FINAL_AUDIT_REPORT.md';
let c = fs.readFileSync(p, 'utf8');
c = c.replace('| Real-browser E2E tests (Chrome DevTools Protocol) | 63 | 63 | 0 |', '| Real-browser E2E tests (Chrome DevTools Protocol) | 67 | 67 | 0 |');
c = c.replace('| **Total automated checks** | **179** | **179** | **0** |', '| **Total automated checks** | **183** | **183** | **0** |');
c = c.replace('0 errors across 63 E2E checks', '0 errors across 67 E2E checks');
c = c.replace('179 automated checks passed', '183 automated checks passed');
c = c.replace(
  '**Evidence:** `alex` and `rahul` both authenticate with `SplitWiseMaster@2026` (`200`, correct user IDs), audit rows increase by one per login, a wrong shared password returns `400`, and a child process with `NODE_ENV=production` reports `isMasterPasswordAllowed() = false`.',
  '**Evidence:** `alex` and `rahul` both authenticate with `SplitWiseMaster@2026` (`200`, correct user IDs); the real browser UI logs in as Rahul (id 2) with it and renders the workspace; every login adds exactly one audit row; a wrong shared password returns `400`; and a child process with `NODE_ENV=production` reports `isMasterPasswordAllowed() = false`.'
);
fs.writeFileSync(p, c);
console.log('report counts and evidence updated');
