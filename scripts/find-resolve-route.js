const fs = require('fs');
const content = fs.readFileSync(__dirname + '/../server.js', 'utf8');

const idx = content.indexOf('/api/admin/errors/:id/resolve');
if (idx !== -1) {
    fs.writeFileSync(__dirname + '/resolve-route.txt', content.slice(idx, idx + 800), 'utf8');
}
process.exit(0);
