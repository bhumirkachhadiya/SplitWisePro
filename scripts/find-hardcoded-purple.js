const fs = require('fs');
const content = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const lines = content.split('\n');

const findings = [];
lines.forEach((l, i) => {
    if (l.includes('#4f46e5') || l.includes('bg-indigo-700') || l.includes('bg-indigo-800') || l.includes('bg-purple-700') || l.includes('bg-purple-800')) {
        findings.push({ line: i + 1, text: l.trim().slice(0, 100) });
    }
});

console.log('Hardcoded dark purple/indigo instances:', findings);
process.exit(0);
