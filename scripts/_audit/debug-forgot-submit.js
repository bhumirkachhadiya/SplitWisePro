const { openPage } = require('./cdp-lib');
const BASE = 'http://127.0.0.1:5000';
(async () => {
  const c = await openPage(BASE + '/');
  await c.waitFor('document.readyState === "complete"');
  await c.send('Network.clearBrowserCookies');
  await c.evaluate('localStorage.clear(); sessionStorage.clear();');
  await c.goto(BASE + '/');
  await new Promise(r => setTimeout(r, 900));
  c.errors.length = 0;
  await c.evaluate(`document.querySelector('button[onclick="openForgotPasswordModal()"]').click()`);
  await new Promise(r => setTimeout(r, 400));
  await c.evaluate(`(() => { document.getElementById('forgotEmailInput').value='alex@splitease.io'; document.getElementById('forgotStep1Form').requestSubmit(); })()`);
  await new Promise(r => setTimeout(r, 5000));
  console.log(await c.evaluate(`({
    step1Hidden: document.getElementById('forgotStep1Form').classList.contains('hidden'),
    step2Hidden: document.getElementById('forgotStep2Form').classList.contains('hidden'),
    title: document.getElementById('forgotModalTitle').innerText,
    subtitle: document.getElementById('forgotModalSubtitle').innerText,
    alertHidden: document.getElementById('forgotModalAlert').classList.contains('hidden'),
    alert: document.getElementById('forgotModalAlert').innerText.replace(/\\s+/g,' '),
    btnDisabled: document.getElementById('forgotStep1SubmitBtn').disabled
  })`));
  console.log('errors', c.errors.slice(0, 5));
  await c.screenshot('scripts/_audit/shots/forgot-step2.png');
  c.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
