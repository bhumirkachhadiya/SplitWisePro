const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');

const matches = [...content.matchAll(/fetch\([`'"]\$\{API\}\/settlements[`'"]/g)];
console.log('Matches in index.html:', matches.length);
matches.forEach(m => {
  const start = Math.max(0, m.index - 100);
  const end = Math.min(content.length, m.index + 800);
  console.log('--- SETTLEMENT POST CALL ---');
  console.log(content.slice(start, end));
});
