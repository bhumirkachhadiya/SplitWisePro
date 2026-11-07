const fs = require('fs');

const content = fs.readFileSync('index.html', 'utf8');
const referencedIds = JSON.parse(fs.readFileSync('scripts/referenced_element_ids.json', 'utf8'));

console.log('Total referenced IDs to verify:', referencedIds.length);

const missing = [];
const found = [];

referencedIds.forEach(id => {
    // Check if id="..." or id='...' exists
    const regex = new RegExp(`id=["']${id}["']`);
    if (regex.test(content)) {
        found.push(id);
    } else {
        missing.push(id);
    }
});

console.log(`✓ Found: ${found.length} / ${referencedIds.length} (${((found.length/referencedIds.length)*100).toFixed(1)}%)`);

if (missing.length > 0) {
    console.error(`✗ Missing ${missing.length} IDs:`, missing);
} else {
    console.log('🎉 100% OF ALL REFERENCED DOM ELEMENT IDS ARE PRESENT!');
}
