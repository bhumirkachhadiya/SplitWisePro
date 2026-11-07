const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');

const rae = content.indexOf('function renderAllExpenses(');
if (rae !== -1) {
  console.log(content.slice(rae, rae + 4000));
}
