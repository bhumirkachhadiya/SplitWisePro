const fs = require('fs');
const content = fs.readFileSync(__dirname + '/../server.js', 'utf8');

const idx = content.indexOf('/api/upi/payment-status/:requestId');
if (idx !== -1) {
    fs.writeFileSync(__dirname + '/server-upi-status-full.txt', content.slice(idx, idx + 4000), 'utf8');
}
process.exit(0);
