const fs = require('fs');

function searchFile(filename) {
  const content = fs.readFileSync(filename, 'utf8');
  const lines = content.split('\n');
  lines.forEach((l, idx) => {
    if (l.toLowerCase().includes('not registered') || l.toLowerCase().includes('user not found') || l.includes('/api/upi') || l.includes('qr-complete')) {
      console.log(`${filename}:${idx + 1}: ${l.trim()}`);
    }
  });
}

searchFile('server.js');
searchFile('index.html');
