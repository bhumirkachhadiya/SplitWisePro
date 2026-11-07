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
  await c.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 15000);
  await new Promise(r => setTimeout(r, 3500));
  console.log(await c.evaluate(`({
    currentUser: currentUser && currentUser.id,
    windowCU: window.currentUser && window.currentUser.id,
    loadFriendsType: typeof loadFriendsData,
    allUsers: allUsers && allUsers.length,
    allGroups: allGroups && allGroups.length,
    allExpenses: allExpenses && allExpenses.length,
    balance: balanceSummary && balanceSummary.net_balance,
    grid: !!document.getElementById('friendsListGrid')
  })`));
  const r = await c.evaluate(`(async () => {
    const logs = [];
    try {
      const res = await fetch(API + '/friends?userId=' + currentUser.id);
      logs.push('manual fetch status ' + res.status + ' body ' + (await res.text()).slice(0,120));
    } catch(e) { logs.push('manual fetch err ' + e); }
    try { await loadFriendsData(); logs.push('loadFriendsData returned'); } catch(e) { logs.push('loadFriendsData err ' + e); }
    logs.push('myFriends=' + (myFriends && myFriends.length));
    return logs;
  })()`);
  console.log(r);
  console.log('errors:', c.errors.slice(0, 8));
  c.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
