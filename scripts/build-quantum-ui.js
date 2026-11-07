const fs = require('fs');
const path = require('path');

const { getAuthScreenHtml } = require('./templates/auth-screen');
const { getNavigationShellHtml } = require('./templates/navigation-shell');
const { getViewsPart1Html } = require('./templates/views-part1');
const { getViewsPart2Html } = require('./templates/views-part2');
const { getAiAssistantDrawerHtml } = require('./templates/ai-assistant-drawer');
const { getModalsHtml } = require('./templates/modals');
const { getMasterAdminClientScript } = require('./master-admin-client');

console.log('1. Loading backup HTML...');
const backupPath = path.join(__dirname, '..', 'index.html.backup');
const originalContent = fs.readFileSync(backupPath, 'utf8');

// Find script 6 (Application Logic)
const scriptStartIndex = originalContent.indexOf('<script>\n        const API =');
if (scriptStartIndex === -1) {
    throw new Error('Could not find start of application logic script');
}

let scriptPart = originalContent.slice(scriptStartIndex);

// Polish Chart Colors in scriptPart for modern Stripe/Linear aesthetics
scriptPart = scriptPart
    .replace(/'#006c4b'/g, "'#10b981'")
    .replace(/'#78d9af'/g, "'#6366f1'")
    .replace(/'#059669'/g, "'#10b981'");

// Integer amount step in all modals & split engine rows
scriptPart = scriptPart
    .replace('id="editExpAmount" type="number" step="0.01"', 'id="editExpAmount" type="number" step="1"')
    .replace('id="correctionExpAmount" type="number" step="0.01"', 'id="correctionExpAmount" type="number" step="1"')
    .replace('<input type="number" step="0.01" value="0.00" oninput="onCustomSplitInput(this)" class="split-custom-input', '<input type="number" step="1" min="0" value="0" oninput="onCustomSplitInput(this)" class="split-custom-input')
    .replace('<input type="number" step="0.01" min="0" value="${share.toFixed(2)}" oninput="onEditSplitExactChanged()" class="edit-exact-input', '<input type="number" step="1" min="0" value="${Math.round(share)}" oninput="onEditSplitExactChanged()" class="edit-exact-input')
    .replace('<input type="number" step="0.01" min="0" value="${parseFloat(s.amount).toFixed(2)}"', '<input type="number" step="1" min="0" value="${Math.round(parseFloat(s.amount))}"')
    .replace(
        '<span class="px-2 py-0.5 rounded text-[10px] sm:text-[11px] bg-secondary-container text-on-secondary-container font-semibold">${exp.group_name || \'Group\'}</span>',
        '<span class="px-2.5 py-0.5 rounded-lg text-[10px] sm:text-[11px] bg-secondary-container text-on-secondary-container border border-secondary font-bold tracking-wide shadow-xs">${exp.group_name || \'Group\'}</span>'
    );

// 1. Guard updateSplitStatusBadge safely against null
const safeUpdateSplitStatusBadge = `function updateSplitStatusBadge(isBalanced, text) {
            const container = document.getElementById('splitStatusBadgeContainer');
            const icon = document.getElementById('splitStatusIcon');
            const badge = document.getElementById('splitStatusBadge');

            if (badge) badge.innerText = text;

            if (isBalanced) {
                if (container) container.className = 'flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20';
                if (icon) icon.innerText = 'verified';
            } else {
                if (container) container.className = 'flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-500 border border-rose-500/20';
                if (icon) icon.innerText = 'error';
            }
        }`;

scriptPart = scriptPart.replace(
    /function updateSplitStatusBadge\s*\([^)]*\)\s*\{[\s\S]*?icon\.innerText\s*=\s*'error';\s*\}\s*\}/,
    safeUpdateSplitStatusBadge
);

// 2. Global helper aliases for robust event handling
const globalAliases = `
        // Global aliases and fallbacks for robust event handling
        window.handleSettleAmountChange = function(val) {
            if (typeof onSettleAmountChanged === 'function') onSettleAmountChanged();
        };
        window.handleManualSettlementSubmit = function() {
            if (typeof handleConfirmSettlement === 'function') return handleConfirmSettlement();
        };
        window.handleQrPaymentAutoSettlement = function() {
            if (typeof handleQrPaymentAutoSettlement === 'function') return handleQrPaymentAutoSettlement();
        };
        // Master Search Implementation
        window.executeMasterSearch = function() {
            const searchInput = document.getElementById('globalSearchInput');
            const query = (searchInput ? searchInput.value : '').trim();
            window.closeMasterSearchDropdown();

            // Navigate to Ledger & Spends view
            if (typeof navigateTo === 'function') {
                navigateTo('expenses');
            }

            // Sync with Ledger search box and apply filters
            setTimeout(() => {
                const expSearch = document.getElementById('expenseListSearch');
                if (expSearch) {
                    expSearch.value = query;
                    if (typeof applyExpenseFilters === 'function') {
                        applyExpenseFilters();
                    } else if (typeof filterExpensesList === 'function') {
                        filterExpensesList();
                    }
                    expSearch.focus();
                }
            }, 100);
        };

        window.handleGlobalSearch = function(query) {
            window.handleMasterSearchInput(query);
        };

        window.handleMasterSearchInput = function(query) {
            const clearBtn = document.getElementById('masterSearchClearBtn');
            if (clearBtn) {
                if (query && query.trim().length > 0) {
                    clearBtn.classList.remove('hidden');
                } else {
                    clearBtn.classList.add('hidden');
                }
            }
            window.updateMasterSearchResults(query);
        };

        window.handleMasterSearchKeydown = function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                window.executeMasterSearch();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                window.closeMasterSearchDropdown();
                const s = document.getElementById('globalSearchInput');
                if (s) s.blur();
            }
        };

        window.handleMasterSearchFocus = function() {
            const query = document.getElementById('globalSearchInput')?.value || '';
            window.updateMasterSearchResults(query);
        };

        window.clearMasterSearch = function() {
            const searchInput = document.getElementById('globalSearchInput');
            if (searchInput) searchInput.value = '';
            const clearBtn = document.getElementById('masterSearchClearBtn');
            if (clearBtn) clearBtn.classList.add('hidden');
            window.updateMasterSearchResults('');

            // Also clear Ledger search if on expenses view
            const expSearch = document.getElementById('expenseListSearch');
            if (expSearch) {
                expSearch.value = '';
                if (typeof applyExpenseFilters === 'function') applyExpenseFilters();
            }
        };

        window.closeMasterSearchDropdown = function() {
            const dd = document.getElementById('masterSearchDropdown');
            if (dd) dd.classList.add('hidden');
        };

        window.selectMasterSearchExpense = function(expId, desc) {
            window.closeMasterSearchDropdown();
            if (typeof navigateTo === 'function') navigateTo('expenses');
            setTimeout(() => {
                const s = document.getElementById('expenseListSearch');
                if (s) {
                    s.value = desc;
                    if (typeof applyExpenseFilters === 'function') applyExpenseFilters();
                }
            }, 100);
        };

        window.selectMasterSearchGroup = function(groupId) {
            window.closeMasterSearchDropdown();
            if (typeof navigateTo === 'function') navigateTo('expenses');
            setTimeout(() => {
                const g = document.getElementById('expenseGroupFilter');
                if (g) {
                    g.value = groupId;
                    if (typeof applyExpenseFilters === 'function') applyExpenseFilters();
                }
            }, 100);
        };

        window.selectMasterSearchPeer = function(peerId) {
            window.closeMasterSearchDropdown();
            if (typeof navigateTo === 'function') navigateTo('settle');
        };

        window.updateMasterSearchResults = function(rawQuery) {
            const dd = document.getElementById('masterSearchDropdown');
            if (!dd) return;

            const q = (rawQuery || '').trim().toLowerCase();
            dd.classList.remove('hidden');

            if (!q) {
                dd.innerHTML = \`
                    <div class="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant flex items-center justify-between">
                        <span>Quick Navigation</span>
                        <span class="text-[9px] font-normal text-on-surface-variant/70">Press Enter to search Ledger</span>
                    </div>
                    <div class="space-y-1">
                        <button type="button" onclick="window.closeMasterSearchDropdown(); navigateTo('expenses');" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-surface-container transition-colors text-left text-xs font-medium text-on-surface">
                            <span class="material-symbols-outlined text-[16px] text-primary">receipt_long</span>
                            <span class="flex-1">Ledger & Spends</span>
                            <span class="text-[10px] text-on-surface-variant">View all transactions</span>
                        </button>
                        <button type="button" onclick="window.closeMasterSearchDropdown(); navigateTo('add-expense');" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-surface-container transition-colors text-left text-xs font-medium text-on-surface">
                            <span class="material-symbols-outlined text-[16px] text-emerald-500">add_circle</span>
                            <span class="flex-1">Record New Expense</span>
                            <span class="text-[10px] text-on-surface-variant">Expense studio</span>
                        </button>
                        <button type="button" onclick="window.closeMasterSearchDropdown(); navigateTo('settle');" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-surface-container transition-colors text-left text-xs font-medium text-on-surface">
                            <span class="material-symbols-outlined text-[16px] text-indigo-600 dark:text-indigo-400">payments</span>
                            <span class="flex-1">Settle & Reconcile</span>
                            <span class="text-[10px] text-on-surface-variant">UPI & debt clearing</span>
                        </button>
                        <button type="button" onclick="window.closeMasterSearchDropdown(); navigateTo('groups');" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-surface-container transition-colors text-left text-xs font-medium text-on-surface">
                            <span class="material-symbols-outlined text-[16px] text-amber-500">groups</span>
                            <span class="flex-1">Circles & Vaults</span>
                            <span class="text-[10px] text-on-surface-variant">Manage groups</span>
                        </button>
                        <button type="button" onclick="window.closeMasterSearchDropdown(); navigateTo('analytics');" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-surface-container transition-colors text-left text-xs font-medium text-on-surface">
                            <span class="material-symbols-outlined text-[16px] text-teal-400">monitoring</span>
                            <span class="flex-1">Financial Intelligence</span>
                            <span class="text-[10px] text-on-surface-variant">Analytics & reports</span>
                        </button>
                    </div>
                \`;
                return;
            }

            // Search matching expenses
            const expensesList = Array.isArray(window.allExpenses) ? window.allExpenses : [];
            const matchedExpenses = expensesList.filter(e => 
                (e.description || '').toLowerCase().includes(q) || 
                (e.group_name || '').toLowerCase().includes(q) || 
                (e.paid_by_name || '').toLowerCase().includes(q) ||
                (e.category || '').toLowerCase().includes(q)
            ).slice(0, 5);

            // Search matching groups
            const groupsList = Array.isArray(window.allGroups) ? window.allGroups : [];
            const matchedGroups = groupsList.filter(g => 
                (g.name || '').toLowerCase().includes(q) || 
                (g.category || '').toLowerCase().includes(q)
            ).slice(0, 3);

            let html = '';

            if (matchedExpenses.length > 0) {
                html += \`
                    <div class="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant flex items-center justify-between">
                        <span>Matching Expenses (\${matchedExpenses.length})</span>
                    </div>
                    <div class="space-y-1">
                \`;
                matchedExpenses.forEach(exp => {
                    const amt = parseFloat(exp.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
                    const dateStr = exp.expense_date ? new Date(exp.expense_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
                    const cleanDesc = (exp.description || '').replace(/'/g, "\\\\'");
                    html += \`
                        <button type="button" onclick="selectMasterSearchExpense(\${exp.id}, '\${cleanDesc}')" class="w-full flex items-center justify-between p-2 rounded-xl hover:bg-surface-container transition-colors text-left text-xs">
                            <div class="min-w-0 flex-1 mr-3">
                                <div class="font-bold text-on-surface truncate flex items-center gap-1.5">
                                    <span class="material-symbols-outlined text-[15px] text-primary flex-shrink-0">receipt</span>
                                    <span class="truncate">\${exp.description}</span>
                                </div>
                                <div class="text-[10px] text-on-surface-variant flex items-center gap-1.5 mt-0.5">
                                    <span>\${exp.group_name || 'Personal'}</span>
                                    <span>•</span>
                                    <span>\${dateStr}</span>
                                    <span>•</span>
                                    <span>Paid by \${exp.paid_by_name || 'User'}</span>
                                </div>
                            </div>
                            <span class="font-bold font-mono text-on-surface flex-shrink-0">₹\${amt}</span>
                        </button>
                    \`;
                });
                html += \`</div>\`;
            }

            if (matchedGroups.length > 0) {
                html += \`
                    <div class="px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant border-t border-outline-variant/30 flex items-center justify-between">
                        <span>Matching Circles (\${matchedGroups.length})</span>
                    </div>
                    <div class="space-y-1">
                \`;
                matchedGroups.forEach(grp => {
                    html += \`
                        <button type="button" onclick="selectMasterSearchGroup(\${grp.id})" class="w-full flex items-center justify-between p-2 rounded-xl hover:bg-surface-container transition-colors text-left text-xs">
                            <div class="flex items-center gap-2">
                                <span class="material-symbols-outlined text-[16px] text-amber-500">groups</span>
                                <span class="font-semibold text-on-surface">\${grp.name}</span>
                            </div>
                            <span class="text-[10px] px-2 py-0.5 rounded bg-surface-container text-on-surface-variant">\${grp.category || 'Shared Circle'}</span>
                        </button>
                    \`;
                });
                html += \`</div>\`;
            }

            if (matchedExpenses.length === 0 && matchedGroups.length === 0) {
                html += \`
                    <div class="p-6 text-center text-xs text-on-surface-variant">
                        <span class="material-symbols-outlined text-3xl mb-1 text-on-surface-variant/40 block">search_off</span>
                        <span>No records matching "<strong>\${q}</strong>"</span>
                        <div class="mt-2">
                            <button type="button" onclick="executeMasterSearch()" class="qw-btn qw-btn-primary py-1 px-3 text-xs">Search Ledger Anyway</button>
                        </div>
                    </div>
                \`;
            } else {
                html += \`
                    <div class="pt-2 border-t border-outline-variant/30 flex items-center justify-between text-[11px] text-on-surface-variant px-1">
                        <span>Press <kbd class="px-1.5 py-0.5 rounded bg-surface-container font-mono font-bold text-[10px]">Enter</kbd> or click 🔍 to view all</span>
                        <button type="button" onclick="executeMasterSearch()" class="text-primary font-bold hover:underline flex items-center gap-0.5">
                            <span>Open in Ledger</span>
                            <span class="material-symbols-outlined text-[13px]">arrow_forward</span>
                        </button>
                    </div>
                \`;
            }

            dd.innerHTML = html;
        };

        // Close search dropdown on click outside
        document.addEventListener('click', function(e) {
            const container = document.getElementById('masterSearchContainer');
            if (container && !container.contains(e.target)) {
                window.closeMasterSearchDropdown();
            }
        });

        window.switchSettleTab = function(tab) {
            if (typeof switchBalanceTab === 'function') return switchBalanceTab(tab);
        };
        window.handleGroupChange = function(val) {
            if (typeof onExpenseGroupChange === 'function') return onExpenseGroupChange(val);
        };
        window.handleAmountInput = function(val) {
            if (typeof onAmountChanged === 'function') return onAmountChanged(val);
            if (typeof onSplitModeChanged === 'function') return onSplitModeChanged();
        };
        window.filterExpensesList = function() {
            if (typeof applyExpenseFilters === 'function') return applyExpenseFilters();
        };
        window.exportExpensesCSV = function() {
            if (typeof exportToCSV === 'function') return exportToCSV();
        };
        window.exportExpensesToCSV = function() {
            if (typeof exportToCSV === 'function') return exportToCSV();
        };

        // Group management modal handlers & safe bindings
        window.openEditGroupModal = function(groupId) {
            let g = (Array.isArray(window.allGroups) ? window.allGroups : []).find(gr => String(gr.id) === String(groupId));
            if (!g && typeof allGroups !== 'undefined' && Array.isArray(allGroups)) {
                g = allGroups.find(gr => String(gr.id) === String(groupId));
            }
            if (!g) {
                if (typeof showToast === 'function') showToast('Group not found or still loading.', 'warning');
                return;
            }
            const idEl = document.getElementById('editGroupIdInput');
            const nameEl = document.getElementById('editGroupNameInput');
            const descEl = document.getElementById('editGroupDescInput');
            const catEl = document.getElementById('editGroupCategorySelect');
            const modalEl = document.getElementById('editGroupModal');

            if (idEl) idEl.value = g.id;
            if (nameEl) nameEl.value = g.name || '';
            if (descEl) descEl.value = g.description || '';
            if (catEl) catEl.value = g.category || 'General';
            if (modalEl) modalEl.classList.remove('hidden');
        };

        window.closeEditGroupModal = function() {
            const modalEl = document.getElementById('editGroupModal');
            if (modalEl) modalEl.classList.add('hidden');
        };

        window.openDeleteGroupModal = function(groupId) {
            let g = (Array.isArray(window.allGroups) ? window.allGroups : []).find(gr => String(gr.id) === String(groupId));
            if (!g && typeof allGroups !== 'undefined' && Array.isArray(allGroups)) {
                g = allGroups.find(gr => String(gr.id) === String(groupId));
            }
            if (!g) {
                if (typeof showToast === 'function') showToast('Group not found or still loading.', 'warning');
                return;
            }
            window.pendingGroupToDelete = g.id;
            const detailsEl = document.getElementById('deleteGroupModalDetails');
            if (detailsEl) {
                const memberCount = g.member_count || (Array.isArray(g.members) ? g.members.length : 0);
                detailsEl.innerHTML = \`
                    <div class="flex items-center justify-between">
                        <span class="font-bold text-on-surface">\${g.name}</span>
                        <span class="font-bold text-error">\${memberCount} Members</span>
                    </div>
                \`;
            }
            const modalEl = document.getElementById('deleteGroupModal');
            if (modalEl) modalEl.classList.remove('hidden');
        };

        window.closeDeleteGroupModal = function() {
            window.pendingGroupToDelete = null;
            const modalEl = document.getElementById('deleteGroupModal');
            if (modalEl) modalEl.classList.add('hidden');
        };

        window.confirmDeleteGroup = async function() {
            const id = window.pendingGroupToDelete;
            if (!id) return;
            window.closeDeleteGroupModal();
            try {
                const userId = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : '';
                const res = await fetch(\`\${API}/groups/\${id}?userId=\${userId}\`, { method: 'DELETE' });
                const data = await res.json();
                if (res.ok) {
                    if (typeof showToast === 'function') showToast('Group deleted successfully.', 'success');
                    if (typeof refreshAllData === 'function') await refreshAllData();
                } else {
                    if (typeof showToast === 'function') showToast(data.error || 'Failed to delete group.', 'error');
                }
            } catch (e) {
                if (typeof showToast === 'function') showToast('Something went wrong. Please try again.', 'error');
            }
        };

        window.openManageMembersModal = function(groupId) {
            let g = (Array.isArray(window.allGroups) ? window.allGroups : []).find(gr => String(gr.id) === String(groupId));
            if (!g && typeof allGroups !== 'undefined' && Array.isArray(allGroups)) {
                g = allGroups.find(gr => String(gr.id) === String(groupId));
            }
            if (!g) return;
            window.activeManageGroupId = g.id;
            const titleEl = document.getElementById('manageMembersGroupTitle');
            if (titleEl) titleEl.innerText = \`\${g.name} - Members\`;

            // Populate user select (users not already members)
            const enrolledIds = new Set((g.members || []).map(m => m.id));
            const usersList = Array.isArray(window.allUsers) ? window.allUsers : (typeof allUsers !== 'undefined' ? allUsers : []);
            const availableUsers = usersList.filter(u => !enrolledIds.has(u.id));
            const selectEl = document.getElementById('addMemberUserSelect');
            if (selectEl) {
                if (availableUsers.length === 0) {
                    selectEl.innerHTML = '<option value="">All users are already members</option>';
                } else {
                    selectEl.innerHTML = availableUsers.map(u => \`<option value="\${u.id}">\${u.name} (\${u.email})</option>\`).join('');
                }
            }

            // Render current members
            if (typeof renderGroupMembersList === 'function') {
                renderGroupMembersList(g.members || []);
            }
            const modalEl = document.getElementById('manageMembersModal');
            if (modalEl) modalEl.classList.remove('hidden');
        };

        window.closeManageMembersModal = function() {
            window.activeManageGroupId = null;
            const modalEl = document.getElementById('manageMembersModal');
            if (modalEl) modalEl.classList.add('hidden');
        };
`;
scriptPart = scriptPart.replace('<script>', '<script>' + globalAliases);

scriptPart = scriptPart.replace(
    "} else if (viewName === 'friends') {\n                loadFriendsData();\n            }",
    "} else if (viewName === 'friends') {\n                loadFriendsData();\n            } else if (viewName === 'add-expense') {\n                if (typeof onExpenseGroupChange === 'function') onExpenseGroupChange();\n            } else if (viewName === 'master-admin') {\n                if (typeof switchAdminTab === 'function') switchAdminTab('overview');\n            }"
);

scriptPart = scriptPart.replace(
    'updateUserProfileUI();\n            await refreshAllData();',
    'updateUserProfileUI();\n            window.currentUser = currentUser;\n            if (typeof checkMasterAdminAccess === "function") checkMasterAdminAccess();\n            await refreshAllData();'
);

scriptPart = scriptPart.replace(
    'populateDropdowns();\n            } catch(err) {',
    'populateDropdowns();\n                window.currentUser = currentUser;\n                if (typeof checkMasterAdminAccess === "function") checkMasterAdminAccess();\n            } catch(err) {'
);

scriptPart = scriptPart.replace(
    "currentUser = null;\n\n            // Immediately hide workspace",
    "currentUser = null;\n            window.currentUser = null;\n            if (typeof checkMasterAdminAccess === 'function') checkMasterAdminAccess();\n\n            // Immediately hide workspace"
);

// Build HEAD & STYLES
const headHtml = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover"/>
    <title>SplitWise Quantum — Shared Ledger & Debt Automation</title>
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cdefs%3E%3ClinearGradient id='bg' x1='0%25' y1='100%25' x2='100%25' y2='0%25'%3E%3Cstop offset='0%25' stop-color='%2310b981'/%3E%3Cstop offset='100%25' stop-color='%232dd4bf'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect x='1' y='1' width='22' height='22' rx='6' fill='%23090b10' stroke='url(%23bg)' stroke-width='1.2'/%3E%3Cpath d='M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' fill='none' stroke='%2334d399' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"/>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
    <link rel="icon" type="image/png" sizes="128x128" href="/favicon.png"/>
    <link rel="shortcut icon" href="/favicon.ico"/>
    <link rel="apple-touch-icon" href="/favicon.png"/>

    <!-- Suppress Tailwind Play CDN notice in console -->
    <script>
        (function() {
            const _origWarn = console.warn;
            console.warn = function(...args) {
                if (args[0] && typeof args[0] === 'string' && args[0].includes('cdn.tailwindcss.com should not be used in production')) return;
                _origWarn.apply(console, args);
            };
        })();
    </script>

    <!-- Early Global Function Declarations & Event Stubs -->
    <script>
        function handleAmountInput(val) {
            if (typeof onAmountChanged === 'function' && onAmountChanged !== handleAmountInput) {
                return onAmountChanged(val);
            }
            if (typeof onSplitModeChanged === 'function') {
                return onSplitModeChanged();
            }
        }
        window.handleAmountInput = handleAmountInput;

        function onAmountChanged(val) {
            if (typeof onSplitModeChanged === 'function') {
                return onSplitModeChanged();
            }
        }
        window.onAmountChanged = onAmountChanged;

        function handleGroupChange(val) {
            if (typeof onExpenseGroupChange === 'function' && onExpenseGroupChange !== handleGroupChange) {
                return onExpenseGroupChange(val);
            }
        }
        window.handleGroupChange = handleGroupChange;

        function onExpenseGroupChange(val) {
            // Handled when core app logic initializes
        }
        window.onExpenseGroupChange = onExpenseGroupChange;

        function switchSettleTab(tab) {
            if (typeof switchBalanceTab === 'function') {
                return switchBalanceTab(tab);
            }
        }
        window.switchSettleTab = switchSettleTab;

        function quickAddAmount(inputId, delta) {
            const el = document.getElementById(inputId);
            if (!el) return;
            let currentVal = parseFloat(el.value) || 0;
            currentVal = Math.round(currentVal) + delta;
            if (currentVal < 0) currentVal = 0;
            el.value = currentVal;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        window.quickAddAmount = quickAddAmount;

        // Global Integer Stepper: ArrowUp / ArrowDown increases/decreases with integer
        document.addEventListener('keydown', function(e) {
            if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target && e.target.type === 'number') {
                const id = e.target.id || '';
                const cls = e.target.className || '';
                const isAmountInput = id.toLowerCase().includes('amount') || 
                                      cls.includes('split-custom-input') || 
                                      cls.includes('split-input') || 
                                      cls.includes('edit-exact-input') || 
                                      cls.includes('correction-split-input');
                if (isAmountInput) {
                    e.preventDefault();
                    let currentVal = parseFloat(e.target.value) || 0;
                    const delta = e.shiftKey ? 10 : 1;
                    const min = parseFloat(e.target.min) || (e.target.hasAttribute('required') ? 1 : 0);
                    if (e.key === 'ArrowUp') {
                        currentVal = Math.floor(currentVal) + delta;
                    } else {
                        currentVal = Math.max(min, Math.ceil(currentVal) - delta);
                    }
                    e.target.value = currentVal;
                    e.target.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        });
    </script>

    <!-- Google Fonts: Inter & Plus Jakarta Sans for Swiss SaaS Typography -->
    <link rel="preconnect" href="https://fonts.googleapis.com"/>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin=""/>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Plus+Jakarta+Sans:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet"/>
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet"/>

    <!-- Chart.js, jsPDF & Confetti -->
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js"></script>

    <!-- Tailwind CSS with Quantum SaaS Tokens -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        quantum: {
                            50: "#f0fdf4",
                            100: "#dcfce7",
                            200: "#bbf7d0",
                            300: "#86efac",
                            400: "#4ade80",
                            500: "#10b981",
                            600: "#059669",
                            700: "#047857",
                            800: "#065f46",
                            900: "#064e3b",
                            950: "#022c22",
                        },
                        obsidian: {
                            50: "#f8fafc",
                            100: "#f1f5f9",
                            200: "#e2e8f0",
                            300: "#cbd5e1",
                            400: "#94a3b8",
                            500: "#64748b",
                            600: "#475569",
                            700: "#334155",
                            800: "#1e293b",
                            900: "#0f172a",
                            950: "#08090d",
                        },
                        primary: "#10b981",
                        "primary-container": "#059669",
                        "on-primary": "#ffffff",
                        "on-primary-container": "#022c22",
                        secondary: "var(--brand-indigo)",
                        "secondary-container": "var(--secondary-container)",
                        "on-secondary-container": "var(--on-secondary-container)",
                        "on-secondary": "#ffffff",
                        surface: "var(--bg-canvas)",
                        "surface-dim": "var(--bg-surface-subtle)",
                        "surface-container-lowest": "var(--bg-surface)",
                        "surface-container-low": "var(--bg-surface-subtle)",
                        "surface-container": "var(--bg-surface-elevated)",
                        "surface-container-high": "var(--bg-surface-hover)",
                        "on-surface": "var(--text-main)",
                        "on-surface-variant": "var(--text-muted)",
                        outline: "var(--border-strong)",
                        "outline-variant": "var(--border-subtle)",
                        error: "#f43f5e",
                        "error-container": "#ffe4e6",
                        "on-error": "#ffffff",
                    },
                    fontFamily: {
                        sans: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
                        mono: ['JetBrains Mono', 'monospace'],
                    },
                    boxShadow: {
                        'glow-emerald': '0 0 25px -5px rgba(16, 185, 129, 0.25)',
                        'glow-indigo': '0 0 25px -5px rgba(99, 102, 241, 0.25)',
                        'quantum-card': 'var(--shadow-card)',
                        'quantum-elevated': 'var(--shadow-elevated)',
                    }
                }
            }
        };
    </script>
    <style>
        /* ==========================================================================
           SPLITWISE QUANTUM — CENTRALIZED TOKENS & SYSTEM ARCHITECTURE
           ========================================================================== */
        :root {
            --bg-canvas: #f8fafc;
            --bg-surface: #ffffff;
            --bg-surface-subtle: #f1f5f9;
            --bg-surface-elevated: #eef2f6;
            --bg-surface-hover: #e2e8f0;
            --border-subtle: rgba(15, 23, 42, 0.08);
            --border-strong: rgba(15, 23, 42, 0.16);
            --border-accent: rgba(16, 185, 129, 0.3);

            --text-main: #090d16;
            --text-muted: #57606a;
            --text-faint: #8c959f;

            --brand-primary: #059669;
            --brand-primary-hover: #047857;
            --brand-primary-light: #10b981;
            --brand-primary-subtle: rgba(5, 150, 105, 0.1);
            --brand-indigo: #4f46e5;
            --secondary-container: #eef2ff;
            --on-secondary-container: #3730a3;
            --border-secondary: #c7d2fe;
            --brand-rose: #f43f5e;
            --brand-amber: #f59e0b;
            --brand-cyan: #06b6d4;

            --shadow-subtle: 0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.04);
            --shadow-card: 0 4px 6px -1px rgba(0, 0, 0, 0.04), 0 2px 4px -2px rgba(0, 0, 0, 0.03);
            --shadow-elevated: 0 16px 32px -4px rgba(0, 0, 0, 0.08), 0 4px 8px -2px rgba(0, 0, 0, 0.04);

            --glass-bg: rgba(255, 255, 255, 0.85);
            --glass-border: rgba(15, 23, 42, 0.08);
        }

        html.dark {
            --bg-canvas: #08090d;
            --bg-surface: #0e1017;
            --bg-surface-subtle: #141722;
            --bg-surface-elevated: #1a1e2b;
            --bg-surface-hover: #222738;
            --border-subtle: rgba(255, 255, 255, 0.07);
            --border-strong: rgba(255, 255, 255, 0.15);
            --border-accent: rgba(16, 185, 129, 0.35);

            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --text-faint: #64748b;

            --brand-primary: #10b981;
            --brand-primary-hover: #059669;
            --brand-primary-light: #34d399;
            --brand-primary-subtle: rgba(16, 185, 129, 0.12);
            --brand-indigo: #818cf8;
            --secondary-container: rgba(99, 102, 241, 0.18);
            --on-secondary-container: #c7d2fe;
            --border-secondary: rgba(99, 102, 241, 0.35);
            --brand-rose: #fb7185;
            --brand-amber: #fbbf24;
            --brand-cyan: #22d3ee;

            --shadow-subtle: 0 1px 3px 0 rgba(0, 0, 0, 0.5);
            --shadow-card: 0 4px 8px -1px rgba(0, 0, 0, 0.6), inset 0 1px 0 0 rgba(255, 255, 255, 0.05);
            --shadow-elevated: 0 24px 48px -8px rgba(0, 0, 0, 0.85), inset 0 1px 0 0 rgba(255, 255, 255, 0.08);

            --glass-bg: rgba(14, 16, 23, 0.85);
            --glass-border: rgba(255, 255, 255, 0.08);
        }

        @layer base {
            html, body {
                margin: 0;
                padding: 0;
                font-family: 'Plus Jakarta Sans', 'Inter', sans-serif;
                background-color: var(--bg-canvas);
                color: var(--text-main);
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
                transition: background-color 0.25s ease, color 0.25s ease;
            }
            ::-webkit-scrollbar { width: 6px; height: 6px; }
            ::-webkit-scrollbar-track { background: transparent; }
            ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 9999px; }
            ::-webkit-scrollbar-thumb:hover { background: var(--text-faint); }
        }

        .tabular-nums { font-variant-numeric: tabular-nums; font-family: 'JetBrains Mono', monospace; }
        .material-symbols-outlined { font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; }
        .icon-fill { font-variation-settings: 'FILL' 1; }

        /* Secondary Container & Contrast Polish */
        .bg-secondary-container { background-color: var(--secondary-container) !important; }
        .text-on-secondary-container { color: var(--on-secondary-container) !important; }
        .border-secondary { border-color: var(--border-secondary) !important; }

        @keyframes quantumViewFadeIn {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .view-panel:not(.hidden) {
            animation: quantumViewFadeIn 0.24s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes quantumModalIn {
            from { opacity: 0; transform: scale(0.96) translateY(8px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .quantum-modal-content {
            animation: quantumModalIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes quantumOrbPulse {
            0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6); }
            70% { box-shadow: 0 0 0 16px rgba(16, 185, 129, 0); }
            100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
        .quantum-orb-active {
            animation: quantumOrbPulse 2s infinite;
        }

        @keyframes soundWaveAnim {
            0%, 100% { height: 4px; }
            50% { height: 22px; }
        }
        .voice-wave-bar {
            animation: soundWaveAnim 1.2s ease-in-out infinite;
        }
        .voice-wave-bar:nth-child(2) { animation-delay: 0.15s; }
        .voice-wave-bar:nth-child(3) { animation-delay: 0.3s; }
        .voice-wave-bar:nth-child(4) { animation-delay: 0.45s; }
        .voice-wave-bar:nth-child(5) { animation-delay: 0.6s; }

        .qw-glass {
            background-color: var(--glass-bg);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid var(--glass-border);
        }

        .qw-card {
            background-color: var(--bg-surface);
            border: 1px solid var(--border-subtle);
            border-radius: 1.25rem;
            box-shadow: var(--shadow-subtle);
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .qw-card:hover {
            border-color: var(--border-strong);
            box-shadow: var(--shadow-card);
        }

        .qw-card-elevated {
            background-color: var(--bg-surface);
            border: 1px solid var(--border-subtle);
            border-radius: 1.5rem;
            box-shadow: var(--shadow-card);
            transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .qw-card-elevated:hover {
            border-color: var(--border-strong);
            box-shadow: var(--shadow-elevated);
        }

        .qw-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            font-weight: 600;
            border-radius: 0.75rem;
            padding: 0.625rem 1rem;
            font-size: 0.875rem;
            transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
            user-select: none;
            cursor: pointer;
            outline: none;
        }
        .qw-btn:active {
            transform: scale(0.97);
        }
        .qw-btn-primary {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: #ffffff;
            box-shadow: 0 4px 14px rgba(16, 185, 129, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.15);
        }
        .qw-btn-primary:hover {
            background: linear-gradient(135deg, #34d399 0%, #047857 100%);
            box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4);
        }
        .qw-btn-secondary {
            background-color: var(--bg-surface-subtle);
            color: var(--text-main);
            border: 1px solid var(--border-subtle);
        }
        .qw-btn-secondary:hover {
            background-color: var(--bg-surface-elevated);
            border-color: var(--border-strong);
        }
        .qw-btn-ghost {
            background: transparent;
            color: var(--text-muted);
            border: 1px solid transparent;
        }
        .qw-btn-ghost:hover {
            background-color: var(--bg-surface-subtle);
            color: var(--text-main);
        }
        .qw-btn-danger {
            background: linear-gradient(135deg, #f43f5e 0%, #e11d48 100%);
            color: #ffffff;
            box-shadow: 0 4px 14px rgba(244, 63, 94, 0.3);
        }

        .qw-input {
            width: 100%;
            background-color: var(--bg-surface-subtle);
            border: 1px solid var(--border-subtle);
            color: var(--text-main);
            border-radius: 0.75rem;
            padding: 0.625rem 0.875rem;
            font-size: 0.875rem;
            transition: all 0.15s ease;
            outline: none;
        }
        .qw-input:focus {
            background-color: var(--bg-surface);
            border-color: var(--brand-primary);
            box-shadow: 0 0 0 3px var(--brand-primary-subtle);
        }

        .qw-badge {
            display: inline-flex;
            align-items: center;
            gap: 0.375rem;
            padding: 0.25rem 0.625rem;
            border-radius: 9999px;
            font-size: 0.6875rem;
            font-weight: 700;
            letter-spacing: 0.02em;
            text-transform: uppercase;
        }

        .nav-item.active {
            background-color: var(--brand-primary-subtle) !important;
            color: var(--brand-primary) !important;
            border-color: var(--border-accent) !important;
        }

        /* Mobile Sidebar Off-Canvas (< 1024px) */
        @media (max-width: 1023px) {
            #appSidebar {
                width: 18rem !important;
                transform: translateX(-100%);
                z-index: 60;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4);
                transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            }
            body.mobile-sidebar-open #appSidebar {
                transform: translateX(0) !important;
            }
            #appHeader {
                left: 0 !important;
                right: 0 !important;
            }
            #appMainContent {
                padding-left: 0 !important;
            }
            .sidebar-text {
                display: inline !important;
            }
        }

        /* Desktop Sidebar Collapsible Width (>= 1024px) */
        @media (min-width: 1024px) {
            #appSidebar {
                transform: none !important;
                width: 16rem;
                transition: width 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            }
            #appHeader {
                left: 16rem;
                transition: left 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            }
            #appMainContent {
                padding-left: 16rem;
                transition: padding-left 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            }
            body.sidebar-collapsed #appSidebar {
                width: 5rem !important;
            }
            body.sidebar-collapsed #appHeader {
                left: 5rem !important;
            }
            body.sidebar-collapsed #appMainContent {
                padding-left: 5rem !important;
            }
            body.sidebar-collapsed .sidebar-text {
                display: none !important;
            }
            body.sidebar-collapsed .sidebar-collapsed-center {
                justify-content: center !important;
                padding-left: 0 !important;
                padding-right: 0 !important;
            }
            body.sidebar-collapsed .sidebar-brand-header {
                justify-content: center !important;
                padding-left: 0.5rem !important;
                padding-right: 0.5rem !important;
            }
            body.sidebar-collapsed .sidebar-brand-content {
                display: none !important;
            }
            body.sidebar-collapsed #sidebarCollapseBtn {
                display: flex !important;
                width: 2.75rem !important;
                height: 2.75rem !important;
                align-items: center !important;
                justify-content: center !important;
                border-radius: 0.75rem !important;
                background-color: var(--bg-surface-elevated) !important;
                border: 1px solid var(--border-subtle) !important;
                box-shadow: var(--shadow-subtle) !important;
            }
            body.sidebar-collapsed #sidebarCollapseBtn:hover {
                background-color: var(--bg-surface-hover) !important;
                transform: scale(1.05);
            }
            body.sidebar-collapsed .sidebar-profile-card {
                margin: 0.5rem !important;
                padding: 0.5rem !important;
                justify-content: center !important;
                background: transparent !important;
                border: none !important;
            }
            body.sidebar-collapsed .sidebar-profile-card #navUserAvatar {
                width: 2.5rem !important;
                height: 2.5rem !important;
            }
        }

        @media (prefers-reduced-motion: reduce) {
            * {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
            }
        }
    </style>
</head>
<body class="min-h-screen text-slate-900 dark:text-slate-100 selection:bg-emerald-500/20 selection:text-emerald-400">

    <!-- Global Loading Progress Bar -->
    <div id="global-loading-bar" class="fixed top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-500 via-teal-400 to-indigo-500 z-50 transition-all duration-300 opacity-0 pointer-events-none"></div>

    <!-- Notification Toast Container -->
    <div id="toastContainer" class="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"></div>
`;

console.log('2. Generating templates...');
const authScreenHtml = getAuthScreenHtml();
const viewsPart1Html = getViewsPart1Html();
const viewsPart2Html = getViewsPart2Html();
const aiDrawerHtml = getAiAssistantDrawerHtml();
const modalsHtml = getModalsHtml();

const allViewsHtml = viewsPart1Html + '\n' + viewsPart2Html;
const allModalsHtml = aiDrawerHtml + '\n' + modalsHtml;

const workspaceHtml = getNavigationShellHtml(allViewsHtml, allModalsHtml);

console.log('3. Assembling final index.html...');
const masterAdminClientScript = getMasterAdminClientScript();
const finalHtml = headHtml + '\n' + authScreenHtml + '\n' + workspaceHtml + '\n' + scriptPart + '\n' + masterAdminClientScript;

const outputPath = path.join(__dirname, '..', 'index.html');
fs.writeFileSync(outputPath, finalHtml, 'utf8');

console.log('✓ Successfully wrote redesigned index.html (' + finalHtml.length + ' bytes)');
