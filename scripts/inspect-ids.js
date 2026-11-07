const fs = require('fs');

const content = fs.readFileSync('index.html', 'utf8');

// Extract all getElementById
const getElemMatches = [...content.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
const uniqueElemIds = [...new Set(getElemMatches)].sort();
console.log('Unique getElementById references:', uniqueElemIds.length);
fs.writeFileSync('scripts/referenced_element_ids.json', JSON.stringify(uniqueElemIds, null, 2));

// Extract all onclick / onchange / onsubmit handlers in HTML
const handlers = [...content.matchAll(/on(?:click|submit|change|keyup|keydown|input)=['"]([^'"]+)['"]/g)].map(m => m[1]);
const uniqueHandlers = [...new Set(handlers.map(h => h.split('(')[0].trim()))].sort();
console.log('Unique inline event handlers:', uniqueHandlers.length);
fs.writeFileSync('scripts/inline_handlers.json', JSON.stringify(uniqueHandlers, null, 2));

// Check where scripts start
const scriptTagIndex = content.lastIndexOf('<script>');
console.log('Main script starts around byte:', scriptTagIndex);
const scriptMatches = [...content.matchAll(/<script\b[^>]*>/gi)];
console.log('Number of script tags:', scriptMatches.length);
scriptMatches.forEach((m, i) => console.log(`Script ${i}: index ${m.index}`));
