const fs = require('fs');
const p = 'scripts/_audit/test-browser-group-delete.js';
let c = fs.readFileSync(p, 'utf8');
const oldBlock = `  // Group with money: delete → safe Lock alternative
  const deleteBtnExists = await cdp.evaluate(\`!!document.querySelector("button[onclick*=\\\\\\"openDeleteGroupModal('${'${gidA}'}')\\\\\\"]")\`);
  check('delete button is shown for the circle creator', deleteBtnExists);
  await cdp.evaluate(\`document.querySelector("button[onclick*=\\\\\\"openDeleteGroupModal('${'${gidA}'}')\\\\\\"]").click()\`);
  await new Promise(r => setTimeout(r, 700));
  check('delete confirmation modal opens', await cdp.evaluate(\`!document.getElementById('deleteGroupModal').classList.contains('hidden')\`));
  await cdp.evaluate(\`document.getElementById('confirmDeleteGroupBtn').click()\`);
  const lockPrompt = await cdp.waitFor(\`(() => { const m = document.getElementById('customConfirmModal'); return m && !m.classList.contains('hidden') && /Cannot Delete/i.test(document.getElementById('customConfirmTitle').innerText); })()\`, 8000);`;
const newBlock = `  // Group with money: delete → safe Lock alternative (no doomed DELETE request)
  const deleteBtnExists = await cdp.evaluate(\`!!document.querySelector("button[onclick*=\\\\\\"openDeleteGroupModal('${'${gidA}'}')\\\\\\"]")\`);
  check('delete button is shown for the circle creator', deleteBtnExists);
  await cdp.evaluate(\`document.querySelector("button[onclick*=\\\\\\"openDeleteGroupModal('${'${gidA}'}')\\\\\\"]").click()\`);
  await new Promise(r => setTimeout(r, 700));
  const lockPrompt = await cdp.waitFor(\`(() => { const m = document.getElementById('customConfirmModal'); return m && !m.classList.contains('hidden') && /Cannot Delete/i.test(document.getElementById('customConfirmTitle').innerText); })()\`, 8000);`;
if (!c.includes(oldBlock)) { console.error('block not found'); process.exit(1); }
c = c.replace(oldBlock, newBlock);
fs.writeFileSync(p, c);
console.log('patched test (direct lock prompt)');
