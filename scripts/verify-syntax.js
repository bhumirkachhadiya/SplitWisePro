const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let match;
let scriptIndex = 0;
let errors = [];

while ((match = scriptRegex.exec(html)) !== null) {
    scriptIndex++;
    const scriptContent = match[1];
    if (!scriptContent || scriptContent.trim().length === 0) continue;
    
    try {
        new vm.Script(scriptContent, { filename: `script_${scriptIndex}.js` });
        console.log(`✓ Script block ${scriptIndex} is syntactically valid (${scriptContent.length} chars).`);
    } catch (e) {
        console.error(`✗ Syntax error in script block ${scriptIndex}:`, e.message);
        errors.push({ scriptIndex, error: e.message });
    }
}

if (errors.length > 0) {
    console.error(`FAILED: ${errors.length} syntax error(s) found.`);
    process.exit(1);
} else {
    console.log(`✓ ALL script blocks in index.html passed vm.Script syntax verification!`);
    process.exit(0);
}
