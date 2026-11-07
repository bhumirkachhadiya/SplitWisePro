const fs = require('fs');
const content = fs.readFileSync(__dirname + '/../index.html.backup', 'utf8');

const idx = content.indexOf('function openSettleForPeer(');
if (idx !== -1) {
    fs.writeFileSync(__dirname + '/open-settle-func2.txt', content.slice(idx + 1000, idx + 2500), 'utf8');
}
process.exit(0);
