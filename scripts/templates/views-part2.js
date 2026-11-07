/**
 * VIEWS PART 2: Groups, Friends, Settle Up, Analytics, Activity Feed, Chat, Master Admin
 */
const { getMasterAdminViewHtml } = require('./master-admin-view');

function getViewsPart2Html() {
    return `
    <!-- ============================================================== -->
    <!-- VIEW 4: GROUPS (CIRCLES & SHARED VAULTS)                       -->
    <!-- ============================================================== -->
    <div id="view-groups" class="hidden view-panel space-y-6">
        
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
                <h1 class="text-2xl font-extrabold text-on-surface tracking-tight">Circles & Vaults</h1>
                <p class="text-xs text-on-surface-variant mt-0.5">Manage shared group ledgers, invite participants, and view circle health</p>
            </div>
            <button onclick="openNewGroupModal()" class="qw-btn qw-btn-primary text-xs">
                <span class="material-symbols-outlined text-[16px]">add</span>
                <span>Create Circle</span>
            </button>
        </div>

        <!-- Groups Mosaic Grid -->
        <div id="groupsMosaicGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            <!-- Populated dynamically by renderGroups() -->
        </div>

    </div>

    <!-- ============================================================== -->
    <!-- VIEW 5: FRIENDS & CONNECTIONS                                  -->
    <!-- ============================================================== -->
    <div id="view-friends" class="hidden view-panel space-y-6">
        
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
                <h1 class="text-2xl font-extrabold text-on-surface tracking-tight">Friends & Connections</h1>
                <p class="text-xs text-on-surface-variant mt-0.5">Connect with peers via unique User Code or registered email</p>
            </div>
            <!-- Unique User Code Chip -->
            <div class="flex items-center gap-2 p-2 px-3 rounded-2xl bg-surface-container border border-outline-variant">
                <span class="text-xs font-medium text-on-surface-variant">Your Code:</span>
                <span id="friendsMyUserCodeBadge" class="font-mono font-bold text-xs text-primary">USER-XXXX</span>
                <button onclick="copyMyUserCode()" class="p-1 rounded-lg hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors" title="Copy User Code">
                    <span class="material-symbols-outlined text-[16px]">content_copy</span>
                </button>
            </div>
        </div>

        <!-- Friend Search Card -->
        <div class="qw-card p-5 space-y-3">
            <h3 class="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Find & Connect Peers</h3>
            <div class="flex items-center gap-2">
                <div class="relative flex-1">
                    <span class="material-symbols-outlined absolute left-3.5 text-on-surface-variant text-[18px]">search</span>
                    <input id="friendSearchInput" onkeydown="if(event.key==='Enter') searchFriends()" placeholder="Enter peer User Code (e.g. USR-ABCD) or email..." class="qw-input pl-10 text-xs py-2.5"/>
                </div>
                <button id="friendSearchBtn" onclick="searchFriends()" class="qw-btn qw-btn-primary text-xs py-2.5 px-4">
                    <span>Search</span>
                </button>
            </div>
            <!-- Friend Search Results -->
            <div id="friendSearchResults" class="space-y-2"></div>
        </div>

        <!-- Pending Friend Requests Section -->
        <div id="friendRequestsSection" class="hidden space-y-4">
            <div class="qw-card p-5 space-y-4 border-amber-500/30 bg-amber-500/[0.02]">
                <div class="flex items-center gap-2 text-amber-500">
                    <span class="material-symbols-outlined text-[18px]">notification_important</span>
                    <h3 class="text-xs font-bold uppercase tracking-wider">Pending Connection Requests</h3>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="space-y-2">
                        <span class="text-xs font-bold text-on-surface">Incoming Requests</span>
                        <div id="friendIncomingRequestsList" class="space-y-2"></div>
                    </div>
                    <div class="space-y-2">
                        <span class="text-xs font-bold text-on-surface">Sent by You</span>
                        <div id="friendOutgoingRequestsList" class="space-y-2"></div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Confirmed Friends List -->
        <div class="qw-card p-5 sm:p-6 space-y-4">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <h3 class="text-sm font-bold text-on-surface">Mutual Connections</h3>
                    <span id="friendsCountBadge" class="qw-badge bg-primary/10 text-primary border border-primary/20">0 Connected</span>
                </div>
            </div>
            <!-- Friends Grid -->
            <div id="friendsListGrid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <!-- Populated dynamically -->
            </div>
        </div>

    </div>

    <!-- ============================================================== -->
    <!-- VIEW 6: SETTLE UP (AUTOMATED UPI & PAYMENT CLEARING)           -->
    <!-- ============================================================== -->
    <div id="view-settle" class="hidden view-panel space-y-6">
        
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
                <h1 class="text-2xl font-extrabold text-on-surface tracking-tight">Settle & Reconcile</h1>
                <p class="text-xs text-on-surface-variant mt-0.5">Automated UPI payment station with real-time status polling</p>
            </div>
            <button onclick="openDebtMatrixModal()" class="qw-btn qw-btn-secondary text-xs">
                <span class="material-symbols-outlined text-[16px]">hub</span>
                <span>Debt Simplification Matrix</span>
            </button>
        </div>

        <!-- Success Alert Banner -->
        <div id="settleSuccessAlert" class="hidden p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 text-xs font-semibold flex items-center gap-2.5">
            <span class="material-symbols-outlined text-[18px]">verified</span>
            <span id="settleSuccessMsg"></span>
        </div>

        <!-- Settle Up Master Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            <!-- Left Column: Peer Debt Selection & Payment Details (5 cols) -->
            <div class="lg:col-span-5 qw-card p-5 sm:p-6 space-y-5">
                
                <!-- Owe / Owed Tabs -->
                <div class="grid grid-cols-2 gap-1 p-1 rounded-xl bg-surface-container border border-outline-variant">
                    <button type="button" id="tabBtnOwe" onclick="switchSettleTab('owe')" class="py-1.5 text-xs font-bold rounded-lg transition-all bg-surface-container-lowest text-rose-500 shadow-xs flex items-center justify-center gap-1.5">
                        <span>You Owe</span>
                        <span id="countYouOwe" class="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500/10 text-rose-500 font-mono font-bold">0</span>
                    </button>
                    <button type="button" id="tabBtnOwed" onclick="switchSettleTab('owed')" class="py-1.5 text-xs font-bold rounded-lg transition-all text-on-surface-variant hover:text-on-surface flex items-center justify-center gap-1.5">
                        <span>Owes You</span>
                        <span id="countOwesYou" class="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500/10 text-emerald-500 font-mono font-bold">0</span>
                    </button>
                </div>

                <!-- Peers List Container -->
                <div id="tabContentOwe" class="space-y-2">
                    <label class="block text-xs font-bold text-on-surface uppercase tracking-wider">Select Peer to Settle</label>
                    <div id="settlePeerCardsContainer" class="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto pr-1">
                        <!-- Populated dynamically -->
                    </div>
                </div>

                <div id="tabContentOwed" class="hidden space-y-2">
                    <p class="text-xs text-on-surface-variant">Remind peers who currently have pending shares payable to you:</p>
                    <div id="settleOwedCardsContainer" class="space-y-2"></div>
                </div>

                <!-- Settlement Input Form -->
                <div class="space-y-4 pt-3 border-t border-outline-variant">
                    <!-- Receiver Banner -->
                    <div class="p-3.5 rounded-2xl bg-surface-container flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <div id="settleReceiverAvatar" class="w-9 h-9 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-400 text-white font-bold text-xs flex items-center justify-center shadow-xs">U</div>
                            <div>
                                <span class="text-[10px] uppercase font-bold tracking-wider text-on-surface-variant">Paying To</span>
                                <h4 id="settleReceiverName" class="text-xs font-bold text-on-surface">Select a peer</h4>
                            </div>
                        </div>
                        <div class="text-right">
                            <span class="text-[10px] uppercase font-bold tracking-wider text-on-surface-variant">VPA Handle</span>
                            <div id="settleDisplayUpi" class="text-xs font-mono font-semibold text-primary">not set</div>
                        </div>
                    </div>

                    <!-- Amount Input -->
                    <div class="space-y-1.5">
                        <label class="block text-xs font-bold text-on-surface uppercase tracking-wider">Settlement Amount</label>
                        <div class="relative flex items-center">
                            <span class="absolute left-3.5 text-lg font-bold font-mono text-primary">₹</span>
                            <input id="settleAmountInput" type="number" step="1" min="1" placeholder="0" oninput="onSettleAmountChanged()" class="qw-input pl-9 text-lg font-bold font-mono py-2.5"/>
                        </div>
                        <!-- Quick Integer Increment Presets -->
                        <div class="flex items-center gap-1.5 pt-1 overflow-x-auto">
                            <span class="text-[10px] uppercase font-bold text-on-surface-variant flex items-center gap-1 flex-shrink-0">
                                <span class="material-symbols-outlined text-[13px] text-primary">add_circle</span>
                                <span>Quick Add:</span>
                            </span>
                            <button type="button" onclick="quickAddAmount('settleAmountInput', 100)" class="px-2.5 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs font-bold text-on-surface border border-outline-variant/30 hover:border-primary/40 transition-colors flex-shrink-0">+₹100</button>
                            <button type="button" onclick="quickAddAmount('settleAmountInput', 500)" class="px-2.5 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs font-bold text-on-surface border border-outline-variant/30 hover:border-primary/40 transition-colors flex-shrink-0">+₹500</button>
                            <button type="button" onclick="quickAddAmount('settleAmountInput', 1000)" class="px-2.5 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs font-bold text-on-surface border border-outline-variant/30 hover:border-primary/40 transition-colors flex-shrink-0">+₹1,000</button>
                            <button type="button" onclick="quickAddAmount('settleAmountInput', 2000)" class="px-2.5 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs font-bold text-on-surface border border-outline-variant/30 hover:border-primary/40 transition-colors flex-shrink-0">+₹2,000</button>
                        </div>
                    </div>

                    <!-- Notes Input -->
                    <div class="space-y-1.5">
                        <label class="block text-xs font-bold text-on-surface uppercase tracking-wider">Reference Note</label>
                        <input id="settleNotesInput" type="text" placeholder="e.g. Settle Goa trip share" class="qw-input text-xs py-2"/>
                    </div>

                    <!-- Payment Method Tabs -->
                    <div class="space-y-1.5">
                        <label class="block text-xs font-bold text-on-surface uppercase tracking-wider">Payment Method</label>
                        <div class="grid grid-cols-3 gap-2">
                            <button type="button" id="pmBtnUPI" onclick="setPaymentMethod('UPI')" class="p-2 rounded-xl text-xs font-bold border border-primary bg-primary/10 text-primary flex items-center justify-center gap-1.5">
                                <span class="material-symbols-outlined text-[16px]">qr_code_2</span>
                                <span>UPI QR</span>
                            </button>
                            <button type="button" id="pmBtnBank" onclick="setPaymentMethod('BANK')" class="p-2 rounded-xl text-xs font-bold border border-outline-variant text-on-surface-variant hover:text-on-surface flex items-center justify-center gap-1.5">
                                <span class="material-symbols-outlined text-[16px]">account_balance</span>
                                <span>Bank</span>
                            </button>
                            <button type="button" id="pmBtnCash" onclick="setPaymentMethod('CASH')" class="p-2 rounded-xl text-xs font-bold border border-outline-variant text-on-surface-variant hover:text-on-surface flex items-center justify-center gap-1.5">
                                <span class="material-symbols-outlined text-[16px]">payments</span>
                                <span>Cash</span>
                            </button>
                        </div>
                    </div>

                    <!-- Hidden fields for script handlers -->
                    <div class="hidden">
                        <span id="settlePayerName"></span>
                        <span id="settlePayerAvatar"></span>
                    </div>

                </div>

            </div>

            <!-- Right Column: Interactive UPI Station & Status Card (7 cols) -->
            <div class="lg:col-span-7 space-y-6">
                
                <!-- UPI Processing Station -->
                <div id="upiProcessingStation" class="qw-card p-6 space-y-5 flex flex-col items-center justify-center text-center">
                    <div class="flex items-center justify-between w-full">
                        <div class="flex items-center gap-2">
                            <span class="material-symbols-outlined text-primary text-[20px]">bolt</span>
                            <span class="text-xs font-bold uppercase tracking-wider text-on-surface">Instant UPI Station</span>
                        </div>
                        <span id="upiLiveStatusBadge" class="qw-badge bg-amber-500/10 text-amber-500 border border-amber-500/20">Waiting for Payment</span>
                    </div>

                    <!-- QR Code Canvas (Single Primary Display) -->
                    <div id="upiQrCodeContainer" class="p-4 rounded-2xl bg-white border border-slate-200 shadow-md inline-block">
                        <!-- Canvas / QR generated by script -->
                    </div>

                    <!-- Polling Status Text & Live Poller Indicator -->
                    <div class="space-y-1.5 max-w-sm">
                        <p id="upiPollingStatusText" class="text-xs text-on-surface-variant font-medium">Scan QR code using Google Pay, PhonePe, Paytm or any UPI App</p>
                        <div id="upiPollingPulseContainer" class="flex items-center justify-center gap-1.5 text-[11px] text-on-surface-variant">
                            <span class="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                            <span id="upiPollingNotice">Auto-Polling Active &bull; Listening for payment verification</span>
                            <span id="upiAutoSettlementNotice" class="hidden"></span>
                        </div>
                    </div>

                    <!-- Action Buttons: Open App & Confirm Settlement -->
                    <div class="w-full max-w-sm space-y-2">
                        <a id="upiIntentLink" href="#" class="qw-btn qw-btn-secondary w-full py-2.5 text-xs font-bold flex items-center justify-center gap-1.5">
                            <span class="material-symbols-outlined text-[16px]">open_in_new</span>
                            <span>Open UPI App on Device</span>
                        </a>

                        <button id="btnAutoQrSettle" onclick="handleQrPaymentAutoSettlement()" type="button" class="qw-btn qw-btn-primary w-full py-3 text-xs font-bold flex items-center justify-center gap-1.5 shadow-md active:scale-[0.98]">
                            <span class="material-symbols-outlined text-[18px]">verified</span>
                            <span>I Have Paid via UPI &bull; Confirm Settlement</span>
                        </button>
                    </div>

                    <p class="text-[11px] text-on-surface-variant max-w-xs">
                        Scan QR code with GPay, PhonePe, or Paytm. Once you have transferred the amount, click <strong>Confirm Settlement</strong> to record it in your ledger.
                    </p>
                </div>

                <!-- UPI Success Confirmation Card -->
                <div id="upiSuccessConfirmationCard" class="hidden qw-card p-6 border-emerald-500/30 bg-emerald-500/[0.03] space-y-4">
                    <div class="flex items-center gap-3 text-emerald-500">
                        <div class="w-10 h-10 rounded-2xl bg-emerald-500/20 flex items-center justify-center">
                            <span class="material-symbols-outlined text-[24px]">verified</span>
                        </div>
                        <div>
                            <h3 class="text-sm font-bold text-on-surface">Payment Verified & Settled</h3>
                            <p class="text-xs text-on-surface-variant">Ledger reconciled with database</p>
                        </div>
                    </div>
                    <div class="p-4 rounded-xl bg-surface-container space-y-2 text-xs font-mono">
                        <div class="flex justify-between">
                            <span class="text-on-surface-variant">Amount Reconciled:</span>
                            <span id="upiSuccessAmount" class="font-bold text-on-surface">₹0.00</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-on-surface-variant">Receiver VPA:</span>
                            <span id="upiSuccessReceiver" class="text-on-surface"></span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-on-surface-variant">Txn Ref ID:</span>
                            <span id="upiSuccessTxnRef" class="text-on-surface"></span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-on-surface-variant">Timestamp:</span>
                            <span id="upiSuccessTimestamp" class="text-on-surface"></span>
                        </div>
                        <div class="flex justify-between pt-2 border-t border-outline-variant">
                            <span class="text-on-surface-variant">Remaining Outstanding:</span>
                            <span id="upiSuccessOutstanding" class="font-bold text-emerald-500">₹0.00</span>
                        </div>
                    </div>
                    <button id="btnSettleAnother" type="button" onclick="resetSettleFormForNewTransaction()" class="qw-btn qw-btn-secondary w-full py-2.5 text-xs font-bold mt-2">
                        <span class="material-symbols-outlined text-[16px]">restart_alt</span>
                        <span>Settle Another Balance</span>
                    </button>
                </div>

                <!-- UPI Failed Confirmation Card -->
                <div id="upiFailedConfirmationCard" class="hidden qw-card p-6 border-rose-500/30 bg-rose-500/[0.03] space-y-3">
                    <div class="flex items-center gap-2 text-rose-500">
                        <span class="material-symbols-outlined text-[20px]">warning</span>
                        <h3 class="text-sm font-bold">Settlement Unsuccessful</h3>
                    </div>
                    <p id="upiFailedReason" class="text-xs text-on-surface-variant"></p>
                    <button id="btnRetryUpi" type="button" onclick="retryUpiPayment()" class="qw-btn qw-btn-secondary w-full py-2 text-xs font-bold mt-2">
                        <span class="material-symbols-outlined text-[16px]">refresh</span>
                        <span>Retry UPI Payment</span>
                    </button>
                </div>

                <!-- Non-UPI Fallback Station (Bank / Cash) -->
                <div id="nonUpiStation" class="hidden qw-card p-6 space-y-4">
                    <h3 class="text-sm font-bold text-on-surface">Manual Payment Confirmation</h3>
                    <p class="text-xs text-on-surface-variant">Confirm that bank transfer or cash exchange has physically occurred.</p>
                    <button id="btnConfirmManualSettlement" type="button" onclick="handleConfirmSettlement()" class="qw-btn qw-btn-primary w-full py-2.5 text-xs font-bold">
                        Confirm Manual Settlement
                    </button>
                </div>

                <!-- Hidden button for automated settle scripts -->
                <button id="btnAutoQrSettle" onclick="triggerAutoQrSettle()" class="hidden"></button>

            </div>

        </div>

    </div>

    <!-- ============================================================== -->
    <!-- VIEW 7: ANALYTICS (FINANCIAL INTELLIGENCE)                     -->
    <!-- ============================================================== -->
    <div id="view-analytics" class="hidden view-panel space-y-6">
        
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-extrabold text-on-surface tracking-tight">Financial Intelligence</h1>
                <p class="text-xs text-on-surface-variant mt-0.5">Comprehensive analytics, categorical breakdown, and burn rates</p>
            </div>
            <button onclick="exportAnalyticsPDF()" class="qw-btn qw-btn-secondary text-xs">
                <span class="material-symbols-outlined text-[16px]">picture_as_pdf</span>
                <span>Export Report</span>
            </button>
        </div>

        <!-- Analytics Date Filter -->
        <div class="qw-card p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div class="flex flex-wrap items-center gap-2.5">
                <span class="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-[16px] text-primary">date_range</span>
                    <span>Timeframe:</span>
                </span>
                <div class="flex items-center gap-1.5">
                    <input id="analyticsFromDate" type="date" onchange="applyAnalyticsDateFilter()" class="qw-input text-xs py-1.5 px-2.5 w-36" title="From Date"/>
                    <span class="text-on-surface-variant text-xs font-semibold">to</span>
                    <input id="analyticsToDate" type="date" onchange="applyAnalyticsDateFilter()" class="qw-input text-xs py-1.5 px-2.5 w-36" title="To Date"/>
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <button type="button" onclick="setAnalyticsDatePreset('all')" class="qw-btn qw-btn-secondary text-xs py-1 px-2.5">All Time</button>
                <button type="button" onclick="setAnalyticsDatePreset('month')" class="qw-btn qw-btn-secondary text-xs py-1 px-2.5">This Month</button>
                <button type="button" onclick="setAnalyticsDatePreset('30days')" class="qw-btn qw-btn-secondary text-xs py-1 px-2.5">Last 30 Days</button>
                <button id="btnResetAnalyticsFilters" type="button" onclick="resetAnalyticsDateFilter()" class="qw-btn qw-btn-secondary text-xs py-1 px-2.5 flex items-center gap-1" title="Reset date filter">
                    <span class="material-symbols-outlined text-[14px]">restart_alt</span>
                    <span>Reset</span>
                </button>
            </div>
        </div>

        <!-- Metric Highlights -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div class="qw-card p-5 space-y-1">
                <span class="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Cumulative Outward Share</span>
                <div id="analyticsTotalShare" class="text-2xl font-bold font-mono text-on-surface">₹0.00</div>
                <p class="text-[11px] text-on-surface-variant">Lifetime expense contribution</p>
            </div>
            <div class="qw-card p-5 space-y-1">
                <span class="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Tracked Categories</span>
                <div id="analyticsCatCount" class="text-2xl font-bold font-mono text-primary">0</div>
                <p class="text-[11px] text-on-surface-variant">Distinct spending sectors</p>
            </div>
            <div class="qw-card p-5 space-y-1">
                <span class="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Largest Single Expense</span>
                <div id="analyticsTopExpense" class="text-2xl font-bold font-mono text-indigo-600 dark:text-indigo-400">₹0.00</div>
                <p id="analyticsTopDesc" class="text-[11px] text-on-surface-variant truncate">None recorded</p>
            </div>
        </div>

        <!-- Charts Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div class="qw-card p-6 space-y-4">
                <h3 class="text-sm font-bold text-on-surface">Monthly Burn Trajectory</h3>
                <div class="h-64 relative">
                    <canvas id="analyticsMonthlyChart"></canvas>
                </div>
            </div>
            <div class="qw-card p-6 space-y-4">
                <h3 class="text-sm font-bold text-on-surface">Category Allocation</h3>
                <div class="h-64 relative">
                    <canvas id="analyticsCategoryChart"></canvas>
                </div>
            </div>
        </div>

    </div>

    <!-- ============================================================== -->
    <!-- VIEW 8: ACTIVITY FEED (CHRONOLOGICAL AUDIT LOG)                -->
    <!-- ============================================================== -->
    <div id="view-activity" class="hidden view-panel space-y-6">
        
        <div>
            <h1 class="text-2xl font-extrabold text-on-surface tracking-tight">Audit Log & Activity</h1>
            <p class="text-xs text-on-surface-variant mt-0.5">Immutable record of expense modifications, payments, and circle memberships</p>
        </div>

        <!-- Activity Filter Bar -->
        <div class="qw-card p-4 space-y-3">
            <div class="flex flex-col md:flex-row items-center gap-3">
                <div class="relative flex-1 w-full">
                    <span class="material-symbols-outlined absolute left-3 text-on-surface-variant text-[18px]">search</span>
                    <input id="activitySearchInput" oninput="filterActivityLog()" placeholder="Search audit trail, changes, members..." class="qw-input pl-9 text-xs py-2 w-full"/>
                </div>
                <div class="flex flex-wrap sm:flex-nowrap items-center gap-2.5 w-full md:w-auto text-xs">
                    <span class="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-[16px] text-primary">calendar_month</span>
                        <span>Date Range:</span>
                    </span>
                    <div class="flex items-center gap-1.5">
                        <input id="activityFromDate" type="date" onchange="filterActivityLog()" class="qw-input text-xs py-1.5 px-2.5 w-36" title="From Date"/>
                        <span class="text-on-surface-variant text-xs font-semibold">to</span>
                        <input id="activityToDate" type="date" onchange="filterActivityLog()" class="qw-input text-xs py-1.5 px-2.5 w-36" title="To Date"/>
                    </div>
                    <button id="btnResetActivityFilters" type="button" onclick="resetActivityFilters()" class="qw-btn qw-btn-secondary text-xs py-1.5 px-3 flex items-center gap-1" title="Reset activity filters">
                        <span class="material-symbols-outlined text-[15px]">filter_alt_off</span>
                        <span>Reset</span>
                    </button>
                </div>
            </div>
        </div>

        <div class="qw-card p-6">
            <div id="activityFullLogList" class="space-y-4">
                <!-- Populated dynamically by loadActivityFeed() -->
            </div>
        </div>

    </div>

    <!-- ============================================================== -->
    <!-- VIEW 9: CHAT & DISCUSSIONS                                     -->
    <!-- ============================================================== -->
    <div id="view-chat" class="hidden view-panel space-y-4">
        
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 h-[calc(100vh-10rem)]">
            
            <!-- Channels / Circles List (4 cols) -->
            <div class="lg:col-span-4 qw-card p-4 flex flex-col space-y-3 overflow-hidden">
                <div class="flex items-center justify-between pb-2 border-b border-outline-variant">
                    <h3 class="text-xs font-bold uppercase tracking-wider text-on-surface">Circle Threads</h3>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-primary/10 text-primary">Live</span>
                </div>
                <div id="chatConversationsList" class="flex-1 overflow-y-auto space-y-1.5 pr-1">
                    <!-- Populated dynamically -->
                </div>
            </div>

            <!-- Active Conversation Thread (8 cols) -->
            <div class="lg:col-span-8 qw-card p-5 flex flex-col justify-between overflow-hidden">
                <div class="pb-3 border-b border-outline-variant flex items-center justify-between">
                    <div>
                        <h3 id="activeChatTitle" class="text-sm font-bold text-on-surface">Select a Circle Thread</h3>
                        <p id="activeChatSubtitle" class="text-[11px] text-on-surface-variant">Real-time team discussion</p>
                    </div>
                </div>

                <!-- Messages Container -->
                <div id="activeChatMessagesArea" class="flex-1 overflow-y-auto py-4 space-y-3 pr-1">
                    <!-- Populated dynamically -->
                </div>

                <!-- Message Input Form -->
                <form onsubmit="event.preventDefault(); sendActiveChatMessage();" class="pt-3 border-t border-outline-variant flex items-center gap-2">
                    <input id="chatMessageInput" type="text" placeholder="Type a message or discuss an expense..." class="qw-input text-xs py-2.5 flex-1"/>
                    <button id="chatSendBtn" type="submit" class="qw-btn qw-btn-primary py-2.5 px-4 text-xs font-bold">
                        <span class="material-symbols-outlined text-[16px]">send</span>
                    </button>
                </form>
            </div>

        </div>

    </div>

    <!-- Master Admin System & Issue Tracker View -->
    ${getMasterAdminViewHtml()}
    `;
}

module.exports = { getViewsPart2Html };
