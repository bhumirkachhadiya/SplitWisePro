const fs = require('fs');
let c = fs.readFileSync('scripts/_audit/test-browser-payments.js', 'utf8');
const reps = [
  {
    find: `  check('payer sees the pending payment as awaiting receiver', payerSaw && payerPanel.visible && /Awaiting receiver/i.test(payerPanel.text), payerPanel.text.slice(0, 140));
  check('payer has no confirm button', payerPanel.confirmButtons === 0, 'buttons=' + payerPanel.confirmButtons);`,
    replace: `  const payerRow = await payer.evaluate(\`(() => {
    const rows = Array.from(document.querySelectorAll('#pendingPaymentsList > div'));
    const row = rows.find(r => r.innerHTML.indexOf('${'${rid}'}') !== -1);
    return row ? { text: row.innerText.replace(/\\\\s+/g,' '), confirm: row.querySelectorAll("button[onclick*='confirmIncomingPayment']").length } : null;
  })()\`);
  check('payer sees this payment as awaiting receiver', !!payerRow && /Awaiting receiver/i.test(payerRow.text), payerRow ? payerRow.text : 'row missing');
  check('payer has no confirm button on their own outgoing payment', payerRow && payerRow.confirm === 0, 'buttons=' + (payerRow && payerRow.confirm));`
  },
  {
    find: `  check('receiver sees a Confirm Receipt action for this payment', receiverSaw && recvPanel.visible && recvPanel.mine === 1, JSON.stringify({ visible: recvPanel.visible, buttons: recvPanel.confirmButtons, mine: recvPanel.mine }));`,
    replace: `  const receiverRow = await receiver.evaluate(\`(() => {
    const rows = Array.from(document.querySelectorAll('#pendingPaymentsList > div'));
    const row = rows.find(r => r.innerHTML.indexOf('${'${rid}'}') !== -1);
    return row ? { confirm: row.querySelectorAll("button[onclick*='confirmIncomingPayment']").length, reject: row.querySelectorAll("button[onclick*='rejectIncomingPayment']").length } : null;
  })()\`);
  check('receiver sees a Confirm Receipt action for this payment',
    receiverSaw && recvPanel.visible && !!receiverRow && receiverRow.confirm === 1 && receiverRow.reject === 1,
    JSON.stringify(receiverRow));`
  }
];
for (const r of reps) {
  const n = c.split(r.find).length - 1;
  if (n !== 1) { console.error('MATCH(' + n + '): ' + r.find.slice(0, 70)); process.exit(1); }
  c = c.replace(r.find, r.replace);
}
fs.writeFileSync('scripts/_audit/test-browser-payments.js', c);
console.log('patched');
