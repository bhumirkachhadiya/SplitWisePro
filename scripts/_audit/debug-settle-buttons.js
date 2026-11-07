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
    const btns = Array.from(document.querySelectorAll('#settlePeerCardsContainer button'));
    return { count: btns.length, labels: btns.map(b=>b.innerText.replace(/\\s+/g,' ').slice(0,50)), onclicks: btns.map(b=>b.getAttribute('onclick')) };
  })()`));
  c.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
