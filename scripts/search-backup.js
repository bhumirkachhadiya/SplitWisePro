const fs = require('fs');
const content = fs.readFileSync('index.html.backup', 'utf8');
const queries = ['triggerAutoQrSettle', 'resetSettleFormForNewTransaction', 'handleConfirmSettlement', 'onSettleAmountChanged', 'generateUpiQrCode', 'checkUpiPaymentStatus'];

queries.forEach(q => {
    let idx = content.indexOf(q);
    if (idx !== -1) {
        console.log(`Found "${q}" at offset ${idx}`);
        const slice = content.substring(idx - 100, idx + 200);
        console.log('--- Context:\n', slice, '\n---');
    } else {
        console.log(`NOT found: "${q}"`);
    }
});
