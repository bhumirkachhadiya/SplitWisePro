const fs = require('fs');
const content = fs.readFileSync(__dirname + '/../index.html.backup', 'utf8');
const lines = content.split('\n');

for (let i = 5665; i <= 5685 && i < lines.length; i++) {
    console.log(`${i+1}: ${lines[i]}`);
}
process.exit(0);
