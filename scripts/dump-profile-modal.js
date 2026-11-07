const fs = require('fs');
const content = fs.readFileSync('index.html.backup', 'utf8');
const start = content.indexOf('id="profileModal"');
const end = content.indexOf('id="newGroupModal"');
console.log(content.slice(start, end));
