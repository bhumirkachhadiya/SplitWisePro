const fs = require('fs');
const content = fs.readFileSync(__dirname + '/../index.html.backup', 'utf8');

const regex = /currentUser\s*=\s*[^;]+;/g;
let match;
const matches = [];
while ((match = regex.exec(content)) !== null) {
    matches.push({ index: match.index, text: match[0], context: content.slice(Math.max(0, match.index - 50), match.index + 200) });
}

fs.writeFileSync(__dirname + '/user-matches.json', JSON.stringify(matches, null, 2), 'utf8');
console.log('Matches found:', matches.length);
