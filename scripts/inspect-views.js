const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');

const views = [
  'view-dashboard',
  'view-expenses',
  'view-add-expense',
  'view-groups',
  'view-friends',
  'view-settle',
  'view-analytics',
  'view-activity',
  'view-chat'
];

views.forEach(v => {
  const start = content.indexOf(`id="${v}"`);
  if (start !== -1) {
    const end = content.indexOf('id="view-', start + 10);
    const slice = end !== -1 ? content.slice(start, end) : content.slice(start, start + 2000);
    const lineCount = slice.split('\n').length;
    console.log(`View ${v}: start char ${start}, length ${slice.length}, lines ~${lineCount}`);
  }
});

// Also check modals start and end
const modalStart = content.indexOf('<!-- Modals');
console.log('Modals section start index:', modalStart);
