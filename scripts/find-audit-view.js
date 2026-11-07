const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');

const lines = content.split('\n');
lines.forEach((l, idx) => {
  if (l.includes('view-activity') || l.includes('loadAuditLogs') || l.includes('renderActivity') || l.includes('auditLog') || l.includes('adminAudit')) {
    console.log(`${idx + 1}: ${l.trim()}`);
  }
});
