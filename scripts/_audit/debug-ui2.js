const { openPage } = require('./cdp-lib');
(async () => {
  const cdp = await openPage('http://127.0.0.1:5000/');
  await cdp.waitFor('document.readyState === "complete"');
  await new Promise(r => setTimeout(r, 1000));
  await cdp.evaluate(`(() => { document.getElementById('authEmail').value='alex'; document.getElementById('authPassword').value='password123'; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  await cdp.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 15000);
  await new Promise(r => setTimeout(r, 5000));
  console.log(await cdp.evaluate(`(() => ({
    token: (window.__splitwiseGetToken()||'').slice(0,10),
    user: currentUser && currentUser.name,
    summary: typeof balanceSummary === 'object' ? balanceSummary : String(balanceSummary),
    net: document.getElementById('dashStatNet').innerText,
    dupes: document.querySelectorAll('#dashStatNet').length,
    activeView: (document.querySelector('.view-panel:not(.hidden)')||{}).id
  }))()`));
  console.log('errors:', cdp.errors.slice(0, 10));
  console.log('console:', cdp.console.filter(c=>c.type==='error').slice(0,10));
  cdp.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
