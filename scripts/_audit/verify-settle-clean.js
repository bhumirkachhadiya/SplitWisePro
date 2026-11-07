const { openPage } = require('./cdp-lib');
const path = require('path');
const BASE = 'http://127.0.0.1:5000';
(async () => {
  const c = await openPage(BASE + '/');
  await c.waitFor('document.readyState === "complete"');
  await c.send('Network.clearBrowserCookies');
  await c.evaluate('localStorage.clear(); sessionStorage.clear();');
  await c.goto(BASE + '/');
  await new Promise(r => setTimeout(r, 900));
  await c.evaluate(`(() => { document.getElementById('authEmail').value='alex'; document.getElementById('authPassword').value='password123'; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  await c.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 20000);
  await new Promise(r => setTimeout(r, 2500));

  c.errors.length = 0;
  await c.goto(BASE + '/#settle');
  await new Promise(r => setTimeout(r, 4000));
  const state = await c.evaluate(`(() => ({
    receiver: document.getElementById('settleReceiverName').innerText,
    amount: document.getElementById('settleAmountInput').value,
    pendingVisible: !document.getElementById('pendingPaymentsPanel').classList.contains('hidden'),
    qrHidden: document.getElementById('upiQrCodeContainer').classList.contains('hidden'),
    peers: document.querySelectorAll('#settlePeerCardsContainer button').length,
    firstPeerText: (document.querySelector('#settlePeerCardsContainer button') || {innerText:''}).innerText.replace(/\\s+/g,' ').slice(0,80),
    status: document.getElementById('upiPollingStatusText').innerText
  }))()`);
  console.log(state);
  console.log('console errors:', c.errors.slice(0, 5));
  await c.screenshot(path.join(__dirname, 'shots', 'settle-clean-load.png'));
  c.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
