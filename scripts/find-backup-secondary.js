const fs = require('fs');
const content = fs.readFileSync(__dirname + '/../index.html.backup', 'utf8');
const lines = content.split('\n');

const results = [];
lines.forEach((l, i) => {
    if (l.includes('secondary-container') || l.includes('on-secondary-container')) {
        results.push({ line: i + 1, text: l.trim() });
    }
});

fs.writeFileSync(__dirname + '/backup-secondary.json', JSON.stringify(results, null, 2));
console.log('Results in backup:', results.length);
process.exit(0);
