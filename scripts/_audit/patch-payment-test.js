const fs = require('fs');
let c = fs.readFileSync('scripts/_audit/test-browser-payments.js', 'utf8');
const reps = [
  {
    find: `  const payerPanel = await payer.evaluate(\`(() => {
    const p = document.getElementById('pendingPaymentsPanel');
    const l = document.getElementById('pendingPaymentsList');
    return { visible: p && !p.classList.contains('hidden'), text: l ? l.innerText.replace(/\\\\s+/g,' ') : '', confirmButtons: l ? l.querySelectorAll("button[onclick*='confirmIncomingPayment']").length : 0 };
  })()\`);
  check('payer sees the pending payment as awaiting receiver', payerPanel.visible && /Awaiting receiver/i.test(payerPanel.text), payerPanel.text.slice(0, 120));
  check('payer has no confirm button', payerPanel.confirmButtons === 0, 'buttons=' + payerPanel.confirmButtons);`,
    replace: `  const payerSaw = await payer.waitFor(\`(() => {
    const p = document.getElementById('pendingPaymentsPanel');
    const l = document.getElementById('pendingPaymentsList');
    return p && !p.classList.contains('hidden') && l && l.innerText.indexOf('Awaiting receiver') !== -1;
  })()\`, 10000);
  const payerPanel = await payer.evaluate(\`(() => {
    const p = document.getElementById('pendingPaymentsPanel');
    const l = document.getElementById('pendingPaymentsList');
    return { visible: p && !p.classList.contains('hidden'), text: l ? l.innerText.replace(/\\\\s+/g,' ') : '', confirmButtons: l ? l.querySelectorAll("button[onclick*='confirmIncomingPayment']").length : 0 };
  })()\`);
  check('payer sees the pending payment as awaiting receiver', payerSaw && payerPanel.visible && /Awaiting receiver/i.test(payerPanel.text), payerPanel.text.slice(0, 140));
  check('payer has no confirm button', payerPanel.confirmButtons === 0, 'buttons=' + payerPanel.confirmButtons);`
  },
  {
    find: `  const recvPanel = await receiver.evaluate(\`(() => {
    const p = document.getElementById('pendingPaymentsPanel');
    const l = document.getElementById('pendingPaymentsList');
    return { visible: p && !p.classList.contains('hidden'), text: l ? l.innerText.replace(/\\\\s+/g,' ') : '', confirmButtons: l ? l.querySelectorAll("button[onclick*='confirmIncomingPayment']").length : 0 };
  })()\`);
  check('receiver sees a Confirm Receipt action', recvPanel.visible && recvPanel.confirmButtons === 1, JSON.stringify({ visible: recvPanel.visible, buttons: recvPanel.confirmButtons, text: recvPanel.text.slice(0, 100) }));`,
    replace: `  const receiverSaw = await receiver.waitFor(\`(() => {
    const l = document.getElementById('pendingPaymentsList');
    return l && l.innerHTML.indexOf('${'${rid}'}') !== -1;
  })()\`, 10000);
  const recvPanel = await receiver.evaluate(\`(() => {
    const p = document.getElementById('pendingPaymentsPanel');
    const l = document.getElementById('pendingPaymentsList');
    return { visible: p && !p.classList.contains('hidden'), text: l ? l.innerText.replace(/\\\\s+/g,' ') : '', confirmButtons: l ? l.querySelectorAll("button[onclick*='confirmIncomingPayment']").length : 0, mine: l ? l.querySelectorAll("button[onclick*='${'${rid}'}']").length : 0 };
  })()\`);
  check('receiver sees a Confirm Receipt action for this payment', receiverSaw && recvPanel.visible && recvPanel.mine === 1, JSON.stringify({ visible: recvPanel.visible, buttons: recvPanel.confirmButtons, mine: recvPanel.mine }));`
  },
  {
    find: `  await receiver.evaluate(\`(() => { const b = document.querySelector("#pendingPaymentsList button[onclick*='confirmIncomingPayment']"); if (b) b.click(); })()\`);`,
    replace: `  await receiver.evaluate(\`(() => { const b = document.querySelector("#pendingPaymentsList button[onclick*='${'${rid}'}']"); if (b) b.click(); })()\`);`
  },
  {
    find: `  const after = await receiver.evaluate(\`(() => { const p = document.getElementById('pendingPaymentsPanel'); return p ? p.classList.contains('hidden') : true; })()\`);
  check('pending panel clears after confirmation', after === true);`,
    replace: `  const cleared = await receiver.waitFor(\`(() => { const l = document.getElementById('pendingPaymentsList'); return !l || l.innerHTML.indexOf('${'${rid}'}') === -1; })()\`, 10000);
  check('confirmed payment disappears from the pending inbox', cleared);`
  }
];
for (const r of reps) {
  const n = c.split(r.find).length - 1;
  if (n !== 1) { console.error('MATCH(' + n + '): ' + r.find.slice(0, 70)); process.exit(1); }
  c = c.replace(r.find, r.replace);
}
fs.writeFileSync('scripts/_audit/test-browser-payments.js', c);
console.log('patched');
