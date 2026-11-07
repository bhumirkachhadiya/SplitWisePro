const fs = require('fs');
const p = 'scripts/_audit/test-browser-settle-load.js';
let c = fs.readFileSync(p, 'utf8');
c = c.split("  console.log('DEBUG currentUpiRequestId:', await cdp.evaluate('currentUpiRequestId'));\n").join('');
c = c.split("  console.log('DEBUG handler source:', await cdp.evaluate('window.handleQrPaymentAutoSettlement.toString().slice(0,120)'));\n").join('');
c = c.split("  const claimedState = await api('GET', '/api/upi/pending-requests', alexT);\n  console.log('DEBUG pending after claim:', JSON.stringify((claimedState.data || []).map(r => ({ id: r.request_id, payer: r.payer_id, receiver: r.receiver_id, claimed: r.claimed_at, status: r.status }))));\n  console.log('DEBUG button disabled:', await cdp.evaluate(`document.getElementById('btnAutoQrSettle').disabled`));\n").join('');
c = c.replace("    await cl.query('DELETE FROM upi_payment_requests WHERE group_id=$1', [gid]);", "    await cl.query('DELETE FROM upi_payment_requests WHERE group_id=$1 OR payer_id=$2 OR receiver_id=$2', [gid, peerId]);");
fs.writeFileSync(p, c);
console.log('cleaned settle test');
