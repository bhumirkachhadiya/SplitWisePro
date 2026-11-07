const { openPage } = require('./cdp-lib');
(async () => {
  const c = await openPage('http://127.0.0.1:5000/');
  await c.waitFor('document.readyState === "complete"');
  await new Promise(r => setTimeout(r, 600));
  console.log('user at load:', await c.evaluate('currentUser && currentUser.name'), 'token:', await c.evaluate('!!window.__splitwiseGetToken()'));
  await c.evaluate(`(() => {
    window.__stacks = [];
    const origFetch = window.fetch;
    window.fetch = function(input, init){
      if (String(input).indexOf('/api/') !== -1) {
        window.__stacks.push({ url: String(input), stack: (new Error()).stack.split('\\n').slice(1, 5).join(' | ') });
      }
      return origFetch(input, init);
    };
  })()`);
  await c.evaluate(`(() => { document.getElementById('authEmail').value='alex'; document.getElementById('authPassword').value='password123'; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  await c.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 15000);
  await new Promise(r => setTimeout(r, 2500));
  const s = await c.evaluate('window.__stacks');
  s.slice(0, 8).forEach(x => console.log('\n' + x.url + '\n   ' + x.stack));
  c.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
