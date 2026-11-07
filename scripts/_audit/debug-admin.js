const { openPage } = require('./cdp-lib');
const BASE = 'http://127.0.0.1:5000';
async function login(cdp, id) {
  await cdp.evaluate(`(() => { document.getElementById('authEmail').value=${JSON.stringify(id)}; document.getElementById('authPassword').value='password123'; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  await cdp.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 15000);
  await new Promise(r => setTimeout(r, 2500));
}
(async () => {
  const c = await openPage(BASE + '/');
  await c.waitFor('document.readyState === "complete"');
  await c.send('Network.clearBrowserCookies');
  await c.evaluate('localStorage.clear(); sessionStorage.clear();');
  await c.goto(BASE + '/');
  await new Promise(r => setTimeout(r, 800));
  await login(c, 'alex');
  console.log('role:', await c.evaluate('currentUser && currentUser.role'), 'windowCU:', await c.evaluate('window.currentUser && window.currentUser.role'));
  const r = await c.evaluate(`(() => { try { navigateTo('master-admin'); } catch(e) { return String(e); } return { viewClasses: document.getElementById('view-master-admin').className, hiddenViews: Array.from(document.querySelectorAll('.view-panel')).filter(v=>!v.classList.contains('hidden')).map(v=>v.id) }; })()`);
  console.log('after navigate:', r);
  await new Promise(r => setTimeout(r, 1500));
  console.log('later:', await c.evaluate(`({ cls: document.getElementById('view-master-admin').className, visible: !document.getElementById('view-master-admin').classList.contains('hidden') })`));

  await c.send('Network.clearBrowserCookies');
  await c.evaluate('localStorage.clear(); sessionStorage.clear();');
  await c.goto(BASE + '/');
  await new Promise(r => setTimeout(r, 800));
  await login(c, 'rahul');
  console.log('rahul role:', await c.evaluate('currentUser && currentUser.role'));
  console.log('navGroup:', await c.evaluate(`(() => { const g=document.getElementById('navGroupMasterAdmin'); const n=document.getElementById('sidebarMasterAdminNav'); return { groupExists:!!g, groupClass:g&&g.className, linkExists:!!n, linkDisplay:n&&getComputedStyle(n).display, groupDisplay:g&&getComputedStyle(g).display }; })()`));
  c.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
