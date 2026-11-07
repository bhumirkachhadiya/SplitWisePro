const fs = require('fs');
const content = fs.readFileSync('server.js', 'utf8');

const lines = content.split('\n');
lines.forEach((l, idx) => {
  if (l.includes('/api/chat') || l.includes('chat_conversations') || l.includes('chat_messages')) {
    console.log(`${idx + 1}: ${l.trim()}`);
  }
});
