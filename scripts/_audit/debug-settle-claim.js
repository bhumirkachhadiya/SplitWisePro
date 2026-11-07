const fs = require('fs');
const p = 'scripts/_audit/test-browser-settle-load.js';
let c = fs.readFileSync(p, 'utf8');
const needle = `  const claimed = await cdp.evaluate(\`(() => ({
    pendingVisible: !document.getElementById('pendingPaymentsPanel').classList.contains('hidden'),
    text: document.getElementById('pendingPaymentsList').innerText.replace(/\\\\s+/g,' ').slice(0,160)
  }))()\`);`;
const add = `  const claimedState = await api('GET', '/api/upi/pending-requests', alexT);
  console.log('DEBUG pending after claim:', JSON.stringify((claimedState.data || []).map(r => ({ id: r.request_id, payer: r.payer_id, receiver: r.receiver_id, claimed: r.claimed_at, status: r.status }))));
  console.log('DEBUG button disabled:', await cdp.evaluate(\`document.getElementById('btnAutoQrSettle').disabled\`));
  const claimed = await cdp.evaluate(\`(() => ({
    pendingVisible: !document.getElementById('pendingPaymentsPanel').classList.contains('hidden'),
    text: document.getElementById('pendingPaymentsList').innerText.replace(/\\\\s+/g,' ').slice(0,160)
  }))()\`);`;
if (!c.includes(needle)) { console.error('needle missing'); process.exit(1); }
c = c.replace(needle, add);
fs.writeFileSync(p, c);
console.log('added debug');
