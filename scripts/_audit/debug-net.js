const { openPage } = require('./cdp-lib');
(async () => {
  const c = await openPage('http://127.0.0.1:5000/');
  await c.waitFor('document.readyState === "complete"');
  await new Promise(r => setTimeout(r, 800));
  await c.evaluate(`(() => { document.getElementById('authEmail').value='alex'; document.getElementById('authPassword').value='password123'; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  await c.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 15000);
  await new Promise(r => setTimeout(r, 4000));
  console.log('401s:', JSON.stringify(c.network.filter(n => n.status === 401), null, 1));
  console.log('non-2xx:', JSON.stringify(c.network.slice(0, 20), null, 1).slice(0, 2000));
  c.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
