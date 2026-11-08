const { openPage } = require('./cdp-lib');
const BASE = 'http://127.0.0.1:5000';
(async () => {
  const c = await openPage(BASE + '/');
  await c.waitFor('document.readyState === "complete"');
  await c.send('Network.clearBrowserCookies');
  await c.evaluate('localStorage.clear(); sessionStorage.clear();');
  await c.goto(BASE + '/');
  await new Promise(r => setTimeout(r, 1000));
  c.errors.length = 0;
  const before = await c.evaluate(`({
    authVisible: !document.getElementById('authScreen').classList.contains('hidden'),
    forgotBtn: !!document.querySelector('button[onclick="openForgotPasswordModal()"]'),
    fn: typeof openForgotPasswordModal
  })`);
  console.log('before', before);
  await c.evaluate(`document.querySelector('button[onclick="openForgotPasswordModal()"]').click()`);
  await new Promise(r => setTimeout(r, 700));
  console.log('after click', await c.evaluate(`({
    modalHidden: document.getElementById('forgotPasswordModal').classList.contains('hidden'),
    step1: !document.getElementById('forgotStep1Form').classList.contains('hidden'),
    title: document.getElementById('forgotModalTitle').innerText,
    errors: 0
  })`));
  console.log('console errors', c.errors.slice(0, 5));
  await c.screenshot('scripts/_audit/shots/forgot-modal.png');
  c.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
