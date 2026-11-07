const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');

const start = content.indexOf('id="view-groups"');
console.log('view-groups index:', start);
if (start !== -1) {
  console.log(content.slice(start, start + 3000));
}

// Find renderGroups function
const rg = content.indexOf('function renderGroups');
console.log('function renderGroups index:', rg);
if (rg !== -1) {
  console.log(content.slice(rg, rg + 2500));
}
