const fs = require('fs');
const lines = fs.readFileSync(__dirname + '/../index.html.backup', 'utf8').split('\n');

for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.includes('group_name') || l.includes('exp.group_name') || l.includes('e.group_name')) {
        console.log(`Line ${i+1}: ${l.trim()}`);
    }
}
process.exit(0);
