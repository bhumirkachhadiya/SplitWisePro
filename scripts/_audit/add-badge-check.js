const fs = require('fs');
const p = 'scripts/_audit/test-browser-mark-paid.js';
let c = fs.readFileSync(p, 'utf8');
const needle = `  check('receiver sees payer, amount, method and expense detail', rxPanel.text.includes('200.00') && /Browser Debtor/i.test(rxPanel.text) && /CASH|Cash/i.test(rxPanel.text) && rxPanel.text.includes(desc), rxPanel.text);`;
const add = needle + `\n  const navBadge = await cdp.evaluate(\`(() => { const b = document.getElementById('settleRequestBadge'); return { hidden: b.classList.contains('hidden'), text: b.innerText }; })()\`);\n  check('sidebar Settle Up badge alerts the receiver', navBadge.hidden === false && navBadge.text === '1', JSON.stringify(navBadge));`;
if (!c.includes(needle)) { console.error('anchor missing'); process.exit(1); }
c = c.replace(needle, add);
fs.writeFileSync(p, c);
console.log('added badge check');
