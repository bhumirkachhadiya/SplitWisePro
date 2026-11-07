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
  await c.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 15000);
  await new Promise(r => setTimeout(r, 2500));

  c.errors.length = 0;
  c.network.length = 0;
  await c.evaluate(`navigateTo('friends')`);
  await new Promise(r => setTimeout(r, 3500));
  const state = await c.evaluate(`(() => {
    const v = document.getElementById('view-friends');
    const grid = document.getElementById('friendsListGrid');
    return {
      viewHidden: v ? v.classList.contains('hidden') : 'missing',
      text: v ? v.innerText.replace(/\\s+/g,' ').slice(0, 400) : '',
      gridChildren: grid ? grid.children.length : -1,
      gridHtml: grid ? grid.innerHTML.slice(0, 300) : '',
      globalLoading: document.getElementById('globalProcessingOverlay') ? !document.getElementById('globalProcessingOverlay').classList.contains('hidden') : false
    };
  })()`);
  console.log('STATE:', JSON.stringify(state, null, 1));
  console.log('ERRORS:', c.errors.slice(0, 8));
  console.log('FAILED NETWORK:', c.network.slice(0, 10));

  // Also test direct hash load
  c.errors.length = 0; c.network.length = 0;
  await c.goto(BASE + '/#friends');
  await new Promise(r => setTimeout(r, 4000));
  const hashState = await c.evaluate(`(() => { const v = document.getElementById('view-friends'); const g = document.getElementById('friendsListGrid'); return { hash: location.hash, viewHidden: v && v.classList.contains('hidden'), text: v ? v.innerText.replace(/\\s+/g,' ').slice(0,250) : '', gridChildren: g ? g.children.length : -1 }; })()`);
  console.log('HASH STATE:', JSON.stringify(hashState, null, 1));
  console.log('HASH ERRORS:', c.errors.slice(0, 8));
  console.log('HASH FAILED NETWORK:', c.network.slice(0, 10));
  c.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
