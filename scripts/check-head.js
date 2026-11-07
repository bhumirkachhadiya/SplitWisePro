const fs = require('fs');
const content = fs.readFileSync(__dirname + '/build-quantum-ui.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, i) => {
    if (line.includes('headHtml') || line.includes('const ') || line.includes('let ')) {
        if (line.includes('headHtml') || line.includes('globalAliases') || line.includes('scriptPart')) {
            console.log((i + 1) + ': ' + line.slice(0, 80));
        }
    }
});
