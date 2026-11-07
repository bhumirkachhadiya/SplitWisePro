const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');

const lines = content.split('\n');
lines.forEach((l, idx) => {
  if (l.includes('openGroup') || l.includes('selectGroup') || l.includes('renderGroupExpenses') || l.includes('viewGroup')) {
    console.log(`${idx + 1}: ${l.trim()}`);
  }
});
