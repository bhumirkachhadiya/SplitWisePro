const fs = require('fs');
const p = 'scripts/_audit/test-browser-mark-paid.js';
let c = fs.readFileSync(p, 'utf8');

const oldRow = `  const rowClicked = await cdp.evaluate(\`(() => {
    const row = [...document.querySelectorAll('#allExpensesContainer > div')].find(d => d.innerText.includes(${JSON.stringify(desc)}));
    if (!row) return 'no-row';
    const btn = row.querySelector('button[title="Mark my share as paid"]');
    if (!btn) return 'no-button';
    btn.click(); return 'clicked';
  })()\`);`;
const newRow = `  await cdp.waitFor(\`[...document.querySelectorAll('#allExpensesContainer > div')].some(d => d.innerText.includes(${JSON.stringify(desc)}))\`, 15000);
  const rowClicked = await cdp.evaluate(\`(() => {
    const row = [...document.querySelectorAll('#allExpensesContainer > div')].find(d => d.innerText.includes(${JSON.stringify(desc)}));
    if (!row) return 'no-row';
    const btn = row.querySelector('button[title="Mark my share as paid"]');
    if (!btn) return 'no-button';
    btn.click(); return 'clicked';
  })()\`);`;
if (!c.includes(oldRow)) { console.error('row block missing'); process.exit(1); }
c = c.replace(oldRow, newRow);

c = c.replace(`  await cdp.evaluate(\`navigateTo('settle')\`);
  await new Promise(r => setTimeout(r, 2500));
  const rxPanel = await cdp.evaluate(\`(() => ({`,
`  await cdp.evaluate(\`navigateTo('settle')\`);
  await new Promise(r => setTimeout(r, 2500));
  await cdp.waitFor(\`document.getElementById('prCountReceived').innerText === '1'\`, 15000);
  const rxPanel = await cdp.evaluate(\`(() => ({`);

fs.writeFileSync(p, c);
console.log('added robust waits');
