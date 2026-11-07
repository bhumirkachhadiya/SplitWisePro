const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');
const lines = content.split('\n');

for (let i = 2812; i < lines.length; i++) {
  const line = lines[i];
  if (line.match(/function\s+[a-zA-Z0-9_]*chat[a-zA-Z0-9_]*\s*\(/i) || line.match(/function\s+[a-zA-Z0-9_]*toast[a-zA-Z0-9_]*\s*\(/i)) {
    console.log(`Line ${i + 1}: ${line.trim().slice(0, 80)}`);
  }
}
