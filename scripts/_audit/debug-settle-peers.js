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
  await new Promise(r => setTimeout(r, 2500));
  await c.goto(BASE + '/#settle');
  await new Promise(r => setTimeout(r, 3500));
  console.log(await c.evaluate(`(() => {
    const cont = document.getElementById('settlePeerCardsContainer');
    const btns = Array.from(cont.querySelectorAll('button'));
    return {
      count: btns.length,
      labels: btns.map(b => b.innerText.replace(/\\s+/g,' ').slice(0,60)),
      onclicks: btns.slice(0,6).map(b => b.getAttribute('onclick')),
      html: cont.innerHTML.slice(0, 500),
      oweList: (balanceSummary.you_owe_list || []).map(x => ({ id: x.user_id, name: x.name, amt: x.amount }))
    };
  })()`));
  c.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
