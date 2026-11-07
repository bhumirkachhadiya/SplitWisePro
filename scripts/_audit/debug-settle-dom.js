const { openPage } = require('./cdp-lib');
const BASE = 'http://127.0.0.1:5000';
(async () => {
  const c = await openPage(BASE + '/');
  await c.waitFor('document.readyState === "complete"');
  await new Promise(r => setTimeout(r, 1200));
  console.log(await c.evaluate(`(() => {
    const view = document.getElementById('view-settle');
    return {
      view: !!view,
      peers: !!document.getElementById('settlePeerCardsContainer'),
      receiver: !!document.getElementById('settleReceiverName'),
      amount: !!document.getElementById('settleAmountInput'),
      htmlHasId: view ? view.innerHTML.includes('settlePeerCardsContainer') : false,
      allIds: document.querySelectorAll('[id="settlePeerCardsContainer"]').length,
      viewLen: view ? view.innerHTML.length : 0,
      viewStart: view ? view.innerHTML.slice(0, 300) : ''
    };
  })()`));
  c.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
