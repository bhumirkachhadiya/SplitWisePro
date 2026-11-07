const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');

const idx = content.indexOf('renderSelectedTemplateInEditor');
console.log('renderSelectedTemplateInEditor index:', idx);
if (idx !== -1) {
  console.log(content.slice(idx - 200, idx + 1800));
}
