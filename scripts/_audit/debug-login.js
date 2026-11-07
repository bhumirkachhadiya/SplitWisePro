const { openPage } = require('./cdp-lib');
(async () => {
  const cdp = await openPage('http://127.0.0.1:5000/');
  await cdp.waitFor('document.readyState === "complete"');
  await new Promise(r => setTimeout(r, 1200));
  console.log('API =', await cdp.evaluate('typeof API !== "undefined" ? API : "undefined"'));
  console.log('handleAuthSubmit type =', await cdp.evaluate('typeof handleAuthSubmit'));
  console.log('token =', await cdp.evaluate('window.__splitwiseGetToken()'));
  const res = await cdp.evaluate(`(async () => {
    try {
      const r = await fetch(API + '/users/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'alex', password: 'password123' })
      });
      const t = await r.text();
      return { status: r.status, body: t.slice(0, 300) };
    } catch (e) { return { error: String(e) }; }
  })()`);
  console.log('login fetch:', res);
  // Now try the form path
  await cdp.evaluate(`(() => { document.getElementById('authEmail').value='alex'; document.getElementById('authPassword').value='password123'; })()`);
  const submit = await cdp.evaluate(`(async () => { try { const ev = new Event('submit', {cancelable:true, bubbles:true}); document.getElementById('authForm').dispatchEvent(ev); return 'dispatched'; } catch(e){ return String(e); } })()`);
  await new Promise(r => setTimeout(r, 3000));
  console.log('after submit:', submit, 'workspaceHidden=', await cdp.evaluate('document.getElementById("appWorkspace").classList.contains("hidden")'));
  console.log('alert:', await cdp.evaluate('document.getElementById("authAlertBox").innerText'));
  console.log('errors:', cdp.errors);
  cdp.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
