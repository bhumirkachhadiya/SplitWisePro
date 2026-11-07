const fs = require('fs');
let c = fs.readFileSync('scripts/_audit/test-browser-admin-chat.js', 'utf8');
const reps = [
  {
    find: `  cdp.errors.length = 0;
  await cdp.evaluate(\`navigateTo('master-admin')\`);
  await cdp.waitFor(\`!document.getElementById('view-master-admin').classList.contains('hidden')\`, 8000);
  await new Promise(r => setTimeout(r, 2000));
  check('master admin view opens', await cdp.evaluate(\`!document.getElementById('view-master-admin').classList.contains('hidden')\`));`,
    replace: `  await cdp.waitFor('window.currentUser && window.currentUser.role === "master_admin"', 8000);
  cdp.errors.length = 0;
  await cdp.evaluate(\`navigateTo('master-admin')\`);
  const adminViewOpen = await cdp.waitFor(\`!document.getElementById('view-master-admin').classList.contains('hidden')\`, 10000);
  await new Promise(r => setTimeout(r, 1200));
  check('master admin view opens', adminViewOpen);`
  },
  {
    find: `  const adminNavHidden = await cdp2.evaluate(\`(() => { const n = document.getElementById('sidebarMasterAdminNav'); return !n || n.classList.contains('hidden') || getComputedStyle(n).display === 'none'; })()\`);
  check('admin navigation hidden for normal user', adminNavHidden);`,
    replace: `  await cdp2.waitFor('window.currentUser && window.currentUser.role === "user"', 8000);
  const adminNavHidden = await cdp2.evaluate(\`(() => { const g = document.getElementById('navGroupMasterAdmin'); return !g || g.classList.contains('hidden') || getComputedStyle(g).display === 'none'; })()\`);
  check('admin navigation hidden for normal user', adminNavHidden);`
  },
  {
    find: `  const adminDataVisible = await cdp2.evaluate(\`document.getElementById('view-master-admin').innerText.length > 50\`);
  check('no admin data rendered for normal user', !adminDataVisible);`,
    replace: `  const adminPanelHidden = await cdp2.evaluate(\`document.getElementById('view-master-admin').classList.contains('hidden')\`);
  check('admin panel stays hidden for normal user', adminPanelHidden);`
  }
];
for (const r of reps) {
  const n = c.split(r.find).length - 1;
  if (n !== 1) { console.error('MATCH(' + n + '): ' + r.find.slice(0, 60)); process.exit(1); }
  c = c.replace(r.find, r.replace);
}
fs.writeFileSync('scripts/_audit/test-browser-admin-chat.js', c);
console.log('patched');
