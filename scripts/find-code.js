const fs = require('fs');
const path = require('path');

function searchFile(filePath, queries) {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
        queries.forEach(q => {
            if (line.includes(q)) {
                console.log(`[${path.basename(filePath)}:${idx+1}] [Query: ${q}] ${line.trim()}`);
            }
        });
    });
}

const queries = process.argv.slice(2);
if (queries.length === 0) {
    console.log('No queries provided');
    process.exit(0);
}

// Search server.js
searchFile(path.join(__dirname, '..', 'server.js'), queries);

// Search templates
const tplDir = path.join(__dirname, 'templates');
if (fs.existsSync(tplDir)) {
    fs.readdirSync(tplDir).forEach(f => {
        searchFile(path.join(tplDir, f), queries);
    });
}
searchFile(path.join(__dirname, 'build-quantum-ui.js'), queries);
