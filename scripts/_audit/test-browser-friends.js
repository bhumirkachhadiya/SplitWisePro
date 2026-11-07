const path = require('path');
const { openPage } = require('./cdp-lib');
const BASE = 'http://127.0.0.1:5000';
const SHOT_DIR = path.join(__dirname, 'shots');
let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('FAIL  ' + name + (detail ? '  — ' + detail : '')); }
}
async function login(cdp, id) {
  await cdp.evaluate(`(() => { document.getElementById('authEmail').value=${JSON.stringify(id)}; document.getElementById('authPassword').value='password123'; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  return cdp.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 20000);
}
(async () => {
  const cdp = await openPage(BASE + '/');
  await cdp.waitFor('document.readyState === "complete"');
  await cdp.send('Network.clearBrowserCookies');
  await cdp.evaluate('localStorage.clear(); sessionStorage.clear();');
  await cdp.goto(BASE + '/');
  await new Promise(r => setTimeout(r, 800));
  check('user logs in', await login(cdp, 'alex'));
  await new Promise(r => setTimeout(r, 2500));

  // Simulate the exact URL the user reported.
  cdp.errors.length = 0;
  await cdp.goto(BASE + '/#friends');
  await new Promise(r => setTimeout(r, 4000));
  const page = await cdp.evaluate(`(() => {
    const v = document.getElementById('view-friends');
    const g = document.getElementById('friendsListGrid');
    const badge = document.getElementById('friendsCountBadge');
    return {
      hash: location.hash,
      viewHidden: v && v.classList.contains('hidden'),
      cards: g ? g.children.length : -1,
      text: g ? g.innerText.replace(/\\s+/g,' ').slice(0, 220) : '',
      count: badge ? badge.innerText : ''
    };
  })()`);
  check('friends view opens from #friends', page.hash === '#friends' && page.viewHidden === false, JSON.stringify({ hash: page.hash, hidden: page.viewHidden }));
  check('friends list renders real connections', page.cards >= 1, 'cards=' + page.cards + ' count=' + page.count);
  check('friends data text is present', /@|SW-/.test(page.text), page.text.slice(0, 100));
  check('no browser console errors on friends', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));
  await cdp.screenshot(path.join(SHOT_DIR, 'friends-fixed.png'));

  // Navigate away and back through the UI.
  await cdp.evaluate(`navigateTo('dashboard')`);
  await new Promise(r => setTimeout(r, 600));
  cdp.errors.length = 0;
  await cdp.evaluate(`navigateTo('friends')`);
  await new Promise(r => setTimeout(r, 2500));
  const cards2 = await cdp.evaluate(`document.getElementById('friendsListGrid').children.length`);
  check('friends list still renders after navigating back', cards2 >= 1 && cdp.errors.length === 0, 'cards=' + cards2 + ' errors=' + cdp.errors.slice(0, 2).join(' | '));

  // Search
  cdp.errors.length = 0;
  await cdp.evaluate(`(() => { const i = document.getElementById('friendSearchInput'); i.value = 'priya'; i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await cdp.evaluate(`searchFriendsToConnect()`);
  await new Promise(r => setTimeout(r, 2500));
  const search = await cdp.evaluate(`(() => { const el = document.getElementById('friendSearchResults'); return { hidden: el ? el.classList.contains('hidden') : true, text: el ? el.innerText.replace(/\\s+/g,' ').slice(0,160) : '' }; })()`);
  check('friend search responds', search.hidden === false && cdp.errors.length === 0, 'text=' + search.text.slice(0, 80));

  console.log('\nRESULT:', pass, 'passed,', fail, 'failed');
  if (failures.length) console.log('FAILURES:\n - ' + failures.join('\n - '));
  cdp.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
