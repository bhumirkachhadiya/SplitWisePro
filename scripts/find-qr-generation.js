const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');

const matches = [...content.matchAll(/QRCode|upi:\/\/pay|qrCanvas|renderQr/gi)];
console.log('QR matches in index.html:', matches.length);
matches.forEach(m => {
  const start = Math.max(0, m.index - 50);
  const end = Math.min(content.length, m.index + 200);
  console.log('--- QR MATCH ---');
  console.log(content.slice(start, end));
});
