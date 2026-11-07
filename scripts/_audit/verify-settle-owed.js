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
  await c.goto(BASE + '/#settle');
  await new Promise(r => setTimeout(r, 3500));
  c.errors.length = 0;
  await c.evaluate(`switchSettleTab('owed')`);
  await new Promise(r => setTimeout(r, 500));
  const owed = await c.evaluate(`(() => ({
    visible: !document.getElementById('tabContentOwed').classList.contains('hidden'),
    oweHidden: document.getElementById('tabContentOwe').classList.contains('hidden'),
    cards: document.getElementById('settleOwedCardsContainer').children.length,
    count: document.getElementById('countOwesYou').innerText,
    text: document.getElementById('settleOwedCardsContainer').innerText.replace(/\\s+/g,' ').slice(0,160)
  }))()`);
  console.log(owed, 'errors:', c.errors.slice(0,3));
  await c.screenshot(path.join(__dirname, 'shots', 'settle-owed-tab.png'));
  c.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
