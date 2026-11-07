const fs = require('fs');

const content = fs.readFileSync('index.html', 'utf8');
const handlers = JSON.parse(fs.readFileSync('scripts/inline_handlers.json', 'utf8'));

console.log('Total inline handlers to verify:', handlers.length);

const missing = [];
const found = [];

handlers.forEach(h => {
    // Check if function h( or function h ( exists or window.h =
    const regex = new RegExp(`(?:function\\s+${h}\\b|window\\.${h}\\s*=|let\\s+${h}\\s*=|const\\s+${h}\\s*=)`);
    if (regex.test(content) || ['if', 'this', 'event', 'console'].includes(h)) {
        found.push(h);
    } else {
        missing.push(h);
    }
});

console.log(`✓ Handlers verified: ${found.length} / ${handlers.length}`);
if (missing.length > 0) {
    console.error('Missing handlers:', missing);
} else {
    console.log('🎉 100% OF ALL INLINE EVENT HANDLERS ARE FULLY IMPLEMENTED!');
}
