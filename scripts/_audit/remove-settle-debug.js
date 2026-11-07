const fs = require('fs');
const p = 'scripts/_audit/test-browser-settle-load.js';
let c = fs.readFileSync(p, 'utf8');
c = c.split("  console.log('DEBUG after load requests:', JSON.stringify((pendingAfterLoad.data || []).map(r => ({ id: r.request_id, payer: r.payer_id, receiver: r.receiver_id, amount: r.amount, group: r.group_id, created: r.created_at, claimed: r.claimed_at }))));\n").join('');
fs.writeFileSync(p, c);
console.log('debug removed');
