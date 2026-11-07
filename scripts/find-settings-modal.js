const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');

const idx = content.indexOf('function openSettingsModal');
console.log('openSettingsModal index:', idx);
if (idx !== -1) {
  console.log(content.slice(idx, idx + 1500));
}

const idxTab = content.indexOf('switchSettingsTab');
console.log('switchSettingsTab index:', idxTab);
if (idxTab !== -1) {
  console.log(content.slice(idxTab - 50, idxTab + 1500));
}
