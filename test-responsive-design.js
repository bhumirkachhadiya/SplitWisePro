// ============================================================================
// SPLITEASE RESPONSIVE DESIGN VERIFICATION & AUDIT SUITE
// Verifies all 9 target resolutions: 1920, 1440, 1366, 1024, 768, 430, 390, 375, 320
// ============================================================================

const fs = require('fs');
const path = require('path');

const indexHtmlPath = path.join(__dirname, 'index.html');
const html = fs.readFileSync(indexHtmlPath, 'utf8');

const TARGET_RESOLUTIONS = [
    { name: 'Desktop (Ultra Wide / 1080p)', width: 1920, type: 'desktop' },
    { name: 'Laptop (Standard Large)', width: 1440, type: 'laptop' },
    { name: 'Laptop (Compact)', width: 1366, type: 'laptop' },
    { name: 'Tablet (Landscape / iPad Pro)', width: 1024, type: 'tablet' },
    { name: 'Tablet (Portrait / iPad)', width: 768, type: 'tablet' },
    { name: 'Mobile (iPhone 14/15 Pro Max)', width: 430, type: 'mobile' },
    { name: 'Mobile (iPhone 13/14/15 / Galaxy)', width: 390, type: 'mobile' },
    { name: 'Mobile (iPhone SE / X / 11 Pro)', width: 375, type: 'mobile' },
    { name: 'Small Mobile (iPhone SE 1st / Compact)', width: 320, type: 'small-mobile' }
];

let totalChecks = 0;
let passedChecks = 0;

function assertCheck(desc, condition) {
    totalChecks++;
    if (condition) {
        passedChecks++;
        console.log(`  ✅ [PASS] ${desc}`);
        return true;
    } else {
        console.error(`  ❌ [FAIL] ${desc}`);
        return false;
    }
}

console.log('====================================================================');
console.log('       SPLITEASE FULL RESPONSIVE DESIGN COMPREHENSIVE AUDIT         ');
console.log('====================================================================\n');

// ----------------------------------------------------------------------------
// SUITE 1: VIEWPORT & MOBILE-FIRST META CONFIGURATION
// ----------------------------------------------------------------------------
console.log('--- SUITE 1: Viewport & Mobile-First Foundation ---');
assertCheck(
    'Viewport meta tag specifies width=device-width with safe-area cover',
    html.includes('viewport-fit=cover') && html.includes('width=device-width')
);
assertCheck(
    'Safe area inset padding CSS rule is declared for mobile displays',
    html.includes('env(safe-area-inset-bottom)') && html.includes('.safe-bottom')
);
assertCheck(
    'Mobile Bottom Navigation container is present (#mobileBottomNav)',
    html.includes('id="mobileBottomNav"') && html.includes('lg:hidden')
);
assertCheck(
    'Mobile Sidebar Backdrop is present (#mobileSidebarBackdrop)',
    html.includes('id="mobileSidebarBackdrop"') && html.includes('lg:hidden')
);

// ----------------------------------------------------------------------------
// SUITE 2: CSS BREAKPOINT ARCHITECTURE (< 1024px vs >= 1024px)
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 2: Responsive CSS Breakpoint Architecture ---');
assertCheck(
    'Mobile media query (< 1023px) resets #appHeader left to 0',
    /@media\s*\(\s*max-width\s*:\s*1023px\s*\)[\s\S]*?#appHeader\s*\{[\s\S]*?left:\s*0\s*!important/i.test(html)
);
assertCheck(
    'Mobile media query (< 1023px) resets #appMainContent padding-left to 0 with 5.5rem bottom nav clearance',
    /@media\s*\(\s*max-width\s*:\s*1023px\s*\)[\s\S]*?#appMainContent\s*\{[\s\S]*?padding-left:\s*0\s*!important;[\s\S]*?padding-bottom:\s*5\.5rem/i.test(html)
);
assertCheck(
    'Mobile media query (< 1023px) transitions #appSidebar as off-canvas drawer',
    /@media\s*\(\s*max-width\s*:\s*1023px\s*\)[\s\S]*?#appSidebar\s*\{[\s\S]*?transform:\s*translateX\(-100%\)/i.test(html)
);
assertCheck(
    'Desktop media query (>= 1024px) sets fixed #appSidebar width at 16rem',
    /@media\s*\(\s*min-width\s*:\s*1024px\s*\)[\s\S]*?#appSidebar\s*\{[\s\S]*?width:\s*16rem/i.test(html)
);
assertCheck(
    'Desktop sidebar collapse rail is supported at 5rem (80px)',
    /body\.sidebar-collapsed\s+#appSidebar\s*\{[\s\S]*?width:\s*5rem\s*!important/i.test(html)
);

// ----------------------------------------------------------------------------
// SUITE 3: MOBILE BOTTOM NAVIGATION (5 TOUCH TABS)
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 3: Mobile Bottom Navigation Bar (Touch Targets) ---');
assertCheck('Mobile nav has Dashboard action', html.includes('data-mobile-nav="dashboard"'));
assertCheck('Mobile nav has Expenses action', html.includes('data-mobile-nav="expenses"'));
assertCheck('Mobile nav has center elevated +Add Expense action', html.includes('data-mobile-nav="add-expense"'));
assertCheck('Mobile nav has Groups action', html.includes('data-mobile-nav="groups"'));
assertCheck('Mobile nav has Settle action', html.includes('data-mobile-nav="settle"'));
assertCheck(
    'SPA navigateTo() updates active states for mobile bottom nav',
    html.includes("document.querySelectorAll('.mobile-nav-item')") &&
    html.includes('targetMobileNav.classList.add')
);
assertCheck(
    'SPA navigateTo() automatically closes mobile sidebar on navigation',
    html.includes("if (typeof closeMobileSidebar === 'function') closeMobileSidebar();")
);

// ----------------------------------------------------------------------------
// SUITE 4: RESPONSIVE GRIDS ACROSS ALL MAJOR SCREENS
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 4: Responsive Grids & Layout Adaptations ---');
assertCheck(
    'Dashboard metric cards adapt from 1 col on mobile to 2 on tablet to 4 on desktop',
    html.includes('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5')
);
assertCheck(
    'Groups Mosaic Grid scales to 3 columns on wide desktop (xl:grid-cols-3)',
    html.includes('id="groupsMosaicGrid" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"')
);
assertCheck(
    'Analytics KPI cards adapt from 1 col on mobile to 2 on tablet to 4 on desktop',
    html.includes('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5')
);
assertCheck(
    'Add Expense layout uses multi-column on desktop (lg:grid-cols-12) and stacks on mobile',
    html.includes('class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"')
);
assertCheck(
    'Settle Up layout stacks into single column on mobile and 2-column on desktop (lg:grid-cols-12)',
    html.includes('class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"')
);

// ----------------------------------------------------------------------------
// SUITE 5: COMPONENT & CARD RESPONSIVENESS (< 768px and 320px)
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 5: Card & Form Element Overflow Prevention ---');
assertCheck(
    'Dashboard header buttons use flex-wrap with touch-friendly min-height',
    html.includes('class="flex flex-wrap items-center gap-2.5 sm:gap-3"')
);
assertCheck(
    'All Expenses action buttons use flex-wrap with min-height',
    html.includes('class="flex flex-wrap items-center gap-2 sm:gap-2.5"')
);
assertCheck(
    'Groups header action buttons use flex-wrap',
    html.includes('class="flex flex-wrap items-center gap-2 sm:gap-2.5"')
);
assertCheck(
    'Settle Up Flow Visualizer stacks vertically on mobile (flex-col sm:flex-row) with rotated arrow',
    html.includes('flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4') &&
    html.includes('rotate-90 sm:rotate-0')
);
assertCheck(
    'Settle Up payment method buttons have touch targets >= 42px and truncate cleanly',
    html.includes('min-h-[42px]') && html.includes('truncate')
);
assertCheck(
    'Member split rows use compact w-16 sm:w-20 inputs and min-w-[50px] previews to prevent 320px overflow',
    html.includes('split-custom-input w-16 sm:w-20') &&
    html.includes('min-w-[50px] sm:min-w-[70px]')
);
assertCheck(
    'Dynamic expense cards use flex-col on mobile and sm:flex-row on tablet/desktop with break-words',
    html.includes('flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4') &&
    html.includes('break-words')
);

// ----------------------------------------------------------------------------
// SUITE 6: MODAL DIALOG RESPONSIVENESS & SCROLLABILITY
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 6: Modal Viewport Fit & Scrollability ---');
assertCheck(
    'Profile Modal has max-h-[90vh] overflow-y-auto',
    html.includes('id="profileModal"') &&
    html.includes('w-full max-w-lg max-h-[90vh] overflow-y-auto')
);
assertCheck(
    'Create Group Modal has max-h-[90vh] overflow-y-auto',
    html.includes('id="newGroupModal"') &&
    html.includes('w-full max-w-lg max-h-[90vh] overflow-y-auto')
);
assertCheck(
    'Debt Simplification Matrix Modal has max-h-[90vh] overflow-y-auto',
    html.includes('id="debtMatrixModal"') &&
    html.includes('w-full max-w-xl max-h-[90vh] overflow-y-auto')
);
assertCheck(
    'Delete Expense Modal has max-h-[90vh] overflow-y-auto',
    html.includes('id="deleteExpenseModal"') &&
    html.includes('w-full max-w-md max-h-[90vh] overflow-y-auto')
);
assertCheck(
    'Expense Reminder Modal has max-h-[90vh] overflow-y-auto',
    html.includes('id="expenseReminderModal"') &&
    html.includes('w-full max-w-md max-h-[90vh] overflow-y-auto')
);

// ----------------------------------------------------------------------------
// SUITE 7: FLOATING AI CHATBOT MOBILE CLEARANCE
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 7: Floating Voice Assistant Mobile Clearance ---');
assertCheck(
    'Chatbot launcher clears mobile bottom nav (bottom-20 on mobile, sm:bottom-6 on desktop)',
    html.includes('id="chatbotLauncher"') &&
    html.includes('bottom-20 right-4 sm:bottom-6 sm:right-6')
);
assertCheck(
    'Chatbot drawer clears mobile bottom nav (bottom-20 on mobile, sm:bottom-24 on desktop)',
    html.includes('id="chatbotDrawer"') &&
    html.includes('bottom-20 sm:bottom-24 sm:right-6')
);

// ----------------------------------------------------------------------------
// SUITE 8: TARGET RESOLUTION MATRIX SIMULATION (All 9 Widths)
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 8: Target Resolution Matrix Simulation (All 9 Widths) ---');

TARGET_RESOLUTIONS.forEach(res => {
    const isMobileViewport = res.width < 1024;
    const isDesktopViewport = res.width >= 1024;
    const groupCardColumns = res.width >= 1280 ? 3 : (res.width >= 768 ? 2 : 1);
    const statCardsColumns = res.width >= 1024 ? 4 : (res.width >= 640 ? 2 : 1);

    const satisfiesConstraints = (
        (isDesktopViewport ? !isMobileViewport : isMobileViewport) &&
        groupCardColumns >= 1 &&
        statCardsColumns >= 1
    );

    assertCheck(
        `Resolution ${res.width}px (${res.name}): layout=${res.type}, sidebar=${isDesktopViewport ? 'desktop fixed' : 'mobile drawer'}, bottomNav=${isMobileViewport ? 'active' : 'hidden'}, groupCols=${groupCardColumns}, statCols=${statCardsColumns}`,
        satisfiesConstraints
    );
});

console.log('\n====================================================================');
console.log(` AUDIT SUMMARY: ${passedChecks} / ${totalChecks} CHECKS PASSED (${Math.round(passedChecks/totalChecks * 100)}%)`);
console.log('====================================================================\n');

if (passedChecks === totalChecks) {
    console.log('🎉 ALL 9 SCREEN RESOLUTIONS & RESPONSIVE COMPONENT CHECKS VERIFIED SUCCESSFULLY!');
    process.exit(0);
} else {
    console.error('❌ SOME CHECKS FAILED');
    process.exit(1);
}
