const fs = require('fs');

function checkFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const results = [];
    lines.forEach((l, i) => {
        if (l.includes('secondary-container') || l.includes('on-secondary') || l.includes('text-secondary') || l.includes('bg-secondary') || l.includes('text-indigo') || l.includes('bg-indigo') || l.includes('text-purple') || l.includes('bg-purple')) {
            results.push({ line: i + 1, text: l.trim().slice(0, 120) });
        }
    });
    return results;
}

const templates = [
    __dirname + '/../scripts/build-quantum-ui.js',
    __dirname + '/../scripts/templates/navigation-shell.js',
    __dirname + '/../scripts/templates/views-part1.js',
    __dirname + '/../scripts/templates/views-part2.js',
    __dirname + '/../scripts/templates/modals.js',
    __dirname + '/../scripts/templates/auth-screen.js'
];

const allResults = {};
templates.forEach(t => {
    allResults[t.split('/').pop()] = checkFile(t);
});

fs.writeFileSync(__dirname + '/secondary-occurrences.json', JSON.stringify(allResults, null, 2));
console.log('Done scanning templates');
process.exit(0);
