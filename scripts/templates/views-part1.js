/**
 * VIEWS PART 1: Dashboard, All Expenses, Add Expense
 */
function getViewsPart1Html() {
    return `
    <!-- ============================================================== -->
    <!-- VIEW 1: DASHBOARD (EXECUTIVE FINANCIAL OVERVIEW)                -->
    <!-- ============================================================== -->
    <div id="view-dashboard" class="view-panel space-y-6">
        
        <!-- Top Command Greeting Banner -->
        <div class="qw-card-elevated p-6 sm:p-8 relative overflow-hidden bg-gradient-to-br from-surface to-surface-container-low border border-outline-variant">
            <div class="absolute -right-16 -top-16 w-72 h-72 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none"></div>
            <div class="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-bold bg-primary/10 text-primary border border-primary/20 mb-2">
                        <span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                        Live Ledger Balance
                    </div>
                    <h1 id="dashGreeting" class="text-2xl sm:text-3xl font-extrabold text-on-surface tracking-tight">
                        Good day
                    </h1>
                    <p class="text-xs sm:text-sm text-on-surface-variant mt-1">
                        Here is your real-time debt matrix and circle distribution.
                    </p>
                </div>
                <div class="flex items-center gap-2.5 flex-wrap">
                    <button onclick="navigateTo('add-expense')" class="qw-btn qw-btn-primary shadow-sm text-xs">
                        <span class="material-symbols-outlined text-[17px]">add</span>
                        <span>Add Expense</span>
                    </button>
                    <button onclick="openNewGroupModal()" class="qw-btn qw-btn-secondary text-xs">
                        <span class="material-symbols-outlined text-[17px]">group_add</span>
                        <span>New Circle</span>
                    </button>
                </div>
            </div>
        </div>

        <!-- 4-Card Financial Command Matrix -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            <!-- Card 1: Net Balance -->
            <div class="qw-card p-5 relative overflow-hidden flex flex-col justify-between">
                <div class="flex items-center justify-between">
                    <span class="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Net Balance</span>
                    <span id="dashNetBadge" class="qw-badge bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">Balanced</span>
                </div>
                <div class="my-3">
                    <div id="dashStatNet" class="text-2xl sm:text-3xl font-extrabold tabular-nums tracking-tight text-on-surface">₹0.00</div>
                </div>
                <div class="text-[11px] text-on-surface-variant flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-[14px] text-emerald-500">account_balance</span>
                    <span>Total reconciled position</span>
                </div>
            </div>

            <!-- Card 2: You Owe -->
            <div class="qw-card p-5 relative overflow-hidden flex flex-col justify-between">
                <div class="flex items-center justify-between">
                    <span class="text-xs font-bold uppercase tracking-wider text-rose-500">You Owe</span>
                    <button onclick="navigateTo('settle')" class="text-[11px] font-bold text-rose-500 hover:underline">Settle &rarr;</button>
                </div>
                <div class="my-3">
                    <div id="dashStatYouOwe" class="text-2xl sm:text-3xl font-extrabold tabular-nums tracking-tight text-rose-500">₹0.00</div>
                </div>
                <div class="text-[11px] text-on-surface-variant flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-[14px] text-rose-500">call_made</span>
                    <span>Pending outward debts</span>
                </div>
            </div>

            <!-- Card 3: You Are Owed -->
            <div class="qw-card p-5 relative overflow-hidden flex flex-col justify-between">
                <div class="flex items-center justify-between">
                    <span class="text-xs font-bold uppercase tracking-wider text-emerald-500">You Are Owed</span>
                    <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                </div>
                <div class="my-3">
                    <div id="dashStatYouAreOwed" class="text-2xl sm:text-3xl font-extrabold tabular-nums tracking-tight text-emerald-500">₹0.00</div>
                </div>
                <div class="text-[11px] text-on-surface-variant flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-[14px] text-emerald-500">call_received</span>
                    <span>Receivables from peers</span>
                </div>
            </div>

            <!-- Card 4: Monthly Spend -->
            <div class="qw-card p-5 relative overflow-hidden flex flex-col justify-between">
                <div class="flex items-center justify-between">
                    <span class="text-xs font-bold uppercase tracking-wider text-indigo-500">Monthly Spend</span>
                    <button onclick="navigateTo('analytics')" class="text-[11px] font-bold text-indigo-500 hover:underline">Insights &rarr;</button>
                </div>
                <div class="my-3">
                    <div id="dashStatMonth" class="text-2xl sm:text-3xl font-extrabold tabular-nums tracking-tight text-indigo-600 dark:text-indigo-400">₹0.00</div>
                </div>
                <div class="text-[11px] text-on-surface-variant flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-[14px] text-indigo-500">calendar_month</span>
                    <span>Current billing cycle</span>
                </div>
            </div>

        </div>

        <!-- Dashboard Core Split Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            <!-- Left Column: Spending Chart & Recent Ledger (7 cols) -->
            <div class="lg:col-span-7 space-y-6">
                <!-- Trend Chart Card -->
                <div class="qw-card p-5 sm:p-6 space-y-4">
                    <div class="flex items-center justify-between">
                        <div>
                            <h3 class="text-sm font-bold text-on-surface">Spending Velocity</h3>
                            <p class="text-xs text-on-surface-variant">Expense accumulation trajectory</p>
                        </div>
                        <span class="px-2.5 py-1 rounded-full text-[10px] font-bold font-mono bg-surface-container text-on-surface-variant border border-outline-variant">
                            Live Stream
                        </span>
                    </div>
                    <div class="h-60 w-full relative">
                        <canvas id="dashboardTrendChart"></canvas>
                    </div>
                </div>

                <!-- Recent Expenses Stream -->
                <div class="qw-card p-5 sm:p-6 space-y-4">
                    <div class="flex items-center justify-between">
                        <div>
                            <h3 class="text-sm font-bold text-on-surface">Recent Ledger Entries</h3>
                            <p class="text-xs text-on-surface-variant">Latest recorded debits and credits</p>
                        </div>
                        <button onclick="navigateTo('expenses')" class="text-xs font-bold text-primary hover:underline">View All</button>
                    </div>
                    
                    <!-- Dynamic Recent List Container -->
                    <div id="dashboardRecentList" class="space-y-2.5">
                        <!-- Populated by JS -->
                    </div>
                </div>
            </div>

            <!-- Right Column: Active Circles & Shortcuts (5 cols) -->
            <div class="lg:col-span-5 space-y-6">
                <!-- Active Groups Card -->
                <div class="qw-card p-5 sm:p-6 space-y-4">
                    <div class="flex items-center justify-between">
                        <div>
                            <h3 class="text-sm font-bold text-on-surface">Active Circles</h3>
                            <p class="text-xs text-on-surface-variant">Shared expenses by circle</p>
                        </div>
                        <button onclick="openNewGroupModal()" class="text-xs font-bold text-primary hover:underline">+ New</button>
                    </div>

                    <!-- Dynamic Groups List Container -->
                    <div id="dashActiveGroupsList" class="space-y-3">
                        <!-- Populated by JS -->
                    </div>
                </div>

                <!-- Debt Minimization Matrix Promo Card -->
                <div class="qw-card p-5 bg-gradient-to-br from-indigo-500/10 via-surface to-emerald-500/10 border border-indigo-500/20 space-y-3">
                    <div class="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                        <span class="material-symbols-outlined text-[20px]">alt_route</span>
                        <span class="text-xs font-bold uppercase tracking-wider">Graph Debt Minimization</span>
                    </div>
                    <p class="text-xs text-on-surface-variant leading-relaxed">
                        SplitWise uses max-flow graph algorithms to simplify multi-party payments down to the fewest direct peer transactions.
                    </p>
                    <button onclick="openDebtMatrixModal()" class="qw-btn qw-btn-secondary w-full text-xs font-bold py-2">
                        View Graph Simplification Matrix
                    </button>
                </div>
            </div>

        </div>

    </div>

    <!-- ============================================================== -->
    <!-- VIEW 2: ALL EXPENSES (FINANCIAL LEDGER)                        -->
    <!-- ============================================================== -->
    <div id="view-expenses" class="hidden view-panel space-y-6">
        
        <!-- Header & Action Toolbar -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
                <h1 class="text-2xl font-extrabold text-on-surface tracking-tight">Ledger & Spends</h1>
                <p class="text-xs text-on-surface-variant mt-0.5">Filter, search, audit, and correct recorded circle expenses</p>
            </div>
            <div class="flex items-center gap-2">
                <button onclick="exportExpensesToCSV()" class="qw-btn qw-btn-secondary text-xs">
                    <span class="material-symbols-outlined text-[16px]">download</span>
                    <span>Export CSV</span>
                </button>
                <button onclick="navigateTo('add-expense')" class="qw-btn qw-btn-primary text-xs">
                    <span class="material-symbols-outlined text-[16px]">add</span>
                    <span>Add Expense</span>
                </button>
            </div>
        </div>

        <!-- Filter Bar -->
        <div class="qw-card p-4 space-y-3">
            <div class="flex flex-col md:flex-row items-center gap-3">
                <div class="relative flex-1 w-full">
                    <span class="material-symbols-outlined absolute left-3 text-on-surface-variant text-[18px]">search</span>
                    <input id="expenseListSearch" oninput="applyExpenseFilters()" placeholder="Search description, payer, note..." class="qw-input pl-9 text-xs py-2 w-full"/>
                </div>
                <div class="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full md:w-auto">
                    <select id="expenseGroupFilter" onchange="applyExpenseFilters()" class="qw-input text-xs py-2 w-full sm:w-48">
                        <option value="ALL">All Circles</option>
                    </select>
                    <select id="expenseCategoryFilter" onchange="applyExpenseFilters()" class="qw-input text-xs py-2 w-full sm:w-44">
                        <option value="ALL">All Categories</option>
                        <option value="Food & Dining">Food & Dining</option>
                        <option value="Travel & Stay">Travel & Stay</option>
                        <option value="Utilities">Utilities</option>
                        <option value="Groceries">Groceries</option>
                        <option value="Entertainment">Entertainment</option>
                        <option value="General">General</option>
                    </select>
                </div>
            </div>

            <!-- Date Range Filter Row -->
            <div class="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-outline-variant/30 text-xs">
                <div class="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
                    <span class="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-[16px] text-primary">calendar_month</span>
                        <span>Date Range:</span>
                    </span>
                    <div class="flex items-center gap-1.5">
                        <input id="expenseFromDate" type="date" onchange="applyExpenseFilters()" class="qw-input text-xs py-1.5 px-2.5 w-36" title="From Date"/>
                        <span class="text-on-surface-variant text-xs font-semibold">to</span>
                        <input id="expenseToDate" type="date" onchange="applyExpenseFilters()" class="qw-input text-xs py-1.5 px-2.5 w-36" title="To Date"/>
                    </div>
                </div>
                <div class="flex items-center gap-2 ml-auto">
                    <button id="btnResetExpenseFilters" onclick="resetExpenseFilters()" type="button" class="qw-btn qw-btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5" title="Reset all filters">
                        <span class="material-symbols-outlined text-[15px]">filter_alt_off</span>
                        <span>Reset Filters</span>
                    </button>
                </div>
            </div>
        </div>

        <!-- Ledger Entries Container -->
        <div id="allExpensesContainer" class="space-y-3">
            <!-- Populated dynamically by renderAllExpenses() -->
        </div>

    </div>

    <!-- ============================================================== -->
    <!-- VIEW 3: ADD EXPENSE (INTERACTIVE EXPENSE STUDIO)               -->
    <!-- ============================================================== -->
    <div id="view-add-expense" class="hidden view-panel space-y-6">
        
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-extrabold text-on-surface tracking-tight">Record Expense</h1>
                <p class="text-xs text-on-surface-variant mt-0.5">Add shared bill, assign payer, and configure split allocation</p>
            </div>
            <button onclick="navigateTo('expenses')" class="qw-btn qw-btn-ghost text-xs">
                <span class="material-symbols-outlined text-[16px]">arrow_back</span>
                <span>Back to Ledger</span>
            </button>
        </div>

        <!-- Role Notice Alert Banner -->
        <div id="addExpenseRoleNotice" class="hidden p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-500 text-xs font-semibold flex items-center gap-2.5">
            <span class="material-symbols-outlined text-[18px]">info</span>
            <span id="addExpenseRoleNoticeText"></span>
        </div>

        <!-- Validation & Success Alerts -->
        <div id="addExpenseValidationAlert" class="hidden p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs font-semibold flex items-center gap-2.5">
            <span class="material-symbols-outlined text-[18px]">error</span>
            <span id="addExpenseValidationMsg"></span>
        </div>
        <div id="addExpenseSuccessAlert" class="hidden p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 text-xs font-semibold flex items-center gap-2.5">
            <span class="material-symbols-outlined text-[18px]">check_circle</span>
            <span id="addExpenseSuccessMsg"></span>
        </div>

        <!-- Main Expense Form Grid -->
        <form id="addExpenseForm" onsubmit="handleCreateExpense(event)" class="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            <!-- Left Column: Core Bill Details (7 cols) -->
            <div class="lg:col-span-7 qw-card p-6 space-y-5">
                <h3 class="text-sm font-bold uppercase tracking-wider text-on-surface-variant">Bill Specifications</h3>

                <!-- Amount Hero Input -->
                <div class="space-y-1.5">
                    <label class="block text-xs font-bold text-on-surface uppercase tracking-wider">Total Expense Amount</label>
                    <div class="relative flex items-center">
                        <span class="absolute left-4 text-xl font-bold font-mono text-primary">₹</span>
                        <input id="newExpenseAmount" type="number" step="1" min="1" required placeholder="0" oninput="handleAmountInput(this.value)" class="qw-input pl-10 text-2xl font-bold font-mono py-3"/>
                    </div>
                    <!-- Quick Integer Increment Presets -->
                    <div class="flex items-center gap-1.5 pt-1 overflow-x-auto">
                        <span class="text-[10px] uppercase font-bold text-on-surface-variant flex items-center gap-1 flex-shrink-0">
                            <span class="material-symbols-outlined text-[13px] text-primary">add_circle</span>
                            <span>Quick Add:</span>
                        </span>
                        <button type="button" onclick="quickAddAmount('newExpenseAmount', 50)" class="px-2.5 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs font-bold text-on-surface border border-outline-variant/30 hover:border-primary/40 transition-colors flex-shrink-0">+₹50</button>
                        <button type="button" onclick="quickAddAmount('newExpenseAmount', 100)" class="px-2.5 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs font-bold text-on-surface border border-outline-variant/30 hover:border-primary/40 transition-colors flex-shrink-0">+₹100</button>
                        <button type="button" onclick="quickAddAmount('newExpenseAmount', 500)" class="px-2.5 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs font-bold text-on-surface border border-outline-variant/30 hover:border-primary/40 transition-colors flex-shrink-0">+₹500</button>
                        <button type="button" onclick="quickAddAmount('newExpenseAmount', 1000)" class="px-2.5 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs font-bold text-on-surface border border-outline-variant/30 hover:border-primary/40 transition-colors flex-shrink-0">+₹1,000</button>
                        <button type="button" onclick="quickAddAmount('newExpenseAmount', 2000)" class="px-2.5 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs font-bold text-on-surface border border-outline-variant/30 hover:border-primary/40 transition-colors flex-shrink-0">+₹2,000</button>
                    </div>
                </div>

                <!-- Description Input -->
                <div class="space-y-1.5">
                    <label class="block text-xs font-bold text-on-surface uppercase tracking-wider">Description</label>
                    <div class="relative flex items-center">
                        <span class="material-symbols-outlined absolute left-3.5 text-on-surface-variant text-[18px]">description</span>
                        <input id="newExpenseDesc" type="text" required placeholder="e.g. Flight to Goa, Grocery run, Dinner bill" class="qw-input pl-10 text-sm"/>
                    </div>
                </div>

                <!-- Group & Payer Row -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div class="space-y-1.5">
                        <label class="block text-xs font-bold text-on-surface uppercase tracking-wider">Circle / Group</label>
                        <select id="newExpenseGroup" required onchange="onExpenseGroupChange()" class="qw-input text-xs py-2.5">
                            <option value="">Select Circle...</option>
                        </select>
                    </div>
                    <div class="space-y-1.5">
                        <label class="block text-xs font-bold text-on-surface uppercase tracking-wider">Paid By</label>
                        <select id="newExpensePayer" required class="qw-input text-xs py-2.5">
                            <option value="">Select Payer...</option>
                        </select>
                    </div>
                </div>

                <!-- Date & Category Row -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div class="space-y-1.5">
                        <label class="block text-xs font-bold text-on-surface uppercase tracking-wider">Date</label>
                        <input id="newExpenseDate" type="date" required class="qw-input text-xs py-2.5"/>
                    </div>
                    <div class="space-y-1.5">
                        <label class="block text-xs font-bold text-on-surface uppercase tracking-wider">Category</label>
                        <input type="hidden" id="selectedCategory" value="General"/>
                        <div class="flex items-center gap-1.5 overflow-x-auto py-1">
                            <button type="button" onclick="selectExpenseCategory('General', this)" class="category-chip active px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-primary text-white border border-primary">General</button>
                            <button type="button" onclick="selectExpenseCategory('Food & Dining', this)" class="category-chip px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-surface-container text-on-surface hover:bg-surface-container-high">Food</button>
                            <button type="button" onclick="selectExpenseCategory('Travel & Stay', this)" class="category-chip px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-surface-container text-on-surface hover:bg-surface-container-high">Travel</button>
                            <button type="button" onclick="selectExpenseCategory('Utilities', this)" class="category-chip px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-surface-container text-on-surface hover:bg-surface-container-high">Bills</button>
                            <button type="button" onclick="selectExpenseCategory('Groceries', this)" class="category-chip px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-surface-container text-on-surface hover:bg-surface-container-high">Groceries</button>
                        </div>
                    </div>
                </div>

                <!-- Notes Input -->
                <div class="space-y-1.5">
                    <label class="block text-xs font-bold text-on-surface uppercase tracking-wider">Additional Notes (Optional)</label>
                    <textarea id="newExpenseNotes" rows="2" placeholder="Add invoice number, receipt link, or context..." class="qw-input text-xs resize-none"></textarea>
                </div>
            </div>

            <!-- Right Column: Split Engine & Member Shares (5 cols) -->
            <div class="lg:col-span-5 qw-card p-6 space-y-5 flex flex-col justify-between">
                <div class="space-y-4">
                    <div class="flex items-center justify-between">
                        <h3 class="text-sm font-bold uppercase tracking-wider text-on-surface-variant">Split Engine</h3>
                        <!-- Status indicator badge -->
                        <div id="splitStatusBadgeContainer" class="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                            <span id="splitStatusIcon" class="material-symbols-outlined text-[15px]">verified</span>
                            <span id="splitStatusBadge">Balanced</span>
                        </div>
                    </div>

                    <!-- Split Mode Selector Tabs -->
                    <div class="grid grid-cols-3 gap-1 p-1 rounded-xl bg-surface-container border border-outline-variant">
                        <button type="button" id="splitModeBtnEqual" onclick="setSplitMode('EQUAL')" class="py-1.5 text-xs font-bold rounded-lg transition-all bg-surface-container-lowest text-primary shadow-xs">Equal</button>
                        <button type="button" id="splitModeBtnExact" onclick="setSplitMode('EXACT')" class="py-1.5 text-xs font-bold rounded-lg transition-all text-on-surface-variant hover:text-on-surface">Exact</button>
                        <button type="button" id="splitModeBtnPct" onclick="setSplitMode('PERCENTAGE')" class="py-1.5 text-xs font-bold rounded-lg transition-all text-on-surface-variant hover:text-on-surface">% Pct</button>
                    </div>

                    <!-- Member List for Split Allocation -->
                    <div class="space-y-2">
                        <label class="block text-xs font-bold text-on-surface uppercase tracking-wider">Member Split Allocation</label>
                        <div id="splitEngineMemberList" class="space-y-2 max-h-72 overflow-y-auto pr-1">
                            <!-- Populated dynamically by renderSplitEngineMembers() -->
                        </div>
                    </div>
                </div>

                <div class="pt-4 border-t border-outline-variant space-y-3">
                    <button id="addExpenseSubmitBtn" type="submit" class="qw-btn qw-btn-primary w-full py-3 text-sm font-bold shadow-md">
                        <span class="material-symbols-outlined text-[18px]">receipt</span>
                        <span>Record & Save Expense</span>
                    </button>
                </div>
            </div>

        </form>

    </div>
    `;
}

module.exports = { getViewsPart1Html };
