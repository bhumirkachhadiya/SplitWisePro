const { openPage } = require('./cdp-lib');
const BASE = 'http://127.0.0.1:5000';
(async () => {
  const c = await openPage(BASE + '/');
  await c.waitFor('document.readyState === "complete"');
  await c.send('Network.clearBrowserCookies');
  await c.evaluate('localStorage.clear(); sessionStorage.clear();');
  await c.goto(BASE + '/');
  await new Promise(r => setTimeout(r, 800));
  await c.evaluate(`(() => { document.getElementById('authEmail').value='rahul'; document.getElementById('authPassword').value='password123'; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  await c.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 15000);
  await new Promise(r => setTimeout(r, 2500));
  console.log(await c.evaluate(`({
    container: !!document.getElementById('settlePeerCardsContainer'),
    panel: !!document.getElementById('pendingPaymentsPanel'),
    list: !!document.getElementById('pendingPaymentsList'),
    fn: typeof renderSettleUp,
    loadFn: typeof loadPendingPayments
  })`));
  console.log('direct load:', await c.evaluate(`(async()=>{ await loadPendingPayments(); const l=document.getElementById('pendingPaymentsList'); return { cls:document.getElementById('pendingPaymentsPanel').className, len:l.innerHTML.length }; })()`));
  console.log('render:', await c.evaluate(`(async()=>{ const l=document.getElementById('pendingPaymentsList'); l.innerHTML=''; document.getElementById('pendingPaymentsPanel').classList.add('hidden'); renderSettleUp(); await new Promise(r=>setTimeout(r,1500)); return { cls:document.getElementById('pendingPaymentsPanel').className, len:l.innerHTML.length }; })()`));
  c.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
