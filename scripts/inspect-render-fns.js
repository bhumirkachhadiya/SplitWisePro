const fs = require('fs');
const content = fs.readFileSync('index.html.backup', 'utf8');
const lines = content.split('\n');

function inspectFn(name, maxLines = 40) {
  const idx = lines.findIndex(l => l.includes(`function ${name}(`) || l.includes(`async function ${name}(`));
  if (idx === -1) {
    console.log(`Function ${name} not found`);
    return;
  }
  console.log(`\n=================== FUNCTION ${name} (Line ${idx + 1}) ===================`);
  console.log(lines.slice(idx, idx + maxLines).join('\n'));
}

inspectFn('renderDashboardRecentList', 35);
inspectFn('renderAllExpenses', 45);
inspectFn('renderGroups', 45);
inspectFn('renderFriendsData', 35);
inspectFn('renderSettleUp', 45);
