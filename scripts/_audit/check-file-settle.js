const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
console.log('file length', html.length);
console.log('id count', (html.match(/settlePeerCardsContainer/g) || []).length);
const i = html.indexOf('settlePeerCardsContainer');
console.log(html.slice(i - 200, i + 150));
