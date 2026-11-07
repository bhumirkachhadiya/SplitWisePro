const { openPage } = require('./cdp-lib');
(async () => {
  const cdp = await openPage('http://127.0.0.1:5000/');
  await cdp.waitFor('document.readyState === "complete"');
  await new Promise(r => setTimeout(r, 800));
  await cdp.evaluate(`(() => { document.getElementById('authEmail').value='alex'; document.getElementById('authPassword').value='password123'; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  await cdp.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 15000);
  await new Promise(r => setTimeout(r, 3000));
  console.log(await cdp.evaluate(`(async () => {
    const r = await fetch(API + '/expenses?userId=' + currentUser.id);
    const t = await r.text();
    return { status: r.status, first: t.slice(0,80), isArray: t.trim().startsWith('['), allExpensesType: Object.prototype.toString.call(allExpenses), len: allExpenses && allExpenses.length };
  })()`));
  cdp.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
