const fs = require('fs');
const backupPath = __dirname + '/../index.html.backup';
const content = fs.readFileSync(backupPath, 'utf8');
const idx = content.indexOf('function navigateTo(');
if (idx !== -1) {
    fs.writeFileSync(__dirname + '/navigate-func.txt', content.slice(idx, idx + 2500), 'utf8');
    console.log('Written');
}
