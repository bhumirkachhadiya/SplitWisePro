const fs = require('fs');
const p = 'scripts/_audit/test-browser-settle-load.js';
let c = fs.readFileSync(p, 'utf8');
const needle = `  // Claim it (I have paid) -> now it belongs in the confirmation inbox.
  await cdp.evaluate(\`document.getElementById('btnAutoQrSettle').click()\`);`;
const repl = `  // Claim it (I have paid) -> now it belongs in the confirmation inbox.
  console.log('DEBUG currentUpiRequestId:', await cdp.evaluate('currentUpiRequestId'));
  console.log('DEBUG handler source:', await cdp.evaluate('window.handleQrPaymentAutoSettlement.toString().slice(0,120)'));
  await cdp.evaluate(\`handleQrPaymentAutoSettlement()\`);`;
if (!c.includes(needle)) { console.error('needle missing'); process.exit(1); }
c = c.replace(needle, repl);
fs.writeFileSync(p, c);
console.log('patched claim debug');
