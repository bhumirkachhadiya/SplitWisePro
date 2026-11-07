/**
 * ==============================================================================
 * MASTER ADMIN GOVERNANCE & GLOBAL ERROR TRACKER VIEW
 * ==============================================================================
 * Comprehensive Platform Administration interface:
 *  - Overview: Key performance indicators, active/disabled users, health, currencies
 *  - User Management: Platform-wide user audit, status toggle (activate/deactivate)
 *  - Global Groups: Inspect all groups, financial spend, member rosters
 *  - Global Financial Monitoring: Cross-circle ledger, currencies, settlements
 *  - System Errors & Issue Tracker: Grouped fingerprints, stack traces, Antigravity prompts
 * ==============================================================================
 */

function getMasterAdminViewHtml() {
    return `
    <!-- ============================================================== -->
    <!-- VIEW 9: MASTER ADMIN GOVERNANCE & ISSUE TRACKER                -->
    <!-- ============================================================== -->
    <div id="view-master-admin" class="hidden view-panel space-y-6">

        <!-- Top Header & Live Health Bar -->
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-3xl bg-surface-container-lowest border border-outline-variant shadow-sm">
            <div class="flex items-center gap-3">
                <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-indigo-500 p-[1px] flex-shrink-0 shadow-md">
                    <div class="w-full h-full bg-[#0a0d14] rounded-[15px] flex items-center justify-center text-emerald-400">
                        <span class="material-symbols-outlined text-[26px]">shield_person</span>
                    </div>
                </div>
                <div>
                    <div class="flex items-center gap-2">
                        <h1 class="text-xl sm:text-2xl font-extrabold text-on-surface tracking-tight">Master Admin Governance</h1>
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-primary/10 text-primary border border-primary/20">SYSTEM ROLE</span>
                    </div>
                    <p class="text-xs text-on-surface-variant mt-0.5">Platform oversight, cross-circle ledgers, health telemetry & issue tracker</p>
                </div>
            </div>

            <!-- Health & Quick Actions -->
            <div class="flex items-center gap-2.5 flex-wrap">
                <div id="adminHealthBadge" class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-xs font-bold">
                    <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span id="adminHealthStatusText">System Operational</span>
                </div>
                <button type="button" onclick="refreshMasterAdminData()" class="qw-btn qw-btn-secondary text-xs py-2 px-3 flex items-center gap-1.5 shadow-xs" title="Refresh Admin Telemetry">
                    <span class="material-symbols-outlined text-[16px]">sync</span>
                    <span>Refresh</span>
                </button>
            </div>
        </div>

        <!-- Master Admin Navigation Tabs -->
        <div class="flex items-center gap-2 overflow-x-auto border-b border-outline-variant pb-2">
            <button type="button" id="adminTabBtnOverview" onclick="switchAdminTab('overview')" class="admin-tab-btn active px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 bg-primary/10 text-primary border border-primary/20">
                <span class="material-symbols-outlined text-[16px]">analytics</span>
                <span>Overview</span>
            </button>
            <button type="button" id="adminTabBtnUsers" onclick="switchAdminTab('users')" class="admin-tab-btn px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container">
                <span class="material-symbols-outlined text-[16px]">manage_accounts</span>
                <span>User Management</span>
            </button>
            <button type="button" id="adminTabBtnGroups" onclick="switchAdminTab('groups')" class="admin-tab-btn px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container">
                <span class="material-symbols-outlined text-[16px]">diversity_3</span>
                <span>Global Circles</span>
            </button>
            <button type="button" id="adminTabBtnFinances" onclick="switchAdminTab('finances')" class="admin-tab-btn px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container">
                <span class="material-symbols-outlined text-[16px]">account_balance_wallet</span>
                <span>Financial Audit</span>
            </button>
            <button type="button" id="adminTabBtnErrors" onclick="switchAdminTab('errors')" class="admin-tab-btn px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container">
                <span class="material-symbols-outlined text-[16px] text-rose-500">bug_report</span>
                <span>System Errors & Tracker</span>
                <span id="adminTabErrorCount" class="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-rose-500 text-white">0</span>
            </button>
            <button type="button" id="adminTabBtnMasterPassword" onclick="switchAdminTab('masterPassword')" class="admin-tab-btn px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container">
                <span class="material-symbols-outlined text-[16px] text-amber-500">vpn_key</span>
                <span>Master Password & Dev Access</span>
            </button>
        </div>

        <!-- ============================================================== -->
        <!-- TAB 1: PLATFORM OVERVIEW                                       -->
        <!-- ============================================================== -->
        <div id="adminTabContentOverview" class="admin-tab-panel space-y-6">
            <!-- Metric KPI Cards -->
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <!-- Users KPI -->
                <div class="qw-card p-5 space-y-3">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Registered Users</span>
                        <div class="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center">
                            <span class="material-symbols-outlined text-[18px]">group</span>
                        </div>
                    </div>
                    <div class="flex items-baseline justify-between">
                        <span id="kpiTotalUsers" class="text-2xl font-extrabold text-on-surface font-mono">0</span>
                        <span class="text-xs text-emerald-500 font-semibold flex items-center gap-1">
                            <span id="kpiActiveUsers">0</span> active
                        </span>
                    </div>
                    <div class="w-full bg-surface-container h-1.5 rounded-full overflow-hidden">
                        <div id="kpiUsersBar" class="bg-blue-500 h-full rounded-full" style="width: 100%"></div>
                    </div>
                </div>

                <!-- Groups KPI -->
                <div class="qw-card p-5 space-y-3">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Active Circles</span>
                        <div class="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
                            <span class="material-symbols-outlined text-[18px]">hub</span>
                        </div>
                    </div>
                    <div class="flex items-baseline justify-between">
                        <span id="kpiTotalGroups" class="text-2xl font-extrabold text-on-surface font-mono">0</span>
                        <span class="text-xs text-on-surface-variant font-semibold">
                            <span id="kpiArchivedGroups">0</span> archived
                        </span>
                    </div>
                    <div class="w-full bg-surface-container h-1.5 rounded-full overflow-hidden">
                        <div id="kpiGroupsBar" class="bg-indigo-500 h-full rounded-full" style="width: 100%"></div>
                    </div>
                </div>

                <!-- Expenses Volume KPI -->
                <div class="qw-card p-5 space-y-3">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Total Spend Volume</span>
                        <div class="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center font-bold font-mono">
                            ₹
                        </div>
                    </div>
                    <div class="flex items-baseline justify-between">
                        <span id="kpiTotalSpendVolume" class="text-2xl font-extrabold text-on-surface font-mono">₹0</span>
                        <span class="text-xs text-on-surface-variant font-semibold">
                            <span id="kpiExpenseCount">0</span> records
                        </span>
                    </div>
                    <div class="w-full bg-surface-container h-1.5 rounded-full overflow-hidden">
                        <div class="bg-emerald-500 h-full rounded-full" style="width: 100%"></div>
                    </div>
                </div>

                <!-- Settlements Volume KPI -->
                <div class="qw-card p-5 space-y-3">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Reconciled Settlements</span>
                        <div class="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
                            <span class="material-symbols-outlined text-[18px]">payments</span>
                        </div>
                    </div>
                    <div class="flex items-baseline justify-between">
                        <span id="kpiSettledVolume" class="text-2xl font-extrabold text-on-surface font-mono">₹0</span>
                        <span class="text-xs text-emerald-500 font-semibold">
                            <span id="kpiSettledCount">0</span> paid
                        </span>
                    </div>
                    <div class="w-full bg-surface-container h-1.5 rounded-full overflow-hidden">
                        <div class="bg-amber-500 h-full rounded-full" style="width: 100%"></div>
                    </div>
                </div>
            </div>

            <!-- Currency Distribution & Server Telemetry -->
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <!-- Currency Breakdown -->
                <div class="qw-card p-5 space-y-4">
                    <div class="flex items-center justify-between">
                        <h3 class="text-sm font-bold text-on-surface flex items-center gap-2">
                            <span class="material-symbols-outlined text-primary text-[18px]">currency_exchange</span>
                            <span>Currency-Wise Transaction Volume</span>
                        </h3>
                        <span class="text-xs text-on-surface-variant font-medium">9 Supported</span>
                    </div>
                    <div id="adminCurrencyStatsContainer" class="space-y-2.5">
                        <!-- Populated dynamically -->
                    </div>
                </div>

                <!-- Server Infrastructure & Health Telemetry -->
                <div class="qw-card p-5 space-y-4">
                    <div class="flex items-center justify-between">
                        <h3 class="text-sm font-bold text-on-surface flex items-center gap-2">
                            <span class="material-symbols-outlined text-emerald-500 text-[18px]">dns</span>
                            <span>System & Database Telemetry</span>
                        </h3>
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-500">ONLINE</span>
                    </div>
                    <div class="grid grid-cols-2 gap-3 text-xs">
                        <div class="p-3 rounded-xl bg-surface-container space-y-1">
                            <span class="text-[10px] uppercase font-bold text-on-surface-variant">PostgreSQL DB</span>
                            <div class="text-xs font-bold text-emerald-500 flex items-center gap-1">
                                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Connected
                            </div>
                        </div>
                        <div class="p-3 rounded-xl bg-surface-container space-y-1">
                            <span class="text-[10px] uppercase font-bold text-on-surface-variant">Runtime Environment</span>
                            <div id="adminNodeVersion" class="text-xs font-mono font-bold text-on-surface">Node.js</div>
                        </div>
                        <div class="p-3 rounded-xl bg-surface-container space-y-1">
                            <span class="text-[10px] uppercase font-bold text-on-surface-variant">Server Uptime</span>
                            <div id="adminUptime" class="text-xs font-mono font-bold text-on-surface">0m</div>
                        </div>
                        <div class="p-3 rounded-xl bg-surface-container space-y-1">
                            <span class="text-[10px] uppercase font-bold text-on-surface-variant">Memory Footprint</span>
                            <div id="adminMemory" class="text-xs font-mono font-bold text-on-surface">0 MB</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- ============================================================== -->
        <!-- TAB 2: USER MANAGEMENT                                         -->
        <!-- ============================================================== -->
        <div id="adminTabContentUsers" class="admin-tab-panel hidden space-y-4">
            <!-- Search & Filters -->
            <div class="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div class="relative w-full sm:w-80">
                    <span class="material-symbols-outlined absolute left-3 top-2.5 text-on-surface-variant text-[18px]">search</span>
                    <input id="adminUserSearchInput" oninput="debounceAdminUserSearch()" type="text" placeholder="Search by name, email, username, or code..." class="qw-input pl-9 text-xs py-2 w-full"/>
                </div>
                <div class="flex items-center gap-2 w-full sm:w-auto">
                    <select id="adminUserStatusFilter" onchange="loadMasterAdminUsers()" class="qw-input text-xs py-2 w-auto">
                        <option value="">All Statuses</option>
                        <option value="active">Active Only</option>
                        <option value="disabled">Disabled Only</option>
                    </select>
                </div>
            </div>

            <!-- Users Table Container -->
            <div class="qw-card overflow-hidden">
                <div class="overflow-x-auto">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-surface-container border-b border-outline-variant text-[10px] uppercase font-extrabold text-on-surface-variant tracking-wider">
                            <tr>
                                <th class="p-3.5">User</th>
                                <th class="p-3.5">Username / Code</th>
                                <th class="p-3.5">Role</th>
                                <th class="p-3.5">Circles</th>
                                <th class="p-3.5">Joined</th>
                                <th class="p-3.5">Status</th>
                                <th class="p-3.5 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="adminUsersTableBody" class="divide-y divide-outline-variant/40">
                            <!-- Populated dynamically -->
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- ============================================================== -->
        <!-- TAB 3: GLOBAL GROUP MANAGEMENT                                 -->
        <!-- ============================================================== -->
        <div id="adminTabContentGroups" class="admin-tab-panel hidden space-y-4">
            <!-- Search & Filters -->
            <div class="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div class="relative w-full sm:w-80">
                    <span class="material-symbols-outlined absolute left-3 top-2.5 text-on-surface-variant text-[18px]">search</span>
                    <input id="adminGroupSearchInput" oninput="debounceAdminGroupSearch()" type="text" placeholder="Search circle name or description..." class="qw-input pl-9 text-xs py-2 w-full"/>
                </div>
                <div class="flex items-center gap-2 w-full sm:w-auto">
                    <select id="adminGroupStatusFilter" onchange="loadMasterAdminGroups()" class="qw-input text-xs py-2 w-auto">
                        <option value="">All Circles</option>
                        <option value="active">Active Only</option>
                        <option value="archived">Archived Only</option>
                    </select>
                </div>
            </div>

            <!-- Groups Table Container -->
            <div class="qw-card overflow-hidden">
                <div class="overflow-x-auto">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-surface-container border-b border-outline-variant text-[10px] uppercase font-extrabold text-on-surface-variant tracking-wider">
                            <tr>
                                <th class="p-3.5">Circle</th>
                                <th class="p-3.5">Owner</th>
                                <th class="p-3.5">Base Currency</th>
                                <th class="p-3.5">Members</th>
                                <th class="p-3.5">Total Spend</th>
                                <th class="p-3.5">Settled</th>
                                <th class="p-3.5 text-right">Inspection</th>
                            </tr>
                        </thead>
                        <tbody id="adminGroupsTableBody" class="divide-y divide-outline-variant/40">
                            <!-- Populated dynamically -->
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- ============================================================== -->
        <!-- TAB 4: GLOBAL FINANCIAL MONITORING                             -->
        <!-- ============================================================== -->
        <div id="adminTabContentFinances" class="admin-tab-panel hidden space-y-4">
            <!-- Filter Bar -->
            <div class="flex flex-col lg:flex-row items-center justify-between gap-3">
                <div class="relative w-full lg:w-72">
                    <span class="material-symbols-outlined absolute left-3 top-2.5 text-on-surface-variant text-[18px]">search</span>
                    <input id="adminFinanceSearchInput" oninput="debounceAdminFinanceSearch()" type="text" placeholder="Filter description, payer, circle..." class="qw-input pl-9 text-xs py-2 w-full"/>
                </div>
                <div class="flex items-center gap-2 w-full lg:w-auto flex-wrap">
                    <select id="adminFinanceCurrencyFilter" onchange="loadMasterAdminFinances()" class="qw-input text-xs py-2 w-auto">
                        <option value="">All Currencies</option>
                        <option value="INR">INR (₹)</option>
                        <option value="USD">USD ($)</option>
                        <option value="EUR">EUR (€)</option>
                        <option value="GBP">GBP (£)</option>
                        <option value="AED">AED</option>
                        <option value="SGD">SGD (S$)</option>
                        <option value="AUD">AUD (A$)</option>
                        <option value="CAD">CAD (C$)</option>
                        <option value="JPY">JPY (¥)</option>
                    </select>
                </div>
            </div>

            <!-- Finances Table Container -->
            <div class="qw-card overflow-hidden">
                <div class="overflow-x-auto">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-surface-container border-b border-outline-variant text-[10px] uppercase font-extrabold text-on-surface-variant tracking-wider">
                            <tr>
                                <th class="p-3.5">Date</th>
                                <th class="p-3.5">Expense</th>
                                <th class="p-3.5">Circle</th>
                                <th class="p-3.5">Paid By</th>
                                <th class="p-3.5">Original</th>
                                <th class="p-3.5">Exchange Rate</th>
                                <th class="p-3.5">Converted Base</th>
                                <th class="p-3.5">Splits</th>
                            </tr>
                        </thead>
                        <tbody id="adminFinancesTableBody" class="divide-y divide-outline-variant/40">
                            <!-- Populated dynamically -->
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- ============================================================== -->
        <!-- TAB 5: SYSTEM ERRORS & ISSUE TRACKER                           -->
        <!-- ============================================================== -->
        <div id="adminTabContentErrors" class="admin-tab-panel hidden space-y-6">
            <!-- Issue Tracker Metrics -->
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div class="p-3.5 rounded-2xl bg-surface-container space-y-1">
                    <span class="text-[10px] uppercase font-extrabold text-on-surface-variant">Total Logged</span>
                    <div id="errKpiTotal" class="text-xl font-extrabold text-on-surface font-mono">0</div>
                </div>
                <div class="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 space-y-1">
                    <span class="text-[10px] uppercase font-extrabold text-amber-500">New Issues</span>
                    <div id="errKpiNew" class="text-xl font-extrabold text-amber-500 font-mono">0</div>
                </div>
                <div class="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 space-y-1">
                    <span class="text-[10px] uppercase font-extrabold text-rose-500">Critical</span>
                    <div id="errKpiCritical" class="text-xl font-extrabold text-rose-500 font-mono">0</div>
                </div>
                <div class="p-3.5 rounded-2xl bg-surface-container space-y-1">
                    <span class="text-[10px] uppercase font-extrabold text-on-surface-variant">Last 24 Hours</span>
                    <div id="errKpiToday" class="text-xl font-extrabold text-on-surface font-mono">0</div>
                </div>
                <div class="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 space-y-1">
                    <span class="text-[10px] uppercase font-extrabold text-emerald-500">Resolved</span>
                    <div id="errKpiResolved" class="text-xl font-extrabold text-emerald-500 font-mono">0</div>
                </div>
                <div class="p-3.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 space-y-1">
                    <span class="text-[10px] uppercase font-extrabold text-indigo-600 dark:text-indigo-400">Recurring</span>
                    <div id="errKpiRecurring" class="text-xl font-extrabold text-indigo-600 dark:text-indigo-400 font-mono">0</div>
                </div>
            </div>

            <!-- Error Filter Controls -->
            <div class="flex flex-col md:flex-row items-center justify-between gap-3 p-4 rounded-2xl bg-surface-container">
                <div class="relative w-full md:w-72">
                    <span class="material-symbols-outlined absolute left-3 top-2 text-on-surface-variant text-[18px]">search</span>
                    <input id="adminErrorSearchInput" oninput="debounceAdminErrorSearch()" type="text" placeholder="Search error ID, message, route..." class="qw-input pl-9 text-xs py-1.5 w-full bg-surface"/>
                </div>

                <div class="flex items-center gap-2 w-full md:w-auto flex-wrap">
                    <select id="adminErrorSeverityFilter" onchange="loadMasterAdminErrors()" class="qw-input text-xs py-1.5 w-auto bg-surface">
                        <option value="">All Severities</option>
                        <option value="critical">Critical</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                    </select>
                    <select id="adminErrorStatusFilter" onchange="loadMasterAdminErrors()" class="qw-input text-xs py-1.5 w-auto bg-surface">
                        <option value="">All Statuses</option>
                        <option value="new">New</option>
                        <option value="investigating">Investigating</option>
                        <option value="resolved">Resolved</option>
                        <option value="ignored">Ignored</option>
                    </select>
                    <select id="adminErrorCategoryFilter" onchange="loadMasterAdminErrors()" class="qw-input text-xs py-1.5 w-auto bg-surface">
                        <option value="">All Categories</option>
                        <option value="frontend">Frontend JS</option>
                        <option value="backend_api">Backend API</option>
                        <option value="database">Database</option>
                        <option value="auth">Auth & Permissions</option>
                        <option value="payment">UPI / Payment</option>
                        <option value="currency">Currency Conversion</option>
                        <option value="ai_assistant">AI Assistant</option>
                    </select>
                </div>
            </div>

            <!-- Errors Table Container -->
            <div class="qw-card overflow-hidden">
                <div class="overflow-x-auto">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-surface-container border-b border-outline-variant text-[10px] uppercase font-extrabold text-on-surface-variant tracking-wider">
                            <tr>
                                <th class="p-3.5">Error ID / Title</th>
                                <th class="p-3.5">Category</th>
                                <th class="p-3.5">Severity</th>
                                <th class="p-3.5">Status</th>
                                <th class="p-3.5">Occurrences</th>
                                <th class="p-3.5">Last Seen</th>
                                <th class="p-3.5 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="adminErrorsTableBody" class="divide-y divide-outline-variant/40">
                            <!-- Populated dynamically -->
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- ============================================================== -->
        <!-- TAB 6: MASTER PASSWORD & DEVELOPER ACCESS                      -->
        <!-- ============================================================== -->
        <div id="adminTabContentMasterPassword" class="admin-tab-panel hidden space-y-6">

            <!-- Security & Environment Guard Banner -->
            <div id="mpEnvironmentBanner" class="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div class="flex items-start gap-3">
                    <div class="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span class="material-symbols-outlined text-[22px]">security</span>
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <h3 class="text-sm font-bold text-on-surface">Development Master Password Authentication</h3>
                            <span id="mpEnvStatusBadge" class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-500 border border-emerald-500/30">DEVELOPMENT ACTIVE</span>
                        </div>
                        <p class="text-xs text-on-surface-variant mt-1 leading-relaxed">
                            Allows authorized developers & administrators to sign into any user account during local testing without altering original passwords.
                            <strong class="text-amber-500">Automatically rejected and disabled in Staging & Production environments.</strong>
                        </p>
                    </div>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                    <button type="button" onclick="loadMasterPasswordConfig()" class="qw-btn qw-btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-[15px]">refresh</span>
                        <span>Refresh Config</span>
                    </button>
                </div>
            </div>

            <!-- Configuration & Credentials Card -->
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <!-- Left 2 Cols: Form -->
                <div class="lg:col-span-2 qw-card p-6 space-y-5">
                    <div class="flex items-center justify-between border-b border-outline-variant pb-3">
                        <div class="flex items-center gap-2">
                            <span class="material-symbols-outlined text-primary text-[20px]">vpn_key</span>
                            <h3 class="text-sm font-bold text-on-surface">Configure Master Password</h3>
                        </div>
                        <div class="flex items-center gap-2">
                            <label class="text-xs font-semibold text-on-surface-variant cursor-pointer flex items-center gap-2">
                                <span>Master Password Login:</span>
                                <input type="checkbox" id="mpEnabledToggle" class="w-4 h-4 rounded text-primary focus:ring-primary accent-primary cursor-pointer"/>
                                <span id="mpEnabledLabel" class="text-xs font-bold text-emerald-500">Enabled</span>
                            </label>
                        </div>
                    </div>

                    <form id="masterPasswordForm" onsubmit="event.preventDefault(); saveMasterPasswordConfig();" class="space-y-4">
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div class="space-y-1.5">
                                <label class="block text-xs font-bold uppercase tracking-wider text-on-surface-variant">New Master Password</label>
                                <div class="relative">
                                    <input type="password" id="mpNewPasswordInput" placeholder="Min 8 characters..." class="qw-input text-xs py-2.5 pr-10"/>
                                    <button type="button" onclick="togglePasswordVisibility('mpNewPasswordInput', this)" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface p-1">
                                        <span class="material-symbols-outlined text-[18px]">visibility</span>
                                    </button>
                                </div>
                            </div>
                            <div class="space-y-1.5">
                                <label class="block text-xs font-bold uppercase tracking-wider text-on-surface-variant">Confirm Master Password</label>
                                <div class="relative">
                                    <input type="password" id="mpConfirmPasswordInput" placeholder="Repeat new password..." class="qw-input text-xs py-2.5 pr-10"/>
                                    <button type="button" onclick="togglePasswordVisibility('mpConfirmPasswordInput', this)" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface p-1">
                                        <span class="material-symbols-outlined text-[18px]">visibility</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Step-up Authorization: Master Admin Current Password -->
                        <div class="p-3.5 rounded-xl bg-surface-container border border-outline-variant space-y-2">
                            <div class="flex items-center gap-1.5 text-xs font-bold text-on-surface">
                                <span class="material-symbols-outlined text-[16px] text-amber-500">lock_clock</span>
                                <span>Step-Up Authorization Required</span>
                            </div>
                            <p class="text-[11px] text-on-surface-variant">Enter your current Master Administrator account password to confirm and authorize this configuration change.</p>
                            <div class="relative max-w-sm">
                                <input type="password" id="mpAdminPasswordVerifyInput" required placeholder="Your Master Admin password..." class="qw-input text-xs py-2 pr-10"/>
                                <button type="button" onclick="togglePasswordVisibility('mpAdminPasswordVerifyInput', this)" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface p-1">
                                    <span class="material-symbols-outlined text-[18px]">visibility</span>
                                </button>
                            </div>
                        </div>

                        <div class="flex items-center justify-between pt-2">
                            <span class="text-[11px] text-on-surface-variant">Stored securely using <strong>bcrypt-10</strong> one-way hashing. Plaintext is never stored.</span>
                            <button type="submit" id="btnSaveMasterPassword" class="qw-btn qw-btn-primary text-xs py-2 px-4 flex items-center gap-2">
                                <span class="material-symbols-outlined text-[16px]">save</span>
                                <span>Save Settings</span>
                            </button>
                        </div>
                    </form>
                </div>

                <!-- Right 1 Col: Status & Telemetry -->
                <div class="qw-card p-6 space-y-4">
                    <h3 class="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Security Status</h3>
                    
                    <div class="space-y-3 text-xs">
                        <div class="p-3 rounded-xl bg-surface-container flex items-center justify-between">
                            <span class="text-on-surface-variant">Config Status:</span>
                            <span id="mpStatusConfigured" class="font-bold text-emerald-500">Configured</span>
                        </div>
                        <div class="p-3 rounded-xl bg-surface-container flex items-center justify-between">
                            <span class="text-on-surface-variant">Environment:</span>
                            <span id="mpStatusEnvironment" class="font-mono font-bold text-primary">development</span>
                        </div>
                        <div class="p-3 rounded-xl bg-surface-container flex items-center justify-between">
                            <span class="text-on-surface-variant">Hashing:</span>
                            <span id="mpStatusAlgorithm" class="font-mono font-bold text-on-surface">bcrypt (salt 10)</span>
                        </div>
                        <div class="p-3 rounded-xl bg-surface-container flex items-center justify-between">
                            <span class="text-on-surface-variant">Last Updated:</span>
                            <span id="mpStatusUpdatedAt" class="font-bold text-on-surface">--</span>
                        </div>
                        <div class="p-3 rounded-xl bg-surface-container flex items-center justify-between">
                            <span class="text-on-surface-variant">Updated By:</span>
                            <span id="mpStatusUpdatedBy" class="font-bold text-on-surface">--</span>
                        </div>
                    </div>

                    <div class="pt-2 border-t border-outline-variant text-[11px] text-on-surface-variant leading-relaxed">
                        <span class="material-symbols-outlined text-[14px] align-text-bottom text-primary mr-1">info</span>
                        When enabled, developers can enter any user's registered username/email and this Master Password on the login screen. Original passwords remain intact.
                    </div>
                </div>
            </div>

            <!-- Master Password Audit Trail -->
            <div class="qw-card p-6 space-y-4">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-outline-variant pb-3">
                    <div class="flex items-center gap-2">
                        <span class="material-symbols-outlined text-[20px] text-indigo-400">history</span>
                        <div>
                            <h3 class="text-sm font-bold text-on-surface">Master Password Access Audit Trail</h3>
                            <p class="text-[11px] text-on-surface-variant">Immutable security record of every authentication session created via Master Password</p>
                        </div>
                    </div>
                    <button type="button" onclick="loadMasterPasswordAuditLogs()" class="qw-btn qw-btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-[15px]">refresh</span>
                        <span>Refresh Log</span>
                    </button>
                </div>

                <div class="overflow-x-auto">
                    <table class="w-full text-left text-xs border-collapse">
                        <thead>
                            <tr class="border-b border-outline-variant text-[11px] uppercase tracking-wider text-on-surface-variant">
                                <th class="py-2.5 px-3">Target User</th>
                                <th class="py-2.5 px-3">Target Email / Username</th>
                                <th class="py-2.5 px-3">Auth Method</th>
                                <th class="py-2.5 px-3">IP Address</th>
                                <th class="py-2.5 px-3">Environment</th>
                                <th class="py-2.5 px-3">Timestamp</th>
                            </tr>
                        </thead>
                        <tbody id="mpAuditTableBody" class="divide-y divide-outline-variant/30">
                            <!-- Populated dynamically -->
                            <tr>
                                <td colspan="6" class="py-8 text-center text-on-surface-variant">Loading audit records...</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

        </div>

    </div>

    <!-- ============================================================== -->
    <!-- MASTER ADMIN MODALS                                            -->
    <!-- ============================================================== -->

    <!-- 1. Antigravity Fix Prompt Modal -->
    <div id="modalAntigravityPrompt" class="hidden fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
        <div class="qw-card max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl border border-primary/30">
            <!-- Modal Header -->
            <div class="p-4 border-b border-outline-variant flex items-center justify-between bg-surface-container">
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                        <span class="material-symbols-outlined text-[18px]">terminal</span>
                    </div>
                    <div>
                        <h3 class="text-sm font-bold text-on-surface">Generate Antigravity Fix Prompt</h3>
                        <p id="antigravityPromptSub" class="text-[11px] text-on-surface-variant">Ready to copy and execute in Google Antigravity</p>
                    </div>
                </div>
                <button type="button" onclick="closeAntigravityModal()" class="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors">
                    <span class="material-symbols-outlined text-[18px]">close</span>
                </button>
            </div>

            <!-- Prompt Code Box -->
            <div class="flex-1 overflow-y-auto p-4 bg-[#090b10] text-slate-200 font-mono text-xs leading-relaxed">
                <pre id="antigravityPromptText" class="whitespace-pre-wrap select-all"></pre>
            </div>

            <!-- Modal Footer Actions -->
            <div class="p-3.5 border-t border-outline-variant bg-surface-container flex items-center justify-between gap-3">
                <span class="text-[11px] text-on-surface-variant">Tip: Paste this directly into Antigravity prompt bar</span>
                <div class="flex items-center gap-2">
                    <button type="button" onclick="downloadAntigravityPrompt()" class="qw-btn qw-btn-secondary py-1.5 px-3 text-xs flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-[15px]">download</span>
                        <span>Download .md</span>
                    </button>
                    <button type="button" id="btnCopyAntigravityPrompt" onclick="copyAntigravityPrompt()" class="qw-btn qw-btn-primary py-1.5 px-3.5 text-xs flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-[15px]">content_copy</span>
                        <span id="btnCopyPromptLabel">Copy Prompt</span>
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- 2. Error Detail & Stack Trace Inspection Modal -->
    <div id="modalErrorDetails" class="hidden fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
        <div class="qw-card max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            <div class="p-4 border-b border-outline-variant flex items-center justify-between bg-surface-container">
                <div>
                    <h3 id="errorInspectTitle" class="text-sm font-bold text-on-surface">Error Details</h3>
                    <p id="errorInspectSub" class="text-[11px] text-on-surface-variant font-mono">ERR-ID</p>
                </div>
                <button type="button" onclick="closeErrorInspectModal()" class="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors">
                    <span class="material-symbols-outlined text-[18px]">close</span>
                </button>
            </div>

            <div class="flex-1 overflow-y-auto p-5 space-y-4">
                <!-- Status & Workflow Row -->
                <div class="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-surface-container">
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-bold text-on-surface">Resolution Workflow:</span>
                        <select id="errorInspectStatusSelect" class="qw-input text-xs py-1">
                            <option value="new">New</option>
                            <option value="investigating">Investigating</option>
                            <option value="resolved">Resolved</option>
                            <option value="ignored">Ignored</option>
                        </select>
                    </div>
                    <button type="button" onclick="saveErrorStatusFromModal()" class="qw-btn qw-btn-primary text-xs py-1.5 px-3">
                        Save Status
                    </button>
                </div>

                <!-- Sanitized Stack Trace Box -->
                <div class="space-y-1.5">
                    <label class="block text-xs font-bold uppercase tracking-wider text-on-surface-variant">Sanitized Stack Trace</label>
                    <pre id="errorInspectStackTrace" class="p-3.5 rounded-xl bg-[#090b10] text-rose-400 font-mono text-xs overflow-x-auto max-h-60 leading-relaxed"></pre>
                </div>

                <!-- Occurrences Log List -->
                <div class="space-y-1.5">
                    <label class="block text-xs font-bold uppercase tracking-wider text-on-surface-variant">Recent Occurrences Context</label>
                    <div id="errorOccurrencesContainer" class="space-y-2 max-h-60 overflow-y-auto">
                        <!-- Populated dynamically -->
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- 3. Group Inspection Modal (Read-Only Platform Audit) -->
    <div id="modalAdminGroupInspect" class="hidden fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
        <div class="qw-card max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            <div class="p-4 border-b border-outline-variant flex items-center justify-between bg-surface-container">
                <div>
                    <h3 id="adminGroupInspectTitle" class="text-sm font-bold text-on-surface">Circle Inspection</h3>
                    <p id="adminGroupInspectSub" class="text-[11px] text-on-surface-variant">Read-only platform monitoring view</p>
                </div>
                <button type="button" onclick="closeAdminGroupInspectModal()" class="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors">
                    <span class="material-symbols-outlined text-[18px]">close</span>
                </button>
            </div>
            <div id="adminGroupInspectContent" class="flex-1 overflow-y-auto p-5 space-y-4">
                <!-- Populated dynamically -->
            </div>
        </div>
    </div>
    `;
}

module.exports = { getMasterAdminViewHtml };
