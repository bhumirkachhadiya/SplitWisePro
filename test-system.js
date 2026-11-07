const fs = require('fs');

console.log('--- 1. Scanning index.html for alert() or confirm() calls ---');
const html = fs.readFileSync('index.html', 'utf8');
const lines = html.split('\n');
let alertsFound = 0;
lines.forEach((l, i) => {
  // Ignore comments or text that is not a function call
  if (/\b(alert|confirm)\s*\(/.test(l)) {
    // Check if line is comment
    const trimmed = l.trim();
    if (!trimmed.startsWith('//') && !trimmed.startsWith('/*')) {
      console.log(`Alert/Confirm at line ${i + 1}: ${trimmed}`);
      alertsFound++;
    }
  }
});
if (alertsFound === 0) {
  console.log('PASS: Zero alert() and confirm() calls found in index.html!');
} else {
  console.log(`FAIL: ${alertsFound} alert/confirm calls found.`);
}

console.log('\n--- 2. Scanning index.html for mentions of postgres / postgresql in user-visible strings ---');
let pgMentions = 0;
lines.forEach((l, i) => {
  // Check if postgres is shown to users
  if (/postgres/i.test(l)) {
    console.log(`Postgres mention at line ${i + 1}: ${l.trim()}`);
    pgMentions++;
  }
});
console.log(`Total mentions of postgres in index.html: ${pgMentions}`);
