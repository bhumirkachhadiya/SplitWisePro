const fs = require('fs');
const content = fs.readFileSync(__dirname + '/../index.html.backup', 'utf8');

const idx = content.indexOf('renderAllExpenses(');
if (idx !== -1) {
    fs.writeFileSync(__dirname + '/render-expenses.txt', content.slice(idx, idx + 4000), 'utf8');
    console.log('Found renderAllExpenses');
} else {
    console.log('Not found');
}
process.exit(0);
