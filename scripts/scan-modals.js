const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');
const lines = content.split('\n');

for (let i = 1780; i < 2820; i++) {
  const line = lines[i] || '';
  if (line.includes('id="view-') || line.toLowerCase().includes('modal') || line.toLowerCase().includes('drawer') || line.includes('<!-- ==') || line.includes('<script')) {
    console.log(`Line ${i + 1}: ${line.trim().slice(0, 100)}`);
  }
}
