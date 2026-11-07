const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');

const rg = content.indexOf('function renderGroups');
if (rg !== -1) {
  console.log(content.slice(rg, rg + 4000));
}
