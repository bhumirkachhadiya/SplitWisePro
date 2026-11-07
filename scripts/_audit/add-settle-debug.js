const fs = require('fs');
const p = 'scripts/_audit/test-browser-settle-load.js';
let c = fs.readFileSync(p, 'utf8');
const needle = "  check('loading the page creates no payment request',";
const add = "  console.log('DEBUG after load requests:', JSON.stringify((pendingAfterLoad.data || []).map(r => ({ id: r.request_id, payer: r.payer_id, receiver: r.receiver_id, amount: r.amount, group: r.group_id, created: r.created_at, claimed: r.claimed_at }))));\n" + needle;
if (!c.includes(needle)) { console.error('missing'); process.exit(1); }
c = c.replace(needle, add);
fs.writeFileSync(p, c);
console.log('debug added');
