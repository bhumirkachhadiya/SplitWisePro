const fs = require('fs');
const content = fs.readFileSync('index.html.backup', 'utf8');
const lines = content.split('\n');
const matches = [];
lines.forEach((line, idx) => {
    if (line.includes('secondary-container') || line.includes('exp.group_name') || line.includes('group_name')) {
        matches.push(`${idx + 1}: ${line.trim()}`);
    }
});
fs.writeFileSync('temp_badge_search.txt', matches.join('\n'));
process.exit(0);
