const fs = require('fs');
const p = 'scripts/_audit/test-browser-settle-load.js';
let c = fs.readFileSync(p, 'utf8');
const before = 'openSettleForPeer(\\${peerId},';
const after = 'openSettleForPeer(${peerId},';
if (!c.includes(before)) { console.error('pattern missing'); process.exit(1); }
c = c.split(before).join(after);
fs.writeFileSync(p, c);
console.log('fixed interpolation');
