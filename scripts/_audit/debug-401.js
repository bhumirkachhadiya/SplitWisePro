const { openPage } = require('./cdp-lib');
(async () => {
  const c = await openPage('http://127.0.0.1:5000/');
  await c.waitFor('document.readyState === "complete"');
  await new Promise(r => setTimeout(r, 800));
  await c.evaluate(`(() => { document.getElementById('authEmail').value='alex'; document.getElementById('authPassword').value='password123'; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  await c.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 15000);
  await new Promise(r => setTimeout(r, 4000));
  for (const n of c.network) {
    let body = '';
    try { const b = await c.send('Network.getResponseBody', { requestId: n.requestId }); body = (b.body || '').slice(0, 200); } catch (e) { body = 'body-unavailable'; }
    const req = c.requests.get(n.requestId);
    console.log(JSON.stringify({ status: n.status, url: n.url, cache: n.fromDiskCache, sw: n.fromServiceWorker, auth: req && req.headers && (req.headers.Authorization || req.headers.authorization || 'NONE'), body }, null, 1));
  }
  c.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
