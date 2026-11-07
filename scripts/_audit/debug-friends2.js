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
  await new Promise(r => setTimeout(r, 3000));
  console.log('user:', await c.evaluate(`({id: currentUser && currentUser.id, name: currentUser && currentUser.name, token: !!window.__splitwiseGetToken()})`));
  const direct = await c.evaluate(`(async () => {
    const r = await fetch(API + '/friends?userId=' + currentUser.id);
    const t = await r.text();
    return { status: r.status, len: t.length, first: t.slice(0, 200) };
  })()`);
  console.log('direct /friends:', direct);
  console.log('globals:', await c.evaluate(`({ myFriendsType: Object.prototype.toString.call(myFriends), myFriendsLen: myFriends && myFriends.length, reqType: Object.prototype.toString.call(myFriendRequests) })`));
  await c.evaluate(`navigateTo('friends')`);
  await new Promise(r => setTimeout(r, 3000));
  console.log('after nav globals:', await c.evaluate(`({ myFriendsType: Object.prototype.toString.call(myFriends), myFriendsLen: myFriends && myFriends.length, grid: document.getElementById('friendsListGrid').children.length })`));
  // call manually
  await c.evaluate(`loadFriendsData()`);
  await new Promise(r => setTimeout(r, 2500));
  console.log('after manual:', await c.evaluate(`({ myFriendsLen: myFriends && myFriends.length, grid: document.getElementById('friendsListGrid').children.length, text: document.getElementById('friendsListGrid').innerText.slice(0,100) })`));
  console.log('errors:', c.errors.slice(0, 8));
  c.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
