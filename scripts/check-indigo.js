const fs = require('fs');
const path = require('path');

const dirs = [
    path.join(__dirname, 'templates'),
    __dirname
];

const found = [];

dirs.forEach(d => {
    fs.readdirSync(d).forEach(f => {
        if (f.endsWith('.js')) {
            const p = path.join(d, f);
            const content = fs.readFileSync(p, 'utf8');
            content.split('\n').forEach((line, idx) => {
                if (line.includes('text-indigo-400') && !line.includes('dark:text-indigo-400')) {
                    found.push(`${f}:${idx + 1}: ${line.trim()}`);
                }
                if (line.includes('text-purple-400') && !line.includes('dark:text-purple-400')) {
                    found.push(`${f}:${idx + 1}: ${line.trim()}`);
                }
            });
        }
    });
});

fs.writeFileSync('temp_indigo_search.txt', found.join('\n'));
process.exit(0);
