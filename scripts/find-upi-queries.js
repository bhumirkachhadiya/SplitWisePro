const fs = require('fs');
const content = fs.readFileSync('server.js', 'utf8');

const lines = content.split('\n');
lines.forEach((l, idx) => {
  if (l.includes('upi_id')) {
    console.log(`${idx + 1}: ${l.trim()}`);
  }
});
