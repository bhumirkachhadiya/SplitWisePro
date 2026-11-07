const fs = require('fs');
const p = 'scripts/_audit/test-browser-ai.js';
let c = fs.readFileSync(p, 'utf8');
const oldWait = "await cdp.waitFor(`document.getElementById('chatbotMessages').children.length > ${before}`, waitMs + 4000);";
const newWait = "await cdp.waitFor(`(() => { const ch = document.getElementById('chatbotMessages').children; if (ch.length < ${before + 2}) return false; const t = ch[ch.length-1].innerText || ''; return t.indexOf('Understanding your request') === -1; })()`, waitMs + 6000);";
if (!c.includes(oldWait)) { console.error('wait marker missing'); process.exit(1); }
c = c.replace(oldWait, newWait);
fs.writeFileSync(p, c);
console.log('patched wait');
