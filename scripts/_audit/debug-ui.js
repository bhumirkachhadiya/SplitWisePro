const { openPage } = require('./cdp-lib');
(async () => {
  const cdp = await openPage('http://127.0.0.1:5000/');
  await cdp.waitFor('document.readyState === "complete"');
  await new Promise(r => setTimeout(r, 1000));
  await cdp.evaluate(`(() => { document.getElementById('authEmail').value='alex'; document.getElementById('authPassword').value='password123'; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  await cdp.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 15000);
  await new Promise(r => setTimeout(r, 2500));
  console.log(await cdp.evaluate(`(() => {
    const el = document.getElementById('dashStatNet');
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      text: el.innerText,
      textLength: el.innerText.length,
      width: r.width,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      letterSpacing: cs.letterSpacing,
      fontFeature: cs.fontFeatureSettings,
      fontsStatus: document.fonts ? document.fonts.status : 'n/a',
      loadedFonts: Array.from(document.fonts || []).slice(0,8).map(f => f.family + ':' + f.status)
    };
  })()`));
  // scroll to bottom to see overlap
  console.log('scrollHeight=', await cdp.evaluate('document.documentElement.scrollHeight'), 'inner=', await cdp.evaluate('window.innerHeight'));
  await cdp.evaluate('window.scrollTo(0, document.body.scrollHeight)');
  await new Promise(r => setTimeout(r, 500));
  await cdp.screenshot('scripts/_audit/shots/dashboard-bottom.png');
  cdp.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
