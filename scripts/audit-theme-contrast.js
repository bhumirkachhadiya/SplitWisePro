const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const lines = html.split('\n');

const focusWhiteLines = [];
const bgWhiteInputLines = [];
const textContrastIssues = [];

lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    if (line.includes('focus:bg-white')) {
        focusWhiteLines.push({ lineNum, content: line.trim() });
    }
    if ((line.includes('<input') || line.includes('<select') || line.includes('<textarea')) && line.includes('bg-white') && !line.includes('dark:bg-')) {
        bgWhiteInputLines.push({ lineNum, content: line.trim() });
    }
    // Check for dark text without dark: text in elements
    if (line.includes('text-slate-900') && !line.includes('dark:text-') && !line.includes('<body') && !line.includes('bg-white')) {
        textContrastIssues.push({ lineNum, type: 'text-slate-900', content: line.trim() });
    }
    if (line.includes('text-slate-800') && !line.includes('dark:text-') && !line.includes('bg-white')) {
        textContrastIssues.push({ lineNum, type: 'text-slate-800', content: line.trim() });
    }
    if (line.includes('text-slate-700') && !line.includes('dark:text-') && !line.includes('bg-white')) {
        textContrastIssues.push({ lineNum, type: 'text-slate-700', content: line.trim() });
    }
});

console.log('=== THEME CONTRAST AUDIT RESULTS ===');
console.log('1. focus:bg-white instances:', focusWhiteLines.length);
focusWhiteLines.forEach(f => console.log(`   Line ${f.lineNum}: ${f.content.substring(0, 100)}`));

console.log('\n2. bg-white inputs/selects/textareas:', bgWhiteInputLines.length);
bgWhiteInputLines.forEach(f => console.log(`   Line ${f.lineNum}: ${f.content.substring(0, 100)}`));

console.log('\n3. Potential un-themed dark text on dark canvas:', textContrastIssues.length);
textContrastIssues.slice(0, 20).forEach(f => console.log(`   Line ${f.lineNum} [${f.type}]: ${f.content.substring(0, 100)}`));
