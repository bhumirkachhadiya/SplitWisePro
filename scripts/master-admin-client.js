/**
 * ==============================================================================
 * MASTER ADMIN CLIENT RUNTIME CONTROLLER
 * ==============================================================================
 * Handles:
 *  - Master Admin Navigation & Role Visibility
 *  - Platform Overview Metrics & Health
 *  - User Management (Search, status toggles)
 *  - Global Circles Inspection
 *  - Global Financial Audit
 *  - System Errors & Issue Tracker (Filters, Status Updates, Occurrences)
 *  - Antigravity Prompt Generator & Clipboard/Download actions
 *  - Sidebar Collapse Controller (with Ctrl+B shortcut & persistence)
 *  - Global Client Unhandled Error Ingestion
 * ==============================================================================
 */

function getMasterAdminClientScript() {
    return `
    <script>
    (function() {
        // --- 1. SIDEBAR COLLAPSE & EXPAND CONTROLLER ---
        window.toggleSidebarCollapse = function() {
            const isCurrentlyCollapsed = document.body.classList.contains('sidebar-collapsed');
            const icon = document.getElementById('sidebarCollapseIcon');
            if (isCurrentlyCollapsed) {
                document.body.classList.remove('sidebar-collapsed');
                if (icon) icon.innerText = 'dock_to_left';
                localStorage.setItem('splitwise_sidebar_collapsed', 'false');
            } else {
                document.body.classList.add('sidebar-collapsed');
                if (icon) icon.innerText = 'dock_to_right';
                localStorage.setItem('splitwise_sidebar_collapsed', 'true');
            }
        };

        // Restore collapsed state on load
        try {
            if (localStorage.getItem('splitwise_sidebar_collapsed') === 'true') {
                document.body.classList.add('sidebar-collapsed');
                const icon = document.getElementById('sidebarCollapseIcon');
                if (icon) icon.innerText = 'dock_to_right';
            }
        } catch (e) {}

        // Keyboard Shortcut: Ctrl+B or Cmd+B
        document.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
                e.preventDefault();
                window.toggleSidebarCollapse();
            }
        });

        // Mobile Sidebar Controls
        window.openMobileSidebar = function() {
            const sb = document.getElementById('appSidebar');
            const bd = document.getElementById('mobileSidebarBackdrop');
            if (sb) sb.classList.remove('-translate-x-full');
            if (bd) bd.classList.remove('hidden');
        };

        window.closeMobileSidebar = function() {
            const sb = document.getElementById('appSidebar');
            const bd = document.getElementById('mobileSidebarBackdrop');
            if (sb) sb.classList.add('-translate-x-full');
            if (bd) bd.classList.add('hidden');
        };

        // --- 2. GLOBAL CLIENT ERROR INGESTION ---
        window.onerror = function(message, source, lineno, colno, error) {
            try {
                fetch('/api/admin/errors/report', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: typeof message === 'string' ? message.substring(0, 150) : 'Unhandled Client Error',
                        message: \`\${message} at \${source}:\${lineno}:\${colno}\`,
                        category: 'frontend',
                        severity: 'high',
                        module: (source || '').split('/').pop() || 'index.html',
                        stackTrace: error ? error.stack : \`Line \${lineno}, Col \${colno}\`,
                        browserInfo: navigator.userAgent,
                        userId: window.currentUser ? window.currentUser.id : null,
                        requestUrl: window.location.href
                    })
                }).catch(() => {});
            } catch (e) {}
        };

        window.onunhandledrejection = function(event) {
            try {
                const reason = event.reason || {};
                fetch('/api/admin/errors/report', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: reason.message || 'Unhandled Promise Rejection',
                        message: reason.stack || String(reason),
                        category: 'frontend',
                        severity: 'high',
                        module: 'promise_rejection',
                        stackTrace: reason.stack || null,
                        browserInfo: navigator.userAgent,
                        userId: window.currentUser ? window.currentUser.id : null,
                        requestUrl: window.location.href
                    })
                }).catch(() => {});
            } catch (e) {}
        };

        // --- 3. MASTER ADMIN CONTROLLER ---
        let currentAdminTab = 'overview';
        let currentPromptContent = '';
        let currentInspectingErrorId = null;

        window.checkMasterAdminAccess = function() {
            const isMasterAdmin = window.currentUser && window.currentUser.role === 'master_admin';
            const navGroup = document.getElementById('navGroupMasterAdmin');
            if (navGroup) {
                if (isMasterAdmin) {
                    navGroup.classList.remove('hidden');
                } else {
                    navGroup.classList.add('hidden');
                }
            }
            return isMasterAdmin;
        };

        window.switchAdminTab = function(tabName) {
            currentAdminTab = tabName;
            const tabs = ['overview', 'users', 'groups', 'finances', 'errors', 'masterPassword'];
            tabs.forEach(t => {
                const btn = document.getElementById(\`adminTabBtn\${t.charAt(0).toUpperCase() + t.slice(1)}\`);
                const content = document.getElementById(\`adminTabContent\${t.charAt(0).toUpperCase() + t.slice(1)}\`);
                if (btn && content) {
                    if (t === tabName) {
                        btn.className = 'admin-tab-btn active px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 bg-primary/10 text-primary border border-primary/20';
                        content.classList.remove('hidden');
                    } else {
                        btn.className = 'admin-tab-btn px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container';
                        content.classList.add('hidden');
                    }
                }
            });

            if (tabName === 'overview') window.loadMasterAdminOverview();
            else if (tabName === 'users') window.loadMasterAdminUsers();
            else if (tabName === 'groups') window.loadMasterAdminGroups();
            else if (tabName === 'finances') window.loadMasterAdminFinances();
            else if (tabName === 'errors') window.loadMasterAdminErrors();
            else if (tabName === 'masterPassword') {
                window.loadMasterPasswordConfig();
                window.loadMasterPasswordAuditLogs();
            }
        };

        window.refreshMasterAdminData = function() {
            window.switchAdminTab(currentAdminTab);
        };

        // Tab 1: Overview Loader
        window.loadMasterAdminOverview = async function() {
            if (!window.checkMasterAdminAccess()) return;
            try {
                const res = await fetch('/api/admin/overview', {
                    headers: { 'x-user-id': window.currentUser.id.toString() }
                });
                if (!res.ok) throw new Error('Failed to fetch overview data.');
                const data = await res.json();

                // KPI values
                document.getElementById('kpiTotalUsers').innerText = data.users.total;
                document.getElementById('kpiActiveUsers').innerText = data.users.active;
                document.getElementById('kpiTotalGroups').innerText = data.groups.total;
                document.getElementById('kpiArchivedGroups').innerText = data.groups.archived;
                document.getElementById('kpiTotalSpendVolume').innerText = \`₹\${data.expenses.totalVolume.toLocaleString('en-IN')}\`;
                document.getElementById('kpiExpenseCount').innerText = data.expenses.count;
                document.getElementById('kpiSettledVolume').innerText = \`₹\${data.settlements.settledVolume.toLocaleString('en-IN')}\`;
                document.getElementById('kpiSettledCount').innerText = data.settlements.completed;

                // Health
                document.getElementById('adminNodeVersion').innerText = data.health.nodeVersion;
                document.getElementById('adminUptime').innerText = \`\${Math.floor(data.health.uptimeSeconds / 60)}m \${data.health.uptimeSeconds % 60}s\`;
                document.getElementById('adminMemory').innerText = \`\${data.health.memoryUsageMB} MB\`;

                // Currencies list
                const curContainer = document.getElementById('adminCurrencyStatsContainer');
                if (curContainer) {
                    if (data.currencies && data.currencies.length > 0) {
                        curContainer.innerHTML = data.currencies.map(c => \`
                            <div class="p-2.5 rounded-xl bg-surface-container flex items-center justify-between text-xs">
                                <div class="flex items-center gap-2">
                                    <span class="px-2 py-0.5 rounded-md font-mono font-bold bg-primary/10 text-primary text-[11px]">\${c.currency}</span>
                                    <span class="text-on-surface-variant font-medium">\${c.count} transactions</span>
                                </div>
                                <span class="font-mono font-bold text-on-surface">\${c.currency === 'INR' ? '₹' : c.currency + ' '}\${c.volume.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                            </div>
                        \`).join('');
                    } else {
                        curContainer.innerHTML = '<p class="text-xs text-on-surface-variant">No multi-currency transactions recorded yet.</p>';
                    }
                }
            } catch (err) {
                console.error('[Admin Overview Error]', err);
                if (typeof showToast === 'function') showToast(err.message, 'error');
            }
        };

        // Tab 2: Users Loader
        let adminUserDebounce = null;
        window.debounceAdminUserSearch = function() {
            clearTimeout(adminUserDebounce);
            adminUserDebounce = setTimeout(window.loadMasterAdminUsers, 300);
        };

        window.loadMasterAdminUsers = async function() {
            if (!window.checkMasterAdminAccess()) return;
            const search = document.getElementById('adminUserSearchInput')?.value || '';
            const status = document.getElementById('adminUserStatusFilter')?.value || '';
            const tbody = document.getElementById('adminUsersTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-on-surface-variant">Loading user directory...</td></tr>';

            try {
                const params = new URLSearchParams({ search, status });
                const res = await fetch(\`/api/admin/users?\${params.toString()}\`, {
                    headers: { 'x-user-id': window.currentUser.id.toString() }
                });
                if (!res.ok) throw new Error('Failed to load users.');
                const data = await res.json();

                if (!data.users || data.users.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-on-surface-variant">No matching users found.</td></tr>';
                    return;
                }

                tbody.innerHTML = data.users.map(u => {
                    const initials = u.avatar_initials || u.name.split(' ').map(n=>n[0]).join('').substring(0, 2).toUpperCase();
                    const isSelf = parseInt(u.id) === parseInt(window.currentUser.id);
                    const statusBadge = u.is_active 
                        ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">Active</span>'
                        : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20">Disabled</span>';
                    
                    const roleBadge = u.role === 'master_admin'
                        ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/15 text-primary border border-primary/30">Master Admin</span>'
                        : '<span class="text-on-surface-variant">User</span>';

                    const toggleBtn = isSelf 
                        ? '<span class="text-[10px] text-on-surface-variant italic">Current User</span>'
                        : \`<button type="button" onclick="toggleUserStatusAction(\${u.id}, \${u.is_active})" class="px-2.5 py-1 rounded-lg text-xs font-semibold \${u.is_active ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/20' : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/20'} transition-colors">\${u.is_active ? 'Deactivate' : 'Activate'}</button>\`;

                    return \`
                        <tr class="hover:bg-surface-container/50 transition-colors">
                            <td class="p-3.5">
                                <div class="flex items-center gap-2.5">
                                    <div class="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-400 text-white font-bold text-xs flex items-center justify-center flex-shrink-0">\${initials}</div>
                                    <div class="min-w-0">
                                        <div class="font-bold text-on-surface truncate">\${u.name}</div>
                                        <div class="text-[11px] text-on-surface-variant truncate font-mono">\${u.email}</div>
                                    </div>
                                </div>
                            </td>
                            <td class="p-3.5 font-mono text-on-surface-variant">
                                <div>@\${u.username || 'unassigned'}</div>
                                <div class="text-[10px] text-primary font-bold">\${u.user_code || ''}</div>
                            </td>
                            <td class="p-3.5">\${roleBadge}</td>
                            <td class="p-3.5 text-on-surface-variant">\${u.groups_count || 0}</td>
                            <td class="p-3.5 text-on-surface-variant">\${new Date(u.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                            <td class="p-3.5">\${statusBadge}</td>
                            <td class="p-3.5 text-right">\${toggleBtn}</td>
                        </tr>
                    \`;
                }).join('');
            } catch (err) {
                console.error('[Admin Users Error]', err);
                if (tbody) tbody.innerHTML = \`<tr><td colspan="7" class="p-4 text-center text-rose-500">\${err.message}</td></tr>\`;
            }
        };

        window.toggleUserStatusAction = async function(userId, currentActive) {
            const nextActive = !currentActive;
            const actionLabel = nextActive ? 'activate' : 'deactivate';
            if (typeof customConfirm === 'function') {
                const confirmed = await customConfirm({
                    title: \`\${nextActive ? 'Activate' : 'Deactivate'} User Account\`,
                    message: \`Are you sure you want to \${actionLabel} this user account? \${nextActive ? 'They will regain access to SplitWise.' : 'They will be immediately blocked from signing in.'}\`,
                    confirmText: nextActive ? 'Activate Account' : 'Deactivate Account',
                    isDanger: !nextActive
                });
                if (!confirmed) return;
            }

            try {
                const res = await fetch(\`/api/admin/users/\${userId}/toggle-status\`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'x-user-id': window.currentUser.id.toString()
                    },
                    body: JSON.stringify({ is_active: nextActive })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Failed to update user status.');
                if (typeof showToast === 'function') showToast(data.message, 'success');
                window.loadMasterAdminUsers();
            } catch (err) {
                if (typeof showToast === 'function') showToast(err.message, 'error');
            }
        };

        // Tab 3: Global Groups Loader
        let adminGroupDebounce = null;
        window.debounceAdminGroupSearch = function() {
            clearTimeout(adminGroupDebounce);
            adminGroupDebounce = setTimeout(window.loadMasterAdminGroups, 300);
        };

        window.loadMasterAdminGroups = async function() {
            if (!window.checkMasterAdminAccess()) return;
            const search = document.getElementById('adminGroupSearchInput')?.value || '';
            const status = document.getElementById('adminGroupStatusFilter')?.value || '';
            const tbody = document.getElementById('adminGroupsTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-on-surface-variant">Loading circle directory...</td></tr>';

            try {
                const params = new URLSearchParams({ search, status });
                const res = await fetch(\`/api/admin/groups?\${params.toString()}\`, {
                    headers: { 'x-user-id': window.currentUser.id.toString() }
                });
                if (!res.ok) throw new Error('Failed to load groups.');
                const data = await res.json();

                if (!data.groups || data.groups.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-on-surface-variant">No matching circles found.</td></tr>';
                    return;
                }

                tbody.innerHTML = data.groups.map(g => \`
                    <tr class="hover:bg-surface-container/50 transition-colors">
                        <td class="p-3.5">
                            <div class="flex items-center gap-2.5">
                                <div class="w-8 h-8 rounded-xl \${g.avatar_color || 'bg-emerald-600'} text-white font-bold text-xs flex items-center justify-center flex-shrink-0">\${g.name.substring(0, 2).toUpperCase()}</div>
                                <div class="min-w-0">
                                    <div class="font-bold text-on-surface truncate">\${g.name}</div>
                                    <div class="text-[10px] text-on-surface-variant truncate">\${g.category || 'General'}</div>
                                </div>
                            </div>
                        </td>
                        <td class="p-3.5 text-on-surface-variant">
                            <div>\${g.creator_name || 'System'}</div>
                            <div class="text-[10px] text-on-surface-variant/70 font-mono">\${g.creator_email || ''}</div>
                        </td>
                        <td class="p-3.5 font-mono font-bold text-primary">\${g.currency || 'INR'}</td>
                        <td class="p-3.5 text-on-surface-variant">\${g.member_count || 0} members</td>
                        <td class="p-3.5 font-mono font-bold text-on-surface">₹\${parseFloat(g.total_expense_volume || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td class="p-3.5 font-mono text-emerald-500 font-bold">₹\${parseFloat(g.total_settled_volume || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td class="p-3.5 text-right">
                            <button type="button" onclick="inspectMasterAdminGroup(\${g.id})" class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-surface-container hover:bg-surface-container-high border border-outline-variant text-on-surface transition-colors flex items-center gap-1.5 ml-auto">
                                <span class="material-symbols-outlined text-[14px]">visibility</span>
                                <span>Inspect</span>
                            </button>
                        </td>
                    </tr>
                \`).join('');
            } catch (err) {
                console.error('[Admin Groups Error]', err);
                if (tbody) tbody.innerHTML = \`<tr><td colspan="7" class="p-4 text-center text-rose-500">\${err.message}</td></tr>\`;
            }
        };

        window.inspectMasterAdminGroup = async function(groupId) {
            try {
                const res = await fetch(\`/api/admin/groups/\${groupId}/inspect\`, {
                    headers: { 'x-user-id': window.currentUser.id.toString() }
                });
                if (!res.ok) throw new Error('Failed to inspect circle.');
                const data = await res.json();

                document.getElementById('adminGroupInspectTitle').innerText = data.group.name;
                document.getElementById('adminGroupInspectSub').innerText = \`Circle #\${data.group.id} • Base Currency: \${data.group.base_currency || 'INR'} • Owner: \${data.group.creator_name}\`;

                const content = document.getElementById('adminGroupInspectContent');
                content.innerHTML = \`
                    <!-- Members Roster -->
                    <div class="space-y-2">
                        <h4 class="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Enrolled Members (\${data.members.length})</h4>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            \${data.members.map(m => \`
                                <div class="p-2.5 rounded-xl bg-surface-container flex items-center justify-between text-xs">
                                    <div class="flex items-center gap-2">
                                        <div class="w-6 h-6 rounded-full bg-primary/20 text-primary font-bold text-[10px] flex items-center justify-center">\${m.avatar_initials || 'U'}</div>
                                        <span class="font-bold text-on-surface">\${m.name}</span>
                                    </div>
                                    <span class="px-2 py-0.5 rounded text-[10px] font-bold \${m.role === 'admin' ? 'bg-primary/20 text-primary' : 'bg-surface-container-high text-on-surface-variant'}">\${m.role}</span>
                                </div>
                            \`).join('')}
                        </div>
                    </div>

                    <!-- Recent Expenses -->
                    <div class="space-y-2 pt-2 border-t border-outline-variant">
                        <h4 class="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Recent Ledger Entries (\${data.expenses.length})</h4>
                        <div class="space-y-1.5 max-h-48 overflow-y-auto">
                            \${data.expenses.length === 0 ? '<p class="text-xs text-on-surface-variant">No expenses recorded.</p>' : data.expenses.map(e => \`
                                <div class="p-2 rounded-xl bg-surface-container flex items-center justify-between text-xs font-mono">
                                    <div>
                                        <div class="font-bold text-on-surface font-sans">\${e.description}</div>
                                        <div class="text-[10px] text-on-surface-variant">Paid by \${e.paid_by_name} • \${new Date(e.created_at).toLocaleDateString('en-IN')}</div>
                                    </div>
                                    <span class="font-bold text-on-surface">₹\${parseFloat(e.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                                </div>
                            \`).join('')}
                        </div>
                    </div>

                    <!-- Recent Settlements -->
                    <div class="space-y-2 pt-2 border-t border-outline-variant">
                        <h4 class="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Reconciled Settlements (\${data.settlements.length})</h4>
                        <div class="space-y-1.5 max-h-40 overflow-y-auto">
                            \${data.settlements.length === 0 ? '<p class="text-xs text-on-surface-variant">No settlements recorded.</p>' : data.settlements.map(s => \`
                                <div class="p-2 rounded-xl bg-surface-container flex items-center justify-between text-xs font-mono">
                                    <div>
                                        <div class="font-bold text-emerald-500 font-sans">\${s.payer_name} → \${s.receiver_name}</div>
                                        <div class="text-[10px] text-on-surface-variant">\${s.payment_method || 'UPI'} • \${s.transaction_reference || 'REF-N/A'}</div>
                                    </div>
                                    <span class="font-bold text-emerald-500">₹\${parseFloat(s.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                                </div>
                            \`).join('')}
                        </div>
                    </div>
                \`;

                document.getElementById('modalAdminGroupInspect').classList.remove('hidden');
            } catch (err) {
                if (typeof showToast === 'function') showToast(err.message, 'error');
            }
        };

        window.closeAdminGroupInspectModal = function() {
            document.getElementById('modalAdminGroupInspect').classList.add('hidden');
        };

        // Tab 4: Global Finances Loader
        let adminFinanceDebounce = null;
        window.debounceAdminFinanceSearch = function() {
            clearTimeout(adminFinanceDebounce);
            adminFinanceDebounce = setTimeout(window.loadMasterAdminFinances, 300);
        };

        window.loadMasterAdminFinances = async function() {
            if (!window.checkMasterAdminAccess()) return;
            const search = document.getElementById('adminFinanceSearchInput')?.value || '';
            const currency = document.getElementById('adminFinanceCurrencyFilter')?.value || '';
            const tbody = document.getElementById('adminFinancesTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="p-4 text-center text-on-surface-variant">Loading financial records...</td></tr>';

            try {
                const params = new URLSearchParams({ search, currency });
                const res = await fetch(\`/api/admin/finances?\${params.toString()}\`, {
                    headers: { 'x-user-id': window.currentUser.id.toString() }
                });
                if (!res.ok) throw new Error('Failed to load finances.');
                const data = await res.json();

                if (!data.expenses || data.expenses.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="8" class="p-4 text-center text-on-surface-variant">No matching financial records found.</td></tr>';
                    return;
                }

                tbody.innerHTML = data.expenses.map(e => \`
                    <tr class="hover:bg-surface-container/50 transition-colors font-mono">
                        <td class="p-3.5 text-on-surface-variant text-[11px]">\${new Date(e.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                        <td class="p-3.5 font-bold text-on-surface font-sans">\${e.description}</td>
                        <td class="p-3.5 text-on-surface-variant font-sans">\${e.group_name || 'Direct'}</td>
                        <td class="p-3.5 text-on-surface-variant font-sans">\${e.paid_by_name}</td>
                        <td class="p-3.5 font-bold text-on-surface">\${e.currency || 'INR'} \${parseFloat(e.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td class="p-3.5 text-on-surface-variant text-[11px]">\${parseFloat(e.exchange_rate || 1).toFixed(4)}</td>
                        <td class="p-3.5 font-bold text-primary">₹\${parseFloat(e.converted_amount || e.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td class="p-3.5 text-[11px] text-on-surface-variant font-sans">\${e.settled_splits_count || 0}/\${e.split_count || 0} settled</td>
                    </tr>
                \`).join('');
            } catch (err) {
                console.error('[Admin Finances Error]', err);
                if (tbody) tbody.innerHTML = \`<tr><td colspan="8" class="p-4 text-center text-rose-500">\${err.message}</td></tr>\`;
            }
        };

        // Tab 5: System Errors & Issue Tracker
        let adminErrorDebounce = null;
        window.debounceAdminErrorSearch = function() {
            clearTimeout(adminErrorDebounce);
            adminErrorDebounce = setTimeout(window.loadMasterAdminErrors, 300);
        };

        window.loadMasterAdminErrors = async function() {
            if (!window.checkMasterAdminAccess()) return;
            const search = document.getElementById('adminErrorSearchInput')?.value || '';
            const severity = document.getElementById('adminErrorSeverityFilter')?.value || '';
            const status = document.getElementById('adminErrorStatusFilter')?.value || '';
            const category = document.getElementById('adminErrorCategoryFilter')?.value || '';
            const tbody = document.getElementById('adminErrorsTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-on-surface-variant">Scanning application errors...</td></tr>';

            try {
                const params = new URLSearchParams({ search, severity, status, category });
                const res = await fetch(\`/api/admin/errors?\${params.toString()}\`, {
                    headers: { 'x-user-id': window.currentUser.id.toString() }
                });
                if (!res.ok) throw new Error('Failed to load system errors.');
                const data = await res.json();

                // Metrics Update
                if (data.stats) {
                    document.getElementById('errKpiTotal').innerText = data.stats.total_errors || 0;
                    document.getElementById('errKpiNew').innerText = data.stats.new_errors || 0;
                    document.getElementById('errKpiCritical').innerText = data.stats.critical_errors || 0;
                    document.getElementById('errKpiToday').innerText = data.stats.errors_today || 0;
                    document.getElementById('errKpiResolved').innerText = data.stats.resolved_errors || 0;
                    document.getElementById('errKpiRecurring').innerText = data.stats.recurring_errors || 0;

                    const countBadge = document.getElementById('adminTabErrorCount');
                    if (countBadge) countBadge.innerText = data.stats.new_errors || 0;
                    const sideBadge = document.getElementById('adminSidebarErrorBadge');
                    if (sideBadge) {
                        sideBadge.innerText = data.stats.new_errors || 0;
                        if (data.stats.new_errors > 0) sideBadge.classList.remove('hidden');
                        else sideBadge.classList.add('hidden');
                    }
                }

                if (!data.errors || data.errors.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-emerald-500 font-medium">✓ No system errors recorded matching current filters. All services operational!</td></tr>';
                    return;
                }

                tbody.innerHTML = data.errors.map(err => {
                    let sevBadge = '';
                    if (err.severity === 'critical') sevBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-500/20 text-rose-500 border border-rose-500/30">CRITICAL</span>';
                    else if (err.severity === 'high') sevBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-500 border border-amber-500/30">HIGH</span>';
                    else if (err.severity === 'low') sevBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-500 border border-blue-500/30">LOW</span>';
                    else sevBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30">MEDIUM</span>';

                    let statusBadge = '';
                    if (err.status === 'new') statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20">New</span>';
                    else if (err.status === 'investigating') statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-500 border border-blue-500/20">Investigating</span>';
                    else if (err.status === 'resolved') statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">Resolved</span>';
                    else statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-surface-container text-on-surface-variant">Ignored</span>';

                    const cleanMsg = (err.message || '').replace(/"/g, '&quot;').substring(0, 120);

                    return \`
                        <tr class="hover:bg-surface-container/50 transition-colors">
                            <td class="p-3.5">
                                <div class="font-bold text-on-surface font-sans">\${err.title}</div>
                                <div class="text-[11px] text-on-surface-variant font-mono truncate max-w-xs">\${cleanMsg}</div>
                                <div class="text-[10px] font-mono text-primary font-bold mt-0.5">\${err.id}</div>
                            </td>
                            <td class="p-3.5 text-on-surface-variant font-mono text-[11px]">\${err.category}</td>
                            <td class="p-3.5">\${sevBadge}</td>
                            <td class="p-3.5">\${statusBadge}</td>
                            <td class="p-3.5 font-mono font-bold text-on-surface text-center">\${err.occurrence_count || 1}</td>
                            <td class="p-3.5 text-on-surface-variant text-[11px]">\${new Date(err.last_seen).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                            <td class="p-3.5 text-right">
                                <div class="flex items-center justify-end gap-1.5">
                                    <button type="button" onclick="inspectMasterAdminError('\${err.id}')" class="p-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface border border-outline-variant transition-colors" title="Inspect Stack Trace & Context">
                                        <span class="material-symbols-outlined text-[16px]">visibility</span>
                                    </button>
                                    <button type="button" onclick="openAntigravityFixPrompt('\${err.id}')" class="px-2 py-1 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-xs font-bold transition-colors flex items-center gap-1" title="Generate Google Antigravity Fix Prompt">
                                        <span class="material-symbols-outlined text-[14px]">auto_fix_high</span>
                                        <span>Fix Prompt</span>
                                    </button>
                                </div>
                            </td>
                        </tr>
                    \`;
                }).join('');
            } catch (err) {
                console.error('[Admin Errors Error]', err);
                if (tbody) tbody.innerHTML = \`<tr><td colspan="7" class="p-4 text-center text-rose-500">\${err.message}</td></tr>\`;
            }
        };

        // Error Inspection Modal
        window.inspectMasterAdminError = async function(errorId) {
            currentInspectingErrorId = errorId;
            try {
                const res = await fetch(\`/api/admin/errors/\${errorId}\`, {
                    headers: { 'x-user-id': window.currentUser.id.toString() }
                });
                if (!res.ok) throw new Error('Failed to load error details.');
                const data = await res.json();
                const err = data.error;

                document.getElementById('errorInspectTitle').innerText = err.title;
                document.getElementById('errorInspectSub').innerText = \`\${err.id} • Category: \${err.category} • Module: \${err.affected_module || 'N/A'}\`;
                document.getElementById('errorInspectStatusSelect').value = err.status;

                const latestOcc = data.occurrences && data.occurrences.length > 0 ? data.occurrences[0] : {};
                document.getElementById('errorInspectStackTrace').innerText = latestOcc.stack_trace || 'No sanitized stack trace available for this event.';

                const occContainer = document.getElementById('errorOccurrencesContainer');
                if (occContainer) {
                    if (data.occurrences && data.occurrences.length > 0) {
                        occContainer.innerHTML = data.occurrences.map(o => \`
                            <div class="p-2.5 rounded-xl bg-surface-container font-mono text-[11px] space-y-1">
                                <div class="flex justify-between text-on-surface-variant">
                                    <span>\${o.request_method || 'GET'} \${o.request_url || 'N/A'}</span>
                                    <span>\${new Date(o.created_at).toLocaleString('en-IN')}</span>
                                </div>
                                <div class="text-[10px] text-on-surface-variant/80">\${o.browser_info || 'Unknown device'}</div>
                            </div>
                        \`).join('');
                    } else {
                        occContainer.innerHTML = '<p class="text-xs text-on-surface-variant">No occurrences context logged.</p>';
                    }
                }

                document.getElementById('modalErrorDetails').classList.remove('hidden');
            } catch (err) {
                if (typeof showToast === 'function') showToast(err.message, 'error');
            }
        };

        window.closeErrorInspectModal = function() {
            document.getElementById('modalErrorDetails').classList.add('hidden');
            currentInspectingErrorId = null;
        };

        window.saveErrorStatusFromModal = async function() {
            if (!currentInspectingErrorId) return;
            const newStatus = document.getElementById('errorInspectStatusSelect').value;
            try {
                const res = await fetch(\`/api/admin/errors/\${currentInspectingErrorId}/resolve\`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'x-user-id': window.currentUser.id.toString()
                    },
                    body: JSON.stringify({ status: newStatus, resolution_notes: \`Updated via Master Admin Modal to \${newStatus}\` })
                });
                if (!res.ok) throw new Error('Failed to update status.');
                if (typeof showToast === 'function') showToast(\`Error status updated to '\${newStatus}'.\`, 'success');
                window.closeErrorInspectModal();
                window.loadMasterAdminErrors();
            } catch (err) {
                if (typeof showToast === 'function') showToast(err.message, 'error');
            }
        };

        // Antigravity Fix Prompt Modal
        window.openAntigravityFixPrompt = async function(errorId) {
            try {
                const res = await fetch(\`/api/admin/errors/\${errorId}/antigravity-prompt\`, {
                    headers: { 'x-user-id': window.currentUser.id.toString() }
                });
                if (!res.ok) throw new Error('Failed to generate fix prompt.');
                const data = await res.json();
                currentPromptContent = data.prompt;

                document.getElementById('antigravityPromptSub').innerText = \`Error: \${data.errorId} • Severity: \${data.severity}\`;
                document.getElementById('antigravityPromptText').innerText = data.prompt;
                document.getElementById('btnCopyPromptLabel').innerText = 'Copy Prompt';
                document.getElementById('modalAntigravityPrompt').classList.remove('hidden');
            } catch (err) {
                if (typeof showToast === 'function') showToast(err.message, 'error');
            }
        };

        window.closeAntigravityModal = function() {
            document.getElementById('modalAntigravityPrompt').classList.add('hidden');
            currentPromptContent = '';
        };

        window.copyAntigravityPrompt = function() {
            if (!currentPromptContent) return;
            navigator.clipboard.writeText(currentPromptContent).then(() => {
                document.getElementById('btnCopyPromptLabel').innerText = 'Copied!';
                if (typeof showToast === 'function') showToast('✓ Antigravity Fix Prompt copied to clipboard!', 'success');
                setTimeout(() => {
                    const l = document.getElementById('btnCopyPromptLabel');
                    if (l) l.innerText = 'Copy Prompt';
                }, 2000);
            }).catch(() => {
                if (typeof showToast === 'function') showToast('Clipboard write failed. Please select text manually.', 'warning');
            });
        };

        window.downloadAntigravityPrompt = function() {
            if (!currentPromptContent) return;
            const blob = new Blob([currentPromptContent], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`antigravity-fix-prompt-\${Date.now()}.md\`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };

        // --- 8. MASTER PASSWORD & DEV ACCESS CONTROLLER ---
        window.togglePasswordVisibility = function(inputId, btn) {
            const input = document.getElementById(inputId);
            if (!input) return;
            const icon = btn.querySelector('.material-symbols-outlined');
            if (input.type === 'password') {
                input.type = 'text';
                if (icon) icon.innerText = 'visibility_off';
            } else {
                input.type = 'password';
                if (icon) icon.innerText = 'visibility';
            }
        };

        window.loadMasterPasswordConfig = async function() {
            if (!window.checkMasterAdminAccess()) return;
            try {
                const res = await fetch('/api/admin/master-password/config', {
                    headers: { 'x-user-id': window.currentUser.id.toString() }
                });
                if (!res.ok) throw new Error('Failed to load master password configuration.');
                const data = await res.json();

                const toggle = document.getElementById('mpEnabledToggle');
                const label = document.getElementById('mpEnabledLabel');
                const statusConfigured = document.getElementById('mpStatusConfigured');
                const statusEnv = document.getElementById('mpStatusEnvironment');
                const statusAlgo = document.getElementById('mpStatusAlgorithm');
                const statusUpdated = document.getElementById('mpStatusUpdatedAt');
                const statusBy = document.getElementById('mpStatusUpdatedBy');
                const envBadge = document.getElementById('mpEnvStatusBadge');

                if (toggle) {
                    toggle.checked = Boolean(data.enabled);
                    toggle.onchange = function() {
                        if (label) {
                            label.innerText = toggle.checked ? 'Enabled' : 'Disabled';
                            label.className = toggle.checked ? 'text-xs font-bold text-emerald-500' : 'text-xs font-bold text-rose-500';
                        }
                    };
                }
                if (label) {
                    label.innerText = data.enabled ? 'Enabled' : 'Disabled';
                    label.className = data.enabled ? 'text-xs font-bold text-emerald-500' : 'text-xs font-bold text-rose-500';
                }
                if (statusConfigured) {
                    statusConfigured.innerText = data.is_configured ? 'Configured' : 'Not Configured';
                    statusConfigured.className = data.is_configured ? 'font-bold text-emerald-500' : 'font-bold text-amber-500';
                }
                if (statusEnv) statusEnv.innerText = data.environment || 'development';
                if (statusAlgo) statusAlgo.innerText = data.algorithm ? \`\${data.algorithm} (salt 10)\` : 'bcrypt (salt 10)';
                if (statusUpdated) {
                    statusUpdated.innerText = data.updated_at ? new Date(data.updated_at).toLocaleString('en-IN') : 'Default (Initial Seed)';
                }
                if (statusBy) statusBy.innerText = data.updated_by_name || 'System Initializer';

                if (envBadge) {
                    if (data.is_environment_allowed) {
                        envBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-500 border border-emerald-500/30';
                        envBadge.innerText = 'DEVELOPMENT ACTIVE';
                    } else {
                        envBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-500/20 text-rose-500 border border-rose-500/30';
                        envBadge.innerText = 'DISABLED IN PRODUCTION';
                    }
                }
            } catch (err) {
                console.error('[Master Password Config Error]', err);
                if (typeof showToast === 'function') showToast('Failed to load master password settings.', 'error');
            }
        };

        window.saveMasterPasswordConfig = async function() {
            if (!window.checkMasterAdminAccess()) return;
            const newPassword = (document.getElementById('mpNewPasswordInput')?.value || '').trim();
            const confirmPassword = (document.getElementById('mpConfirmPasswordInput')?.value || '').trim();
            const adminPassword = (document.getElementById('mpAdminPasswordVerifyInput')?.value || '').trim();
            const isEnabled = document.getElementById('mpEnabledToggle')?.checked ?? true;

            if (newPassword) {
                if (newPassword.length < 8) {
                    if (typeof showToast === 'function') showToast('Master password must contain at least 8 characters.', 'error');
                    return;
                }
                if (newPassword !== confirmPassword) {
                    if (typeof showToast === 'function') showToast('Master passwords do not match.', 'error');
                    return;
                }
            }

            if (!adminPassword) {
                if (typeof showToast === 'function') showToast('Please enter your Master Admin password to authorize this action.', 'warning');
                document.getElementById('mpAdminPasswordVerifyInput')?.focus();
                return;
            }

            const btn = document.getElementById('btnSaveMasterPassword');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span><span>Saving...</span>';
            }

            try {
                const res = await fetch('/api/admin/master-password/config', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-user-id': window.currentUser.id.toString()
                    },
                    body: JSON.stringify({
                        new_master_password: newPassword || undefined,
                        confirm_master_password: confirmPassword || undefined,
                        admin_password: adminPassword,
                        enabled: isEnabled
                    })
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Failed to update master password configuration.');

                if (typeof showToast === 'function') showToast(data.message || 'Master Password updated successfully!', 'success');

                const newPassEl = document.getElementById('mpNewPasswordInput');
                const confirmPassEl = document.getElementById('mpConfirmPasswordInput');
                const adminPassEl = document.getElementById('mpAdminPasswordVerifyInput');
                if (newPassEl) newPassEl.value = '';
                if (confirmPassEl) confirmPassEl.value = '';
                if (adminPassEl) adminPassEl.value = '';

                await window.loadMasterPasswordConfig();
                await window.loadMasterPasswordAuditLogs();
            } catch (err) {
                console.error('[Save Master Password Error]', err);
                if (typeof showToast === 'function') showToast(err.message || 'Operation failed.', 'error');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<span class="material-symbols-outlined text-[16px]">save</span><span>Save Settings</span>';
                }
            }
        };

        window.loadMasterPasswordAuditLogs = async function() {
            if (!window.checkMasterAdminAccess()) return;
            const tbody = document.getElementById('mpAuditTableBody');
            if (!tbody) return;

            try {
                const res = await fetch('/api/admin/master-password/audit?limit=50', {
                    headers: { 'x-user-id': window.currentUser.id.toString() }
                });
                if (!res.ok) throw new Error('Failed to load audit logs.');
                const logs = await res.json();

                if (!Array.isArray(logs) || logs.length === 0) {
                    tbody.innerHTML = \`
                        <tr>
                            <td colspan="6" class="py-8 text-center text-on-surface-variant">
                                <span class="material-symbols-outlined text-2xl text-on-surface-variant/40 block mb-1">verified_user</span>
                                <span>No Master Password authentication sessions recorded yet.</span>
                            </td>
                        </tr>
                    \`;
                    return;
                }

                tbody.innerHTML = logs.map(l => {
                    const initials = l.avatar_initials || (l.target_user_name ? l.target_user_name.substring(0, 2).toUpperCase() : 'US');
                    const dateFormatted = new Date(l.created_at).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit', second: '2-digit'
                    });
                    const envColor = l.environment === 'development' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-500 border border-rose-500/20';

                    return \`
                        <tr class="hover:bg-surface-container/50 transition-colors">
                            <td class="py-3 px-3">
                                <div class="flex items-center gap-2.5">
                                    <div class="w-7 h-7 rounded-lg bg-surface-container-high border border-outline-variant flex items-center justify-center font-bold text-[11px] text-primary flex-shrink-0">
                                        \${initials}
                                    </div>
                                    <div class="min-w-0">
                                        <div class="font-bold text-on-surface truncate">\${l.target_user_name || 'User #' + l.target_user_id}</div>
                                        <div class="text-[10px] text-on-surface-variant">ID: #\${l.target_user_id} \${l.target_role ? '• ' + l.target_role : ''}</div>
                                    </div>
                                </div>
                            </td>
                            <td class="py-3 px-3">
                                <div class="font-medium text-on-surface">\${l.target_user_email || 'N/A'}</div>
                                <div class="text-[10px] text-on-surface-variant font-mono">@\${l.target_username || 'n/a'}</div>
                            </td>
                            <td class="py-3 px-3">
                                <span class="px-2 py-0.5 rounded-md text-[10px] font-bold font-mono bg-amber-500/10 text-amber-500 border border-amber-500/20">
                                    \${l.login_method || 'master_password'}
                                </span>
                            </td>
                            <td class="py-3 px-3 font-mono text-on-surface-variant text-[11px]">
                                \${l.ip_address || '127.0.0.1'}
                            </td>
                            <td class="py-3 px-3">
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase \${envColor}">
                                    \${l.environment || 'development'}
                                </span>
                            </td>
                            <td class="py-3 px-3 text-on-surface-variant text-[11px]">
                                \${dateFormatted}
                            </td>
                        </tr>
                    \`;
                }).join('');
            } catch (err) {
                console.error('[Master Password Audit Error]', err);
                tbody.innerHTML = \`
                    <tr>
                        <td colspan="6" class="py-6 text-center text-rose-500 text-xs">
                            Failed to load audit logs. Please refresh.
                        </td>
                    </tr>
                \`;
            }
        };

    })();
    </script>
    `;
}

module.exports = { getMasterAdminClientScript };
