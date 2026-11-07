const fs = require('fs');

const content = fs.readFileSync('index.html', 'utf8');

// Find all view IDs
const viewMatches = content.match(/id=["'](view-[^"']+)["']/g) || [];
console.log('=== VIEWS (' + viewMatches.length + ') ===');
viewMatches.forEach(m => console.log(' ', m));

// Find all modal IDs
const modalMatches = content.match(/id=["']([^"']*(?:modal|drawer|dialog)[^"']*)["']/gi) || [];
console.log('\n=== MODALS / DRAWERS (' + modalMatches.length + ') ===');
modalMatches.forEach(m => console.log(' ', m));

// Find main structural elements (sidebar, nav, header, main)
console.log('\n=== STRUCTURE CHECKS ===');
console.log('Has sidebar:', content.includes('id="sidebar"') || content.includes('id="mainSidebar"'));
console.log('Has header / topbar:', content.includes('<header') || content.includes('id="topbar"') || content.includes('id="mainHeader"'));

// Find lines where views are defined
const lines = content.split('\n');
console.log('\n=== VIEW LINE RANGES ===');
lines.forEach((line, idx) => {
    if (line.includes('id="view-') || line.includes('class="view-panel')) {
        console.log(`Line ${idx + 1}: ${line.trim().slice(0, 100)}`);
    }
});
