const fs = require('fs');
let c = fs.readFileSync('scripts/_audit/test-browser-payments.js', 'utf8');
const find = `  const payerRow = await payer.evaluate(\`(() => {
    const rows = Array.from(document.querySelectorAll('#pendingPaymentsList > div'));
    const row = rows.find(r => r.innerHTML.indexOf('${'${rid}'}') !== -1);
    return row ? { text: row.innerText.replace(/\\\\s+/g,' '), confirm: row.querySelectorAll("button[onclick*='confirmIncomingPayment']").length } : null;
  })()\`);`;
const replace = `  const payerRow = await payer.evaluate(\`(() => {
    const rows = Array.from(document.querySelectorAll('#pendingPaymentsList > div'));
    const row = rows.find(r => r.innerText.indexOf('UIUTR98765432') !== -1);
    return row ? { text: row.innerText.replace(/\\\\s+/g,' '), confirm: row.querySelectorAll("button[onclick*='confirmIncomingPayment']").length } : null;
  })()\`);`;
if (c.split(find).length !== 2) { console.error('match', c.split(find).length - 1); process.exit(1); }
c = c.replace(find, replace);
fs.writeFileSync('scripts/_audit/test-browser-payments.js', c);
console.log('patched');
