const fs = require('fs');

/**
 * REDESIGNED MODALS MODULE
 * Restyles all 11 modals with the Quantum Design System
 * Preserves all element IDs and inline handlers.
 */
function getModalsHtml() {
    const content = fs.readFileSync('index.html.backup', 'utf8');
    const startIdx = content.indexOf('<!-- ============================================================== -->\n    <!-- MODALS: USER PROFILE & SETTINGS MODAL');
    const endIdx = content.indexOf('<!-- CHATBOT DRAWER (Protected against Cyber Attacks / XSS) -->');
    
    if (startIdx === -1 || endIdx === -1) {
        throw new Error('Could not find boundaries for modals in backup file');
    }
    
    let modalsRaw = content.slice(startIdx, endIdx);

    // Apply Quantum Design System classes and styling
    modalsRaw = modalsRaw
        // Backdrop and container styling
        .replace(/bg-black\/50 backdrop-blur-xs/g, 'bg-black/60 backdrop-blur-md')
        .replace(/bg-surface-container-lowest/g, 'qw-glass')
        .replace(/rounded-2xl/g, 'rounded-3xl')
        .replace(/border-outline-variant\/30/g, 'border-outline-variant')
        .replace(/border-outline-variant\/40/g, 'border-outline-variant')
        .replace(/border-outline-variant\/20/g, 'border-outline-variant')
        // Input styling
        .replace(/bg-surface-container-low border border-outline-variant\/[0-9]+ text-on-surface text-sm focus:outline-none focus:border-primary/g, 'qw-input')
        .replace(/bg-surface-container-low border border-outline-variant\/[0-9]+ text-on-surface text-xs focus:outline-none focus:border-primary/g, 'qw-input')
        // Button styling
        .replace(/btn-press px-4 py-2 rounded-xl bg-primary text-on-primary font-bold text-xs shadow-xs/g, 'qw-btn qw-btn-primary text-xs')
        .replace(/px-4 py-2 rounded-xl bg-primary text-white text-xs font-bold shadow-xs/g, 'qw-btn qw-btn-primary text-xs')
        .replace(/px-5 py-2\.5 rounded-xl bg-primary text-white text-xs font-bold shadow-sm/g, 'qw-btn qw-btn-primary text-xs')
        .replace(/px-4 py-2\.5 rounded-xl bg-primary text-white text-xs font-bold shadow-sm/g, 'qw-btn qw-btn-primary text-xs')
        .replace(/px-4 py-2 rounded-xl text-xs font-bold text-on-surface-variant hover:bg-surface-container/g, 'qw-btn qw-btn-secondary text-xs')
        .replace(/px-4 py-2\.5 rounded-xl text-xs font-bold text-on-surface-variant hover:bg-surface-container/g, 'qw-btn qw-btn-secondary text-xs')
        .replace(/px-4 py-2 rounded-xl bg-error text-white font-bold text-xs shadow-xs/g, 'qw-btn qw-btn-danger text-xs')
        .replace(/px-5 py-2\.5 rounded-xl bg-error text-white font-bold text-xs shadow-sm/g, 'qw-btn qw-btn-danger text-xs')
        // Ensure integer step on amount inputs in modals
        .replace(/id="editExpAmount" type="number" step="0\.01"/g, 'id="editExpAmount" type="number" step="1"')
        .replace(/id="correctionExpAmount" type="number" step="0\.01"/g, 'id="correctionExpAmount" type="number" step="1"');

    return modalsRaw;
}

module.exports = { getModalsHtml };
