const fs = require('fs');
const content = fs.readFileSync(__dirname + '/../index.html.backup', 'utf8');

const idx = content.indexOf('function launchApp(');
if (idx !== -1) {
    fs.writeFileSync(__dirname + '/launch-app.txt', content.slice(idx, idx + 1000), 'utf8');
    console.log('Found launchApp');
}
