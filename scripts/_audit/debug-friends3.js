const { openPage } = require('./cdp-lib');
const BASE = 'http://127.0.0.1:5000';
(async () => {
  const c = await openPage(BASE + '/');
  await c.waitFor('document.readyState === "complete"');
  await c.send('Network.clearBrowserCookies');
  await c.evaluate('localStorage.clear(); sessionStorage.clear();');
  await c.goto(BASE + '/');
  await new Promise(r => setTimeout(r, 800));
  await c.evaluate(`(() => {
    window.__friendLogs = [];
    const orig = window.fetch;
    window.fetch = async function(input, init) {
      const res = await orig(input, init);
      if (String(input).indexOf('/api/friends') !== -1) {
        try { window.__friendLogs.push({ url: String(input), status: res.status, body: (await res.clone().text()).slice(0, 180) }); } catch(e) {}
      }
      return res;
    };
  })()`);
  await c.evaluate(`(() => { document.getElementById('authEmail').value='alex'; document.getElementById('authPassword').value='password123'; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  await c.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 15000);
  await new Promise(r => setTimeout(r, 4000));
  console.log(JSON.stringify(await c.evaluate('window.__friendLogs'), null, 1));
  console.log('myFriends len', await c.evaluate('myFriends.length'));
  c.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
