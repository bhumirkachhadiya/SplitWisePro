const fs = require('fs');
const content = fs.readFileSync(__dirname + '/../index.html', 'utf8');

const matches = content.match(/function\s+[a-zA-Z0-9_]*expense[a-zA-Z0-9_]*\s*\(/gi) || [];
const matches2 = content.match(/function\s+render[a-zA-Z0-9_]*\s*\(/gi) || [];

fs.writeFileSync(__dirname + '/render-func-names.json', JSON.stringify({ matches, matches2 }, null, 2));
process.exit(0);
