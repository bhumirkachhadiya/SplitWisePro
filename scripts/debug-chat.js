const fs = require('fs');
const content = fs.readFileSync('server.js', 'utf8');
const lines = content.split('\n');
lines.forEach((l, i) => {
    if (l.includes("app.post('/api/groups") || l.includes('INSERT INTO groups') || l.includes('chat_conversations')) {
        console.log(`${i + 1}: ${l.trim()}`);
    }
});
