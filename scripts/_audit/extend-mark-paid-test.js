const fs = require('fs');
const p = 'scripts/_audit/test-browser-mark-paid.js';
let c = fs.readFileSync(p, 'utf8');
const needle = `  // Cleanup
  const cl = await pool.connect();`;
const add = `  // 5. Group expense modal exposes the same action
  await cdp.evaluate(\`navigateTo('groups')\`);
  await new Promise(r => setTimeout(r, 1500));
  await cdp.evaluate(\`openGroupExpensesModal(\${gid})\`);
  await new Promise(r => setTimeout(r, 2000));
  const groupModalBtn = await cdp.evaluate(\`(() => {
    const modal = document.getElementById('groupExpensesModal');
    const btn = modal.querySelector('button[onclick*="openMarkPaidModal"]');
    return { visible: !modal.classList.contains('hidden'), hasButton: !!btn, text: (btn ? btn.innerText : '') };
  })()\`);
  check('group expense modal shows Mark Paid for the debtor share', groupModalBtn.visible && groupModalBtn.hasButton, JSON.stringify(groupModalBtn));
  await cdp.evaluate(\`closeGroupExpensesModal()\`);

  // 6. Settlement screen exposes the external-payment request action
  await cdp.evaluate(\`navigateTo('settle')\`);
  await new Promise(r => setTimeout(r, 2200));
  const peerClicked = await cdp.evaluate(\`(() => {
    const btn = [...document.querySelectorAll('#settlePeerCardsContainer button')].find(b => b.innerText.includes('Browser Receiver'));
    if (!btn) return false;
    btn.click(); return true;
  })()\`);
  await new Promise(r => setTimeout(r, 700));
  const settleAction = await cdp.evaluate(\`({
    disabled: document.getElementById('btnMarkPaidExternal').disabled,
    amount: document.getElementById('settleAmountInput').value
  })\`);
  check('settlement screen enables Mark as Paid for the selected peer', peerClicked && settleAction.disabled === false, JSON.stringify(settleAction));
  await cdp.evaluate(\`document.getElementById('btnMarkPaidExternal').click()\`);
  await new Promise(r => setTimeout(r, 500));
  const settleModal = await cdp.evaluate(\`({
    visible: !document.getElementById('markPaidModal').classList.contains('hidden'),
    context: document.getElementById('markPaidContext').innerText.replace(/\\\\s+/g,' ')
  })\`);
  check('settlement Mark as Paid opens the request modal', settleModal.visible && /Outstanding balance/i.test(settleModal.context), JSON.stringify(settleModal));
  await cdp.evaluate(\`closeMarkPaidModal()\`);

  // 7. Activity feed carries both sides of the notification
  await cdp.evaluate(\`navigateTo('activity')\`);
  await new Promise(r => setTimeout(r, 1800));
  const activityText = await cdp.evaluate(\`document.getElementById('activityFullLogList').innerText.replace(/\\\\s+/g,' ').slice(0,600)\`);
  check('activity feed notifies the debtor of acceptance and rejection', /accepted/i.test(activityText) && /rejected/i.test(activityText), activityText.slice(0, 220));

  // Cleanup
  const cl = await pool.connect();`;
if (!c.includes(needle)) { console.error('cleanup marker missing'); process.exit(1); }
c = c.replace(needle, add);
fs.writeFileSync(p, c);
console.log('added group/settle/activity UI checks');
