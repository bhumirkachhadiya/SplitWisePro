const { openPage } = require('./cdp-lib');
(async () => {
  const c = await openPage('http://127.0.0.1:5000/');
  await c.waitFor('document.readyState === "complete"');
  await new Promise(r => setTimeout(r, 800));
  await c.evaluate(`(() => {
    window.__reqTimes = [];
    window.__setAt = null;
    const origSet = window.__splitwiseSetSession;
    window.__splitwiseSetSession = function(t,u){ window.__setAt = performance.now(); return origSet(t,u); };
    const origFetch = window.fetch;
    window.fetch = function(input, init){
      window.__reqTimes.push({ url: String(input), t: performance.now(), hasTok: !!window.__splitwiseGetToken() });
      return origFetch(input, init);
    };
  })()`);
  await c.evaluate(`(() => { document.getElementById('authEmail').value='alex'; document.getElementById('authPassword').value='password123'; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  await c.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 15000);
  await new Promise(r => setTimeout(r, 3500));
  const log = await c.evaluate(`({ setAt: window.__setAt, reqs: window.__reqTimes.filter(r => r.url.indexOf('/api/') !== -1).slice(0, 20) })`);
  console.log(JSON.stringify(log, null, 1));
  c.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
