const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');

const matches = [...content.matchAll(/openManageMembersModal|manageMembersModal|renderManageMembersList/g)];
console.log('Matches in index.html:', matches.length);
matches.forEach(m => {
  const start = Math.max(0, m.index - 50);
  const end = Math.min(content.length, m.index + 500);
  console.log('--- MANAGE MEMBERS MATCH ---');
  console.log(content.slice(start, end));
});
