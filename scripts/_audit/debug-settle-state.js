const { openPage } = require('./cdp-lib');
const BASE = 'http://127.0.0.1:5000';
(async () => {
  const c = await openPage(BASE + '/');
  await c.waitFor('document.readyState === "complete"');
  await c.send('Network.clearBrowserCookies');
  await c.evaluate('localStorage.clear(); sessionStorage.clear();');
  await c.goto(BASE + '/');
  await new Promise(r => setTimeout(r, 800));
  await c.evaluate(`(() => { document.getElementById('authEmail').value='alex'; document.getElementById('authPassword').value='password123'; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  await c.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 20000);
  await new Promise(r => setTimeout(r, 3000));
  await c.goto(BASE + '/#settle');
  await new Promise(r => setTimeout(r, 3500));
  console.log('state:', await c.evaluate(`({
    user: currentUser && currentUser.id,
    allUsers: allUsers && allUsers.length,
    allGroups: allGroups && allGroups.length,
    summary: balanceSummary && Object.keys(balanceSummary),
    peers: document.getElementById('settlePeerCardsContainer') ? document.getElementById('settlePeerCardsContainer').children.length : -1,
    errors: window.__errors || null
  })`));
  console.log('console errors:', c.errors.slice(0, 5));
  const manual = await c.evaluate(`(() => { try { renderSettleUp(); } catch(e) { return 'ERR ' + e.stack; } return 'ok'; })()`);
  await new Promise(r => setTimeout(r, 800));
  console.log('manual:', manual, await c.evaluate(`({ peers: document.getElementById('settlePeerCardsContainer').children.length })`));
  c.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
