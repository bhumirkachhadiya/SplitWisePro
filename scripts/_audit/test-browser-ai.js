const path = require('path');
const { openPage } = require('./cdp-lib');
const BASE = 'http://127.0.0.1:5000';
const SHOT_DIR = path.join(__dirname, 'shots');
let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('FAIL  ' + name + (detail ? '  — ' + detail : '')); }
}
async function login(cdp, id) {
  await cdp.evaluate(`(() => { document.getElementById('authEmail').value=${JSON.stringify(id)}; document.getElementById('authPassword').value='password123'; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  return cdp.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 20000);
}
(async () => {
  const cdp = await openPage(BASE + '/');
  await cdp.waitFor('document.readyState === "complete"');
  await cdp.send('Network.clearBrowserCookies');
  await cdp.evaluate('localStorage.clear(); sessionStorage.clear();');
  await cdp.goto(BASE + '/');
  await new Promise(r => setTimeout(r, 900));
  check('AI test user logs in', await login(cdp, 'alex'));
  await new Promise(r => setTimeout(r, 2500));

  cdp.errors.length = 0;
  await cdp.evaluate(`toggleChatbot()`);
  await new Promise(r => setTimeout(r, 800));
  const drawerOpen = await cdp.evaluate(`!document.getElementById('chatbotDrawer').classList.contains('hidden')`);
  check('AI assistant drawer opens', drawerOpen);

  async function ask(text, waitMs = 4000) {
    cdp.errors.length = 0;
    const before = await cdp.evaluate(`document.getElementById('chatbotMessages').children.length`);
    await cdp.evaluate(`(() => { document.getElementById('chatbotInput').value = ${JSON.stringify(text)}; sendChatbotMessage(); })()`);
    await cdp.waitFor(`(() => { const ch = document.getElementById('chatbotMessages').children; if (ch.length < ${before + 2}) return false; const t = ch[ch.length-1].innerText || ''; return t.indexOf('Understanding your request') === -1 && t.indexOf('Generating response') === -1 && t.trim().length > 0; })()`, waitMs + 8000);
    await new Promise(r => setTimeout(r, 600));
    const after = await cdp.evaluate(`document.getElementById('chatbotMessages').children.length`);
    const last = await cdp.evaluate(`(() => { const ch = document.getElementById('chatbotMessages').children; return ch.length ? ch[ch.length-1].innerText.replace(/\\s+/g,' ').slice(0, 240) : ''; })()`);
    return { before, after, last, errors: cdp.errors.slice(0, 3) };
  }

  const hi = await ask('Hello');
  check('AI responds to a greeting', hi.after > hi.before && hi.last.length > 0 && hi.errors.length === 0, hi.last.slice(0, 100));

  const bal = await ask('Show my balance');
  check('AI answers a balance question with an amount', /₹|balance|owe|owed/i.test(bal.last) && bal.errors.length === 0, bal.last.slice(0, 120));

  const list = await ask('Show my recent expenses');
  check('AI answers an expense-list question', /expense|₹|ledger/i.test(list.last) && list.errors.length === 0, list.last.slice(0, 120));

  const hindi = await ask('मेरा कुल बैलेंस कितना है?');
  check('AI handles Hindi', hindi.after > hindi.before && hindi.errors.length === 0, hindi.last.slice(0, 100));

  const guj = await ask('મારું બૅલેન્સ કેટલું છે?');
  check('AI handles Gujarati', guj.after > guj.before && guj.errors.length === 0, guj.last.slice(0, 100));

  const unrelated = await ask('What is the capital of France?');
  check('AI politely declines unrelated trivia', /split|ledger|financial|expense|assist|मदद|મદદ/i.test(unrelated.last) && unrelated.errors.length === 0, unrelated.last.slice(0, 120));

  await cdp.evaluate(`toggleChatbot()`);
  await new Promise(r => setTimeout(r, 400));
  check('AI drawer closes cleanly', await cdp.evaluate(`document.getElementById('chatbotDrawer').classList.contains('hidden')`));

  console.log('\nConsole errors:', cdp.errors.length);
  if (cdp.errors.length) console.log(cdp.errors.slice(0, 8).join('\n'));
  console.log('RESULT:', pass, 'passed,', fail, 'failed');
  if (failures.length) console.log('FAILURES:\n - ' + failures.join('\n - '));
  cdp.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
