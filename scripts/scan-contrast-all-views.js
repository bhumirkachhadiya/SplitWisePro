const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const lines = html.split('\n');

const findings = {
    bgWhiteWithLightText: [],
    hardcodedDarkTextOnElevated: [],
    hardcodedWhiteTextOnLight: [],
    hardcodedBgWhiteContainers: [],
    missingDarkHover: []
};

lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const l = line.trim();

    // Check 1: bg-white without dark:bg where text-on-surface or light text is used
    if (l.includes('bg-white') && !l.includes('dark:bg-') && !l.includes('bg-white/[') && !l.includes('bg-white/')) {
        if (l.includes('text-on-surface') || l.includes('text-white') || l.includes('text-slate-100')) {
            findings.bgWhiteWithLightText.push({ lineNum, content: l });
        } else {
            findings.hardcodedBgWhiteContainers.push({ lineNum, content: l });
        }
    }

    // Check 2: hardcoded dark text (text-slate-900, text-black, text-gray-900, text-slate-800)
    // inside elements without dark:text- that also don't have bg-white or light bg
    if ((l.includes('text-slate-900') || l.includes('text-black') || l.includes('text-gray-900')) && 
        !l.includes('dark:text-') && 
        !l.includes('bg-white') && 
        !l.includes('bg-slate') && 
        !l.includes('bg-gray')) {
        findings.hardcodedDarkTextOnElevated.push({ lineNum, content: l });
    }

    // Check 3: text-white on light bg without dark wrapper
    if (l.includes('text-white') && (l.includes('bg-slate-100') || l.includes('bg-gray-100') || l.includes('bg-slate-50'))) {
        findings.hardcodedWhiteTextOnLight.push({ lineNum, content: l });
    }
});

console.log('=== COMPREHENSIVE VIEW CONTRAST AUDIT ===');
console.log('1. bg-white with text-on-surface/light text (CRITICAL INVISIBLE TEXT IN DARK MODE):', findings.bgWhiteWithLightText.length);
findings.bgWhiteWithLightText.forEach(f => console.log(`   Line ${f.lineNum}: ${f.content.substring(0, 110)}`));

console.log('\n2. Other hardcoded bg-white elements without dark:bg:', findings.hardcodedBgWhiteContainers.length);
findings.hardcodedBgWhiteContainers.slice(0, 30).forEach(f => console.log(`   Line ${f.lineNum}: ${f.content.substring(0, 110)}`));

console.log('\n3. Hardcoded dark text (text-slate-900/text-black) without dark:text override:', findings.hardcodedDarkTextOnElevated.length);
findings.hardcodedDarkTextOnElevated.forEach(f => console.log(`   Line ${f.lineNum}: ${f.content.substring(0, 110)}`));
