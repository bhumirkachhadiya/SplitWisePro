const { openPage } = require('./cdp-lib');
(async () => {
  const c = await openPage('http://127.0.0.1:5000/');
  await c.waitFor('document.readyState === "complete"');
  await new Promise(r => setTimeout(r, 800));
  console.log('before token:', await c.evaluate('window.__splitwiseGetToken()'));
  const loginResp = await c.evaluate(`(async () => {
    const r = await fetch(API + '/users/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email:'alex', password:'password123' })});
    const d = await r.json();
    return { status: r.status, hasToken: !!d.session_token, token: (d.session_token||'').slice(0,8) };
  })()`);
  console.log('login resp:', loginResp);
  console.log('after direct login token:', await c.evaluate('window.__splitwiseGetToken()'));
  // form login
  await c.evaluate(`(() => { document.getElementById('authEmail').value='alex'; document.getElementById('authPassword').value='password123'; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  await c.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 15000);
  await new Promise(r => setTimeout(r, 2000));
  console.log('after form login token:', await c.evaluate('window.__splitwiseGetToken()'));
  console.log('storage:', await c.evaluate(`({tok: sessionStorage.getItem('splitwise_session_token'), user: sessionStorage.getItem('splitease_user') && JSON.parse(sessionStorage.getItem('splitease_user')).name})`));
  console.log('401s:', c.network.filter(n => n.status === 401).map(n => n.url));
  console.log('errors:', c.errors.slice(0,5));
  c.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
