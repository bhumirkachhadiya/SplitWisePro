const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');
const lines = content.split('\n');

const renderFunctions = [];
for (let i = 2812; i < lines.length; i++) {
  const line = lines[i];
  const fnMatch = line.match(/function\s+([a-zA-Z0-9_]*render[a-zA-Z0-9_]*|[a-zA-Z0-9_]*load[a-zA-Z0-9_]*|[a-zA-Z0-9_]*populate[a-zA-Z0-9_]*|[a-zA-Z0-9_]*display[a-zA-Z0-9_]*)\s*\(/i);
  if (fnMatch) {
    renderFunctions.push({ line: i + 1, name: fnMatch[1] });
  }
}
console.log('Found render/populate/display functions:', renderFunctions.length);
renderFunctions.forEach(f => console.log(`Line ${f.line}: ${f.name}`));
