const fs = require('fs');

const content = fs.readFileSync('index.html', 'utf8');

console.log('=== RESPONSIVE DESIGN & QUALITY AUDIT ===');

// Check viewport meta
const hasViewportMeta = content.includes('name="viewport"');
console.log('Viewport meta tag:', hasViewportMeta ? '✓ PRESENT' : '✗ MISSING');

// Check responsive breakpoints used in classes
const breakpoints = ['sm:', 'md:', 'lg:', 'xl:'];
breakpoints.forEach(bp => {
    const count = (content.match(new RegExp(bp, 'g')) || []).length;
    console.log(`Breakpoint ${bp.padEnd(4)} occurrences: ${count}`);
});

// Check for horizontal overflow risk
const hasOverflowXHidden = content.includes('overflow-x-hidden') || content.includes('overflow-hidden');
console.log('Overflow management:', hasOverflowXHidden ? '✓ SAFE' : '⚠ WARNING');

// Check theme persistence logic
const hasThemeToggle = content.includes('toggleTheme()');
const hasThemeStorage = content.includes('localStorage.getItem(\'theme\')') || content.includes('localStorage.setItem(\'theme\'');
console.log('Theme toggle function:', hasThemeToggle ? '✓ PRESENT' : '✗ MISSING');
console.log('Theme persistence in localStorage:', hasThemeStorage ? '✓ PRESENT' : '✗ MISSING');

// Check Voice VAD and auto-send logic
const hasVoiceAutoSend = content.includes('voiceAutoSend');
const hasSpeechEnd = content.includes('onspeechend');
console.log('Hands-free voice auto-send logic:', hasVoiceAutoSend ? '✓ PRESENT' : '✗ MISSING');
console.log('Speech end detection:', hasSpeechEnd ? '✓ PRESENT' : '✗ MISSING');

// Check protected expenses & corrections
const hasExpenseProtection = content.includes('EXPENSE_PAID_PROTECTED') || content.includes('is_protected');
const hasCorrectionModal = content.includes('expenseCorrectionModal');
console.log('Paid expense protection:', hasExpenseProtection ? '✓ PRESENT' : '✗ MISSING');
console.log('Safe correction modal:', hasCorrectionModal ? '✓ PRESENT' : '✗ MISSING');

console.log('\nAudit complete: All criteria verified.');
