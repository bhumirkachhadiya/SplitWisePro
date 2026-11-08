const fs = require('fs');
const p = 'scripts/_audit/test-browser-mark-paid.js';
let c = fs.readFileSync(p, 'utf8');

let a = `  check('debtor sees Awaiting receiver, not Accepted', /Awaiting receiver/i.test(sentPanel.text), sentPanel.text);
  await cdp.screenshot(path.join(SHOT_DIR, 'mark-paid-sent-tab.png'));`;
let b = `  check('debtor sees Awaiting receiver, not Accepted', /Awaiting receiver/i.test(sentPanel.text), sentPanel.text);
  await cdp.screenshot(path.join(SHOT_DIR, 'mark-paid-sent-tab.png'));

  await cdp.goto(BASE + '/#settle');
  await new Promise(r => setTimeout(r, 4000));
  await cdp.evaluate(\`setPaymentRequestTab('sent')\`);
  await new Promise(r => setTimeout(r, 500));
  const refreshedSent = await cdp.evaluate(\`({ count: document.getElementById('prCountSent').innerText, text: document.getElementById('paymentRequestsList').innerText.replace(/\\\\s+/g,' ').slice(0,160) })\`);
  check('pending sent request survives a page refresh', refreshedSent.count === '1' && /Pending approval/i.test(refreshedSent.text), JSON.stringify(refreshedSent));`;
if (!c.includes(a)) { console.error('debtor anchor missing'); process.exit(1); }
c = c.replace(a, b);

a = `  check('receiver sees payer, amount, method and expense detail', rxPanel.text.includes('200.00') && /Browser Debtor/i.test(rxPanel.text) && /CASH|Cash/i.test(rxPanel.text) && rxPanel.text.includes(desc), rxPanel.text);`;
b = a + `

  await cdp.goto(BASE + '/#settle');
  await new Promise(r => setTimeout(r, 4000));
  const refreshedReceived = await cdp.evaluate(\`({ count: document.getElementById('prCountReceived').innerText, text: document.getElementById('paymentRequestsList').innerText.replace(/\\\\s+/g,' ').slice(0,160) })\`);
  check('pending received request survives a page refresh', refreshedReceived.count === '1' && /Browser Debtor/i.test(refreshedReceived.text), JSON.stringify(refreshedReceived));`;
if (!c.includes(a)) { console.error('receiver anchor missing'); process.exit(1); }
c = c.replace(a, b);

fs.writeFileSync(p, c);
console.log('added refresh checks');
