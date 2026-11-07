const fs = require('fs');
const content = fs.readFileSync(__dirname + '/../index.html.backup', 'utf8');

const regex = /function\s+([a-zA-Z0-9_]*[uU][pP][iI][a-zA-Z0-9_]*)\s*\(/g;
let match;
const funcs = [];
while ((match = regex.exec(content)) !== null) {
    funcs.push(match[1]);
}

const settleRegex = /function\s+([a-zA-Z0-9_]*[sS]ettle[a-zA-Z0-9_]*)\s*\(/g;
while ((match = settleRegex.exec(content)) !== null) {
    funcs.push(match[1]);
}

fs.writeFileSync(__dirname + '/upi-funcs.json', JSON.stringify(funcs, null, 2), 'utf8');
console.log('UPI/Settle functions:', funcs);
