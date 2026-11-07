const fs = require('fs');
let c = fs.readFileSync('scripts/_audit/test-browser.js', 'utf8');
const reps = [
  {
    find: `  const cdp = await openPage(BASE + '/');
  await cdp.waitFor('document.readyState === "complete"');
  await new Promise(r => setTimeout(r, 1500));

  const authVisible = await cdp.evaluate('!document.getElementById("authScreen").classList.contains("hidden")');`,
    replace: `  const cdp = await openPage(BASE + '/');
  await cdp.waitFor('document.readyState === "complete"');
  // Start from a guaranteed logged-out state (cookies + storage).
  await cdp.send('Network.clearBrowserCookies');
  await cdp.evaluate('localStorage.clear(); sessionStorage.clear();');
  await cdp.goto(BASE + '/');
  await cdp.waitFor('document.readyState === "complete"');
  await new Promise(r => setTimeout(r, 1200));

  const authVisible = await cdp.evaluate('!document.getElementById("authScreen").classList.contains("hidden")');`
  },
  {
    find: `  const dashboardText = await cdp.evaluate('document.getElementById("appWorkspace").innerText.slice(0,300)');
  check('dashboard renders content', /dashboard|balance|owe|group/i.test(dashboardText), dashboardText.replace(/\\s+/g, ' ').slice(0, 80));`,
    replace: `  const dashboardText = await cdp.evaluate('document.getElementById("appWorkspace").innerText.slice(0,300)');
  check('dashboard renders content', /dashboard|balance|owe|group/i.test(dashboardText), dashboardText.replace(/\\s+/g, ' ').slice(0, 80));

  // ---- Session survives a page refresh ----
  cdp.errors.length = 0;
  await cdp.goto(BASE + '/');
  const restored = await cdp.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 15000);
  await new Promise(r => setTimeout(r, 1500));
  check('session survives a full page refresh', restored && cdp.errors.length === 0, 'errors=' + cdp.errors.slice(0, 2).join(' | '));`
  }
];
for (const r of reps) {
  const n = c.split(r.find).length - 1;
  if (n !== 1) { console.error('MATCH(' + n + ')'); process.exit(1); }
  c = c.replace(r.find, r.replace);
}
fs.writeFileSync('scripts/_audit/test-browser.js', c);
console.log('patched');
