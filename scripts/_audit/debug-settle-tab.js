const { openPage } = require('./cdp-lib');
const BASE = 'http://127.0.0.1:5000';
(async () => {
  const c = await openPage(BASE + '/');
  await c.waitFor('document.readyState === "complete"');
  await new Promise(r => setTimeout(r, 1200));
  console.log(await c.evaluate(`(() => {
    const t = document.getElementById('tabContentOwe');
    const settle = document.getElementById('view-settle');
    return {
      tabExists: !!t,
      tabHtml: t ? t.innerHTML.slice(0, 500) : null,
      tabParent: t && t.parentElement ? t.parentElement.className : null,
      settleLen: settle ? settle.innerHTML.length : 0,
      firstDivs: settle ? Array.from(settle.querySelectorAll('div[id]')).map(d => d.id).slice(0, 20) : []
    };
  })()`));
  c.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
