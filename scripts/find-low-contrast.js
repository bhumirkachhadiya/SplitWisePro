const fs = require('fs');

function findInFile(file) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const out = [];
    lines.forEach((l, i) => {
        if (l.includes('text-indigo-300') || l.includes('text-indigo-400') || l.includes('text-purple-300') || l.includes('text-purple-400')) {
            out.push({ file: file.split('/').pop(), line: i + 1, text: l.trim().slice(0, 100) });
        }
    });
    return out;
}

const files = [
    __dirname + '/../scripts/templates/views-part1.js',
    __dirname + '/../scripts/templates/views-part2.js',
    __dirname + '/../scripts/templates/navigation-shell.js',
    __dirname + '/../scripts/templates/master-admin-view.js',
    __dirname + '/../scripts/build-quantum-ui.js'
];

let res = [];
files.forEach(f => {
    res = res.concat(findInFile(f));
});

console.log('Low contrast light-mode indigo/purple text instances:', res);
process.exit(0);
