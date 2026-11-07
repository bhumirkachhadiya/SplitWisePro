/**
 * NAVIGATION SHELL (Sidebar, Top Command Header, Mobile Drawer)
 * Linear & Vercel inspired floating layout architecture.
 */
function getNavigationShellHtml(viewsContent, modalsContent) {
    return `
    <!-- ============================================================== -->
    <!-- 2. MAIN APPLICATION WORKSPACE SHELL                            -->
    <!-- ============================================================== -->
    <div id="appWorkspace" class="hidden min-h-screen bg-surface">
        
        <!-- Mobile Sidebar Backdrop -->
        <div id="mobileSidebarBackdrop" onclick="closeMobileSidebar()" class="hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-50 lg:hidden transition-opacity"></div>

        <!-- FLOATING EXECUTIVE SIDEBAR -->
        <aside id="appSidebar" class="fixed left-0 top-0 h-full w-64 bg-surface-container-lowest border-r border-outline-variant z-50 flex flex-col justify-between transition-all duration-300">
            <div class="flex flex-col flex-1 overflow-y-auto">
                
                <!-- Brand Area -->
                <div class="h-16 px-3 flex items-center justify-between border-b border-outline-variant sidebar-brand-header">
                    <!-- Brand (Expanded state) -->
                    <div class="flex items-center gap-3 cursor-pointer min-w-0 sidebar-brand-content" onclick="navigateTo('dashboard')" title="Go to Dashboard">
                        <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 p-[1px] shadow-sm flex-shrink-0">
                            <div class="w-full h-full bg-[#090b10] rounded-[11px] flex items-center justify-center text-emerald-400">
                                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                                </svg>
                            </div>
                        </div>
                        <div class="flex flex-col sidebar-text min-w-0">
                            <span class="text-base font-extrabold tracking-tight text-on-surface truncate flex items-center gap-1.5">
                                SplitWise <span class="px-1 py-0.2 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">PRO</span>
                            </span>
                        </div>
                    </div>
                    <!-- Desktop Collapse / Expand Toggle -->
                    <button id="sidebarCollapseBtn" onclick="toggleSidebarCollapse()" class="hidden lg:flex p-2 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all flex-shrink-0" title="Toggle Sidebar (Ctrl+B)">
                        <span class="material-symbols-outlined text-[20px]" id="sidebarCollapseIcon">dock_to_left</span>
                    </button>
                    <!-- Mobile Close Button -->
                    <button onclick="closeMobileSidebar()" class="lg:hidden p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" title="Close Menu">
                        <span class="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>

                <!-- Action Button: Add Expense -->
                <div class="p-3">
                    <button onclick="navigateTo('add-expense')" class="qw-btn qw-btn-primary w-full py-2.5 px-3 rounded-xl text-xs font-bold shadow-sm justify-between sidebar-collapsed-center" title="Add New Expense (N)">
                        <div class="flex items-center gap-2">
                            <span class="material-symbols-outlined text-[18px] flex-shrink-0">add</span>
                            <span class="sidebar-text truncate">New Expense</span>
                        </div>
                        <kbd class="sidebar-text px-1.5 py-0.5 rounded bg-black/20 text-white/80 text-[10px] font-mono">N</kbd>
                    </button>
                </div>

                <!-- Navigation Hierarchy -->
                <nav class="flex-1 px-3 flex flex-col gap-5 mt-2">
                    
                    <!-- Core Group -->
                    <div class="flex flex-col gap-1">
                        <div class="px-3 pb-1 sidebar-text">
                            <span class="text-[10px] uppercase tracking-wider text-on-surface-variant/80 font-bold">Workspace</span>
                        </div>
                        <a href="javascript:void(0)" onclick="navigateTo('dashboard')" data-nav="dashboard" class="nav-item flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all sidebar-collapsed-center" title="Dashboard">
                            <span class="material-symbols-outlined text-[19px] flex-shrink-0">grid_view</span>
                            <span class="sidebar-text">Dashboard</span>
                        </a>
                        <a href="javascript:void(0)" onclick="navigateTo('expenses')" data-nav="expenses" class="nav-item flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all sidebar-collapsed-center" title="All Expenses">
                            <span class="material-symbols-outlined text-[19px] flex-shrink-0">receipt_long</span>
                            <span class="sidebar-text">Ledger</span>
                        </a>
                        <a href="javascript:void(0)" onclick="navigateTo('groups')" data-nav="groups" class="nav-item flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all sidebar-collapsed-center" title="Circles & Groups">
                            <span class="material-symbols-outlined text-[19px] flex-shrink-0">pie_chart</span>
                            <span class="sidebar-text">Circles</span>
                        </a>
                        <a href="javascript:void(0)" onclick="navigateTo('friends')" data-nav="friends" class="nav-item flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all sidebar-collapsed-center" title="Friends & Connections">
                            <span class="material-symbols-outlined text-[19px] flex-shrink-0">group</span>
                            <span class="sidebar-text">Friends</span>
                        </a>
                    </div>

                    <!-- Finance Group -->
                    <div class="flex flex-col gap-1">
                        <div class="px-3 pb-1 sidebar-text">
                            <span class="text-[10px] uppercase tracking-wider text-on-surface-variant/80 font-bold">Settlement & Insights</span>
                        </div>
                        <a href="javascript:void(0)" onclick="navigateTo('settle')" data-nav="settle" class="nav-item flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all sidebar-collapsed-center" title="Settle Up">
                            <span class="material-symbols-outlined text-[19px] flex-shrink-0">payments</span>
                            <span class="sidebar-text">Settle Up</span>
                        </a>
                        <a href="javascript:void(0)" onclick="navigateTo('analytics')" data-nav="analytics" class="nav-item flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all sidebar-collapsed-center" title="Analytics">
                            <span class="material-symbols-outlined text-[19px] flex-shrink-0">trending_up</span>
                            <span class="sidebar-text">Analytics</span>
                        </a>
                    </div>

                    <!-- Collaborate & Audit -->
                    <div class="flex flex-col gap-1">
                        <div class="px-3 pb-1 sidebar-text">
                            <span class="text-[10px] uppercase tracking-wider text-on-surface-variant/80 font-bold">Audit & Team</span>
                        </div>
                        <a href="javascript:void(0)" onclick="navigateTo('activity')" data-nav="activity" class="nav-item flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all sidebar-collapsed-center" title="Activity Feed">
                            <span class="material-symbols-outlined text-[19px] flex-shrink-0">history</span>
                            <span class="sidebar-text">Audit Log</span>
                        </a>
                        <a href="javascript:void(0)" onclick="navigateTo('chat')" id="sidebarChatNav" data-nav="chat" class="nav-item hidden flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all sidebar-collapsed-center" title="Discussions">
                            <div class="flex items-center gap-3">
                                <span class="material-symbols-outlined text-[19px] flex-shrink-0">chat_bubble</span>
                                <span class="sidebar-text">Discussions</span>
                            </div>
                            <span id="chatSidebarBadge" class="hidden px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-primary text-white sidebar-text">0</span>
                        </a>
                    </div>

                    <!-- Configuration -->
                    <div class="flex flex-col gap-1 pt-2 border-t border-outline-variant/50">
                        <a href="javascript:void(0)" onclick="openCurrencySettingsModal()" class="nav-item flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all sidebar-collapsed-center" title="Currency Settings">
                            <span class="material-symbols-outlined text-[19px] text-emerald-500 flex-shrink-0">currency_exchange</span>
                            <span class="sidebar-text">Currencies</span>
                        </a>
                        <a href="javascript:void(0)" onclick="openEmailTemplateSettingsModal()" class="nav-item flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all sidebar-collapsed-center" title="Email Templates">
                            <span class="material-symbols-outlined text-[19px] text-indigo-500 flex-shrink-0">mail</span>
                            <span class="sidebar-text">Templates</span>
                        </a>
                    </div>

                    <!-- Platform Governance (Strictly visible only for role === 'master_admin') -->
                    <div id="navGroupMasterAdmin" class="hidden flex flex-col gap-1 pt-2 border-t border-emerald-500/20">
                        <div class="px-3 pb-1 sidebar-text flex items-center justify-between">
                            <span class="text-[10px] uppercase tracking-wider text-primary font-bold">Platform Governance</span>
                            <span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-primary/20 text-primary">ADMIN</span>
                        </div>
                        <a href="javascript:void(0)" onclick="navigateTo('master-admin')" id="sidebarMasterAdminNav" data-nav="master-admin" class="nav-item flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-primary bg-primary/10 hover:bg-primary/20 transition-all sidebar-collapsed-center" title="Master Admin Governance & Issue Tracker">
                            <div class="flex items-center gap-3">
                                <span class="material-symbols-outlined text-[19px] flex-shrink-0">shield_person</span>
                                <span class="sidebar-text font-bold">Master Admin</span>
                            </div>
                            <span id="adminSidebarErrorBadge" class="hidden px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500 text-white sidebar-text">0</span>
                        </a>
                    </div>

                </nav>

            </div>

            <!-- Current User Profile Footer Card -->
            <div class="sidebar-profile-card p-3 m-3 rounded-2xl bg-surface-container border border-outline-variant flex items-center justify-between transition-all">
                <div class="flex items-center gap-2.5 min-w-0 cursor-pointer" onclick="openProfileModal()" title="Account Settings">
                    <div id="navUserAvatar" class="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center flex-shrink-0 text-white font-bold text-xs shadow-xs">
                        U
                    </div>
                    <div class="flex flex-col min-w-0 sidebar-text">
                        <span id="navUserName" class="text-xs font-bold text-on-surface truncate">My Account</span>
                        <span id="navUserEmail" class="text-[10px] font-mono text-on-surface-variant truncate">Connected</span>
                    </div>
                </div>
                <div class="flex items-center gap-1 sidebar-text">
                    <button onclick="openProfileModal()" title="Account Settings" class="w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors">
                        <span class="material-symbols-outlined text-[16px]">settings</span>
                    </button>
                    <button onclick="promptLogout()" title="Logout" class="w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-rose-500 transition-colors">
                        <span class="material-symbols-outlined text-[16px]">logout</span>
                    </button>
                </div>
            </div>
        </aside>

        <!-- FLOATING TOP COMMAND BAR -->
        <header id="appHeader" class="fixed top-0 left-0 lg:left-64 right-0 h-16 qw-glass border-b border-outline-variant z-40 px-4 sm:px-6 flex items-center justify-between gap-4 transition-all duration-300">
            <!-- Left Command & Search -->
            <div class="flex items-center gap-3 flex-1 max-w-lg min-w-0">
                <button id="sidebarToggleBtn" onclick="handleMenuClick()" class="p-2 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors flex-shrink-0" title="Toggle Sidebar (Ctrl+B)">
                    <span class="material-symbols-outlined text-[20px]" id="headerSidebarToggleIcon">menu</span>
                </button>
                
                <div id="masterSearchContainer" class="relative flex items-center flex-1 min-w-0">
                    <button id="masterSearchBtn" onclick="executeMasterSearch()" type="button" class="absolute left-1.5 p-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors z-10 flex items-center justify-center cursor-pointer" title="Execute Search (Enter)">
                        <span class="material-symbols-outlined text-[18px]">search</span>
                    </button>
                    <input id="globalSearchInput" oninput="handleMasterSearchInput(this.value)" onkeydown="handleMasterSearchKeydown(event)" onfocus="handleMasterSearchFocus()" class="qw-input pl-9 pr-14 py-1.5 text-xs rounded-xl w-full" placeholder="Quick search ledger, peers, circles... ('/')" type="text" autocomplete="off"/>
                    <button id="masterSearchClearBtn" onclick="clearMasterSearch()" type="button" class="hidden absolute right-8 p-1 text-on-surface-variant hover:text-on-surface z-10 flex items-center justify-center" title="Clear Search">
                        <span class="material-symbols-outlined text-[14px]">close</span>
                    </button>
                    <kbd class="hidden sm:inline absolute right-2.5 px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant text-[10px] font-mono font-bold">/</kbd>

                    <!-- Live Master Search Dropdown Palette -->
                    <div id="masterSearchDropdown" class="hidden absolute top-full left-0 right-0 mt-2 z-50 qw-card shadow-2xl p-3 max-h-[28rem] overflow-y-auto space-y-2 border border-outline-variant/60 backdrop-blur-xl bg-surface/95 text-xs">
                        <!-- Populated dynamically by updateMasterSearchResults() -->
                    </div>
                </div>
            </div>

            <!-- Right Quick Actions -->
            <div class="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                <!-- Theme Switcher -->
                <button id="themeToggleBtn" onclick="toggleTheme()" class="qw-btn qw-btn-secondary py-1.5 px-2.5 text-xs rounded-xl" title="Toggle Theme (Light / Dark)">
                    <span class="material-symbols-outlined text-[16px] text-amber-500" id="themeToggleIcon">dark_mode</span>
                    <span class="hidden md:inline font-mono text-[11px]" id="themeToggleText">Dark</span>
                </button>

                <!-- Currency Selector Pill -->
                <button id="headerCurrencyChip" onclick="openCurrencySettingsModal()" class="hidden sm:flex qw-btn qw-btn-secondary py-1.5 px-2.5 text-xs rounded-xl font-mono" title="Change Base Currency">
                    <span class="material-symbols-outlined text-[15px] text-emerald-500">currency_exchange</span>
                    <span id="headerCurrencyText">INR (₹)</span>
                </button>

                <!-- Quick Settle Up Button -->
                <button onclick="navigateTo('settle')" class="qw-btn qw-btn-primary py-1.5 px-3 text-xs rounded-xl shadow-xs">
                    <span class="material-symbols-outlined text-[15px]">check</span>
                    <span class="hidden sm:inline">Settle Up</span>
                </button>

                <!-- User Avatar Bubble -->
                <div id="headerUserAvatar" onclick="openProfileModal()" title="View Account" class="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-400 text-white flex items-center justify-center text-xs font-bold shadow-xs cursor-pointer hover:ring-2 hover:ring-primary/40 transition-all flex-shrink-0">
                    AS
                </div>
            </div>
        </header>

        <!-- MAIN WORKSPACE CONTENT CONTAINER -->
        <main id="appMainContent" class="pt-16 min-h-screen bg-surface">
            <div class="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
                ${viewsContent}
            </div>
        </main>

        <!-- MODALS & AI ASSISTANT DRAWER -->
        ${modalsContent}

    </div>
    `;
}

module.exports = { getNavigationShellHtml };
