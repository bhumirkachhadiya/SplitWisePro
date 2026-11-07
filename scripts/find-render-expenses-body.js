const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');

const re = content.indexOf('function renderExpenses');
console.log('renderExpenses index:', re);
if (re !== -1) {
  console.log(content.slice(re, re + 3500));
}
