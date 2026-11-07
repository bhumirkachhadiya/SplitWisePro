const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');

const scriptRegex = /<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi;
let match;
let count = 0;
let errors = 0;

while ((match = scriptRegex.exec(html)) !== null) {
    const code = match[1].trim();
    // Skip empty or external script tags
    if (!code) continue;
    count++;
    try {
        new vm.Script(code);
        console.log(`Script block #${count}: OK (${code.length} chars)`);
    } catch (e) {
        errors++;
        console.error(`Script block #${count} SYNTAX ERROR:`, e.message);
        console.error(code.slice(0, 300));
    }
}

console.log(`\nChecked ${count} inline script blocks with ${errors} errors.`);
process.exit(errors > 0 ? 1 : 0);
