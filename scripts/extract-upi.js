const fs = require('fs');
const content = fs.readFileSync(__dirname + '/../index.html.backup', 'utf8');

const startIdx = content.indexOf('async function initUpiPaymentRequest(');
const endIdx = content.indexOf('function handleConfirmSettlement(', startIdx);

if (startIdx !== -1 && endIdx !== -1) {
    const endOfConfirm = content.indexOf('// -------------------------------------------------------------', endIdx);
    fs.writeFileSync(__dirname + '/upi-full-impl.js', content.slice(startIdx, endOfConfirm !== -1 ? endOfConfirm : endIdx + 2000), 'utf8');
    console.log('Saved UPI full impl');
} else {
    console.log('Indices not found:', startIdx, endIdx);
}
