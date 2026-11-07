const fs = require('fs');
const path = require('path');
const { openPage } = require('./cdp-lib');

const BASE = 'http://127.0.0.1:5000';
const SHOT_DIR = path.join(__dirname, 'shots');
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('FAIL  ' + name + (detail ? '  — ' + detail : '')); }
}

async function loginUI(cdp, identifier, password) {
  await cdp.evaluate(`(() => {
    const e = document.getElementById('authEmail'); e.value = ${JSON.stringify(identifier)}; e.dispatchEvent(new Event('input',{bubbles:true}));
    const p = document.getElementById('authPassword'); p.value = ${JSON.stringify(password)}; p.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
  })()`);
  return cdp.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 20000);
}

(async () => {
  // ---------- Master Admin UI ----------
  const cdp = await openPage(BASE + '/');
  await cdp.waitFor('document.readyState === "complete"');
  await cdp.send('Network.clearBrowserCookies');
  await cdp.evaluate('localStorage.clear(); sessionStorage.clear();');
  await cdp.goto(BASE + '/');
  await new Promise(r => setTimeout(r, 1000));

  check('master admin logs in through UI', await loginUI(cdp, 'alex', 'password123'));
  await new Promise(r => setTimeout(r, 2500));
  const adminNavVisible = await cdp.evaluate(`(() => { const n = document.getElementById('sidebarMasterAdminNav'); return n && !n.classList.contains('hidden'); })()`);
  check('master admin navigation entry is visible to the admin', adminNavVisible);

  await cdp.waitFor('window.currentUser && window.currentUser.role === "master_admin"', 8000);
  cdp.errors.length = 0;
  await cdp.evaluate(`navigateTo('master-admin')`);
  const adminViewOpen = await cdp.waitFor(`!document.getElementById('view-master-admin').classList.contains('hidden')`, 10000);
  await new Promise(r => setTimeout(r, 1200));
  check('master admin view opens', adminViewOpen);
  check('master admin view has no runtime errors', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

  for (const tab of ['overview', 'users', 'groups', 'finances', 'errors']) {
    cdp.errors.length = 0;
    await cdp.evaluate(`switchAdminTab('${tab}')`);
    await new Promise(r => setTimeout(r, 1500));
    const panel = await cdp.evaluate(`(() => { const el = document.getElementById('adminTabContent' + ${JSON.stringify(tab.charAt(0).toUpperCase() + tab.slice(1))}); return el ? !el.classList.contains('hidden') : false; })()`);
    const text = await cdp.evaluate(`(() => { const v = document.getElementById('view-master-admin'); return v ? v.innerText.replace(/\\s+/g,' ').slice(0,200) : ''; })()`);
    check(`admin tab "${tab}" opens cleanly`, panel && cdp.errors.length === 0 && text.length > 10, 'errors=' + cdp.errors.slice(0, 2).join(' | '));
  }
  await cdp.evaluate(`switchAdminTab('overview')`);
  await new Promise(r => setTimeout(r, 1200));
  await cdp.screenshot(path.join(SHOT_DIR, 'master-admin-overview.png'));
  await cdp.evaluate(`switchAdminTab('users')`);
  await new Promise(r => setTimeout(r, 1500));
  await cdp.screenshot(path.join(SHOT_DIR, 'master-admin-users.png'));

  const mpTabPresent = await cdp.evaluate(`!!document.getElementById('adminTabBtnMasterPassword')`);
  check('master-password tab is available to the admin', mpTabPresent);
  cdp.errors.length = 0;
  await cdp.evaluate(`switchAdminTab('masterPassword')`);
  await new Promise(r => setTimeout(r, 1800));
  const mpPanel = await cdp.evaluate(`(() => {
    const el = document.getElementById('adminTabContentMasterPassword');
    return { visible: el && !el.classList.contains('hidden'), text: el ? el.innerText.replace(/\\s+/g,' ').slice(0, 180) : '' };
  })()`);
  check('master-password tab loads its configuration cleanly', mpPanel.visible && cdp.errors.length === 0, 'errors=' + cdp.errors.slice(0, 2).join(' | '));
  await cdp.screenshot(path.join(SHOT_DIR, 'master-password-dev.png'));

  // ---------- Chat UI ----------
  cdp.errors.length = 0;
  await cdp.evaluate(`navigateTo('chat')`);
  await new Promise(r => setTimeout(r, 2000));
  const convCount = await cdp.evaluate(`document.querySelectorAll('#chatConversationsList [data-conversation-id], #chatConversationsList .chat-conv-item, #chatConversationsList > div').length`);
  check('chat conversation list renders', convCount > 0, 'items=' + convCount);
  await cdp.evaluate(`(() => { const first = document.querySelector('#chatConversationsList > div'); if (first) first.click(); })()`);
  await new Promise(r => setTimeout(r, 1500));
  await cdp.evaluate(`(() => { const i = document.getElementById('chatMessageInput'); if (i) { i.value = 'Browser chat audit message'; } })()`);
  await cdp.evaluate(`sendActiveChatMessage()`);
  await new Promise(r => setTimeout(r, 1500));
  const chatText = await cdp.evaluate(`document.getElementById('activeChatMessagesArea').innerText`);
  check('chat message sends and renders', /Browser chat audit message/.test(chatText), chatText.replace(/\s+/g, ' ').slice(0, 100));
  check('chat view has no runtime errors', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));
  await cdp.screenshot(path.join(SHOT_DIR, 'chat-desktop.png'));

  // XSS safety: message must be rendered as text
  await cdp.evaluate(`(() => { window.__xss = 0; const i = document.getElementById('chatMessageInput'); i.value = '<img src=x onerror="window.__xss=1">'; })()`);
  await cdp.evaluate(`sendActiveChatMessage()`);
  await new Promise(r => setTimeout(r, 1200));
  const xss = await cdp.evaluate(`({ fired: window.__xss, imgs: document.querySelectorAll('#activeChatMessagesArea img').length })`);
  check('chat messages are escaped (no script execution)', xss.fired === 0 && xss.imgs === 0, JSON.stringify(xss));

  // ---------- Normal user cannot see admin ----------
  const cdp2 = await openPage(BASE + '/');
  await cdp2.waitFor('document.readyState === "complete"');
  await cdp2.send('Network.clearBrowserCookies');
  await cdp2.evaluate('localStorage.clear(); sessionStorage.clear();');
  await cdp2.goto(BASE + '/');
  await new Promise(r => setTimeout(r, 1000));
  check('normal user logs in through UI', await loginUI(cdp2, 'rahul', 'password123'));
  await new Promise(r => setTimeout(r, 2500));
  await cdp2.waitFor('window.currentUser && window.currentUser.role === "user"', 8000);
  const adminNavHidden = await cdp2.evaluate(`(() => { const g = document.getElementById('navGroupMasterAdmin'); return !g || g.classList.contains('hidden') || getComputedStyle(g).display === 'none'; })()`);
  check('admin navigation hidden for normal user', adminNavHidden);
  cdp2.errors.length = 0;
  await cdp2.evaluate(`navigateTo('master-admin')`);
  await new Promise(r => setTimeout(r, 1500));
  const normalAdminView = await cdp2.evaluate(`!document.getElementById('view-master-admin').classList.contains('hidden')`);
  check('direct navigation to master admin is blocked for normal user', !normalAdminView);
  const adminPanelHidden = await cdp2.evaluate(`document.getElementById('view-master-admin').classList.contains('hidden')`);
  check('admin panel stays hidden for normal user', adminPanelHidden);

  console.log('\nErrors page 1:', cdp.errors.length, 'page 2:', cdp2.errors.length);
  if (cdp.errors.length) console.log(cdp.errors.slice(0, 8).join('\n'));
  if (cdp2.errors.length) console.log(cdp2.errors.slice(0, 8).join('\n'));
  console.log('\nRESULT:', pass, 'passed,', fail, 'failed');
  if (failures.length) console.log('FAILURES:\n - ' + failures.join('\n - '));
  cdp.close(); cdp2.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
