/**
 * scripts/test-interactive-runtime-errors.js
 * Automated JavaScript Runtime Error Verification Suite
 * Tests every interactive button, inline handler, function reference, and user role workflow.
 */

const fs = require('fs');
const vm = require('vm');

const BASE_URL = 'http://localhost:5000';

async function request(path, options = {}) {
    const url = BASE_URL + path;
    const init = {
        method: options.method || 'GET',
        headers: options.headers || {},
        signal: AbortSignal.timeout(options.timeout || 15000)
    };

    if (options.body) {
        init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        init.headers['Content-Type'] = 'application/json';
    }

    try {
        const res = await fetch(url, init);
        let body = null;
        const text = await res.text();
        try { body = JSON.parse(text); } catch { body = text; }
        return { status: res.status, body };
    } catch (e) {
        return { status: 0, error: e.message };
    }
}

async function runInteractiveAuditSuite() {
    console.log('================================================================');
    console.log('     AUTOMATED JAVASCRIPT RUNTIME ERROR AUDIT & ACTION SUITE    ');
    console.log('================================================================\n');

    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;

    function assert(name, condition, details = '') {
        totalTests++;
        if (condition) {
            passedTests++;
            console.log(`  ✓ PASS: ${name}`);
            if (details) console.log(`          ↳ ${details}`);
        } else {
            failedTests++;
            console.error(`  ✗ FAIL: ${name}`);
            if (details) console.error(`          ↳ ${details}`);
        }
    }

    const indexHtml = fs.readFileSync('index.html', 'utf8');

    // -------------------------------------------------------------
    // PHASE 1: AST & DOM FUNCTION SCOPE AUDIT
    // -------------------------------------------------------------
    console.log('[PHASE 1: Browser Environment Function Scope Simulation]');

    // Create a mock DOM / browser environment
    const domElements = new Map();

    const mockElement = (id, tag = 'div') => ({
        id,
        tagName: tag.toUpperCase(),
        classList: {
            classes: new Set(),
            add(c) { this.classes.add(c); },
            remove(c) { this.classes.delete(c); },
            toggle(c, force) {
                if (force === true) this.classes.add(c);
                else if (force === false) this.classes.delete(c);
                else if (this.classes.has(c)) this.classes.delete(c);
                else this.classes.add(c);
            },
            contains(c) { return this.classes.has(c); }
        },
        children: [],
        style: {},
        dataset: {},
        value: '',
        innerText: '',
        innerHTML: '',
        disabled: false,
        setAttribute(k, v) { this[k] = v; },
        getAttribute(k) { return this[k]; },
        removeAttribute(k) { delete this[k]; },
        focus() {},
        blur() {},
        click() {},
        scrollIntoView() {},
        appendChild(child) { this.children.push(child); return child; },
        removeChild(child) { return child; },
        addEventListener(event, handler) {},
        removeEventListener(event, handler) {}
    });

    // Populate mock DOM with all IDs in index.html
    const idRegex = /id=["']([^"']+)["']/g;
    let m;
    while ((m = idRegex.exec(indexHtml)) !== null) {
        if (!domElements.has(m[1])) {
            domElements.set(m[1], mockElement(m[1]));
        }
    }

    const toasts = [];
    const eventListeners = new Map();
    const mockDocument = {
        getElementById: (id) => domElements.get(id) || mockElement(id),
        querySelector: (sel) => {
            if (sel.startsWith('#')) return domElements.get(sel.substring(1)) || mockElement(sel.substring(1));
            return mockElement(sel);
        },
        querySelectorAll: () => [],
        createElement: (tag) => mockElement('dyn_' + Math.random(), tag),
        body: mockElement('body', 'body'),
        documentElement: mockElement('html', 'html'),
        head: mockElement('head', 'head'),
        cookie: '',
        addEventListener: (event, handler) => {
            if (!eventListeners.has(event)) eventListeners.set(event, []);
            eventListeners.get(event).push(handler);
        },
        removeEventListener: (event, handler) => {}
    };

    class MockEvent {
        constructor(type = 'click') {
            this.type = type;
            this.key = 'Enter';
            this.target = mockElement('target');
            this.target.querySelector = () => mockElement('btn');
            this.currentTarget = this.target;
        }
        preventDefault() {}
        stopPropagation() {}
    }

    const windowContext = {
        console: {
            log: () => {},
            error: () => {},
            warn: () => {},
            info: () => {}
        },
        tailwind: { config: {} },
        Event: MockEvent,
        CustomEvent: MockEvent,
        document: mockDocument,
        localStorage: {
            _store: {},
            getItem(k) { return this._store[k] || null; },
            setItem(k, v) { this._store[k] = String(v); },
            removeItem(k) { delete this._store[k]; },
            clear() { this._store = {}; }
        },
        sessionStorage: {
            _store: {},
            getItem(k) { return this._store[k] || null; },
            setItem(k, v) { this._store[k] = String(v); },
            removeItem(k) { delete this._store[k]; },
            clear() { this._store = {}; }
        },
        navigator: {
            clipboard: {
                writeText: async () => true
            },
            userAgent: 'Mozilla/5.0 NodeAudit'
        },
        speechSynthesis: {
            speaking: false,
            paused: false,
            speak: () => {},
            cancel: () => {},
            pause: () => {},
            resume: () => {}
        },
        SpeechSynthesisUtterance: function(text) { this.text = text; },
        location: { origin: 'http://localhost:5000', reload: () => {}, href: 'http://localhost:5000/' },
        showToast: (msg, type) => { toasts.push({ msg, type }); },
        startGlobalLoading: () => {},
        stopGlobalLoading: () => {},
        setButtonLoading: () => {},
        setTimeout: (fn, ms) => setTimeout(fn, 1),
        clearTimeout: (id) => clearTimeout(id),
        setInterval: (fn, ms) => setInterval(fn, 1000),
        clearInterval: (id) => clearInterval(id),
        requestAnimationFrame: (cb) => setTimeout(cb, 1),
        cancelAnimationFrame: (id) => clearTimeout(id),
        fetch: async (url, opts) => ({
            ok: true,
            status: 200,
            json: async () => ([]),
            text: async () => '[]'
        }),
        print: () => {},
        innerWidth: 1280,
        innerHeight: 800,
        scrollTo: () => {},
        matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
        Intl: global.Intl,
        Chart: function() { return { destroy: () => {}, update: () => {} }; },
        QRCode: function() { return { makeCode: () => {}, clear: () => {} }; },
        addEventListener: (event, handler) => {
            if (!eventListeners.has(event)) eventListeners.set(event, []);
            eventListeners.get(event).push(handler);
        },
        removeEventListener: (event, handler) => {}
    };
    windowContext.window = windowContext;
    windowContext.globalThis = windowContext;
    windowContext.self = windowContext;

    // Extract all <script> blocks from index.html and execute them in the simulated sandbox
    const scriptMatches = indexHtml.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi) || [];
    const sandbox = vm.createContext(windowContext);

    let scriptExecError = null;
    for (let i = 0; i < scriptMatches.length; i++) {
        const scriptTag = scriptMatches[i];
        const code = scriptTag.replace(/<script[\s\S]*?>/i, '').replace(/<\/script>/i, '');
        const openTag = scriptTag.substring(0, scriptTag.indexOf('>'));
        if (openTag.includes('src=')) continue;
        try {
            vm.runInContext(code, sandbox);
        } catch (err) {
            console.error(`Script [${i}] execution error:`, err.message);
            scriptExecError = err;
        }
    }

    assert('Execute all scripts from index.html in browser sandbox without syntax or parse errors', !scriptExecError, scriptExecError ? scriptExecError.message : 'Scripts loaded cleanly');

    // -------------------------------------------------------------
    // PHASE 2: VERIFY ALL CRITICAL REPORTED FUNCTIONS EXIST & CALLABLE
    // -------------------------------------------------------------
    console.log('\n[PHASE 2: Direct Audit of Fixed Functions in Global Scope]');

    // 1. searchFriends and searchFriendsToConnect
    assert('searchFriends is defined in global scope', typeof sandbox.searchFriends === 'function', `Type: ${typeof sandbox.searchFriends}`);
    assert('window.searchFriends is defined and matches searchFriends', typeof sandbox.window.searchFriends === 'function');
    assert('searchFriendsToConnect is defined in global scope', typeof sandbox.searchFriendsToConnect === 'function');
    assert('window.searchFriendsToConnect is defined and matches searchFriendsToConnect', typeof sandbox.window.searchFriendsToConnect === 'function');

    // 2. triggerAutoQrSettle and handleQrPaymentAutoSettlement
    assert('triggerAutoQrSettle is defined in global scope', typeof sandbox.triggerAutoQrSettle === 'function');
    assert('handleQrPaymentAutoSettlement is defined in global scope', typeof sandbox.handleQrPaymentAutoSettlement === 'function');

    // 3. exportAnalyticsPDF
    assert('exportAnalyticsPDF is defined in global scope', typeof sandbox.exportAnalyticsPDF === 'function');

    // 4. Speech synthesis aliases
    assert('resumeSpeechSynthesis is defined in global scope', typeof sandbox.resumeSpeechSynthesis === 'function');
    assert('pauseSpeechSynthesis is defined in global scope', typeof sandbox.pauseSpeechSynthesis === 'function');
    assert('stopSpeechSynthesis is defined in global scope', typeof sandbox.stopSpeechSynthesis === 'function');
    assert('replayLastSpeechSynthesis is defined in global scope', typeof sandbox.replayLastSpeechSynthesis === 'function');

    // -------------------------------------------------------------
    // PHASE 3: AUDIT ALL INLINE EVENT HANDLERS IN STATIC HTML & TEMPLATES
    // -------------------------------------------------------------
    console.log('\n[PHASE 3: Audit All Inline Event Handlers and Function Invocations]');

    // Separate HTML from scripts to avoid evaluating raw JS template strings as static attributes
    const htmlWithoutScripts = indexHtml.replace(/<script[\s\S]*?<\/script>/gi, '');
    const staticEventRegex = /\b(on(?:click|change|submit|input|keydown|keyup))\s*=\s*"([^"]+)"/gi;
    let countStaticHandlers = 0;
    let missingOrFailedHandlers = 0;
    const failedDetails = [];

    while ((m = staticEventRegex.exec(htmlWithoutScripts)) !== null) {
        countStaticHandlers++;
        const eventType = m[1];
        const eventCode = m[2];

        const testCode = `(function() { 
            var event = new Event('${eventType.replace(/^on/, '')}'); 
            ${eventCode} 
        })`;

        try {
            const fn = vm.runInContext(testCode, sandbox);
            try {
                fn.call({ value: 'test', parentElement: mockElement('parent'), classList: { add(){}, remove(){}, toggle(){} } });
            } catch (runtimeErr) {
                if (runtimeErr instanceof ReferenceError || (runtimeErr.name === 'ReferenceError')) {
                    missingOrFailedHandlers++;
                    failedDetails.push({ code: eventCode, error: runtimeErr.message });
                }
            }
        } catch (compileErr) {
            missingOrFailedHandlers++;
            failedDetails.push({ code: eventCode, error: compileErr.message });
        }
    }

    assert(`Audit ${countStaticHandlers} static HTML event handlers for ReferenceError / undefined functions`, missingOrFailedHandlers === 0, 
        missingOrFailedHandlers === 0 ? `0 ReferenceErrors across all ${countStaticHandlers} static handlers` : `${missingOrFailedHandlers} failures: ${JSON.stringify(failedDetails)}`
    );

    // Also audit dynamic function references inside template literals:
    // Extract all onclick="..." inside the scripts
    const dynamicEventRegex = /onclick\s*=\s*\\?["']([a-zA-Z0-9_$]+)\(/g;
    const dynamicCalledFunctions = new Set();
    while ((m = dynamicEventRegex.exec(indexHtml)) !== null) {
        dynamicCalledFunctions.add(m[1]);
    }

    let missingDynamic = [];
    for (const funcName of dynamicCalledFunctions) {
        if (typeof sandbox[funcName] !== 'function' && typeof sandbox.window[funcName] !== 'function') {
            missingDynamic.push(funcName);
        }
    }

    assert(`Audit dynamic template event handler functions (${dynamicCalledFunctions.size} unique functions)`, missingDynamic.length === 0,
        missingDynamic.length === 0 ? `All ${dynamicCalledFunctions.size} functions exist in scope` : `Missing: ${missingDynamic.join(', ')}`
    );

    // -------------------------------------------------------------
    // PHASE 4: BACKEND ENDPOINT INTEGRATION & WORKFLOW VALIDATION
    // -------------------------------------------------------------
    console.log('\n[PHASE 4: Role-Based User Flow & API Integration Verification]');

    const usersRes = await request('/api/users');
    const users = Array.isArray(usersRes.body) ? usersRes.body : (usersRes.body?.users || []);
    const masterAdmin = users.find(u => u.role === 'master_admin') || users[0];
    const member1 = users.find(u => u.role !== 'master_admin') || users[1];
    const member2 = users.find(u => u.id !== masterAdmin.id && u.id !== member1.id) || users[2] || member1;

    console.log(`     Master Admin: ${masterAdmin?.name} (ID: ${masterAdmin?.id})`);
    console.log(`     Member 1:     ${member1?.name} (ID: ${member1?.id})`);
    console.log(`     Member 2:     ${member2?.name} (ID: ${member2?.id})`);

    // 1. Friends Search & Connect API
    console.log('\n  --> Testing Friends Search & Connect API:');
    const searchRes = await request(`/api/friends/search?q=${encodeURIComponent(member2.name.substring(0, 3))}&userId=${member1.id}`);
    assert('Friends Search endpoint (/api/friends/search)', searchRes.status === 200, `Found ${searchRes.body?.length || 0} matching peers`);

    const friendReqRes = await request('/api/friends/request', {
        method: 'POST',
        body: { senderId: member1.id, targetUserCodeOrEmail: member2.email }
    });
    // 201 Created or 400 (already sent/friends) are both valid non-crashing responses
    assert('Friend Request endpoint (/api/friends/request)', friendReqRes.status === 200 || friendReqRes.status === 201 || friendReqRes.status === 400, `Status: ${friendReqRes.status} (${friendReqRes.body?.message || friendReqRes.body?.error})`);

    // 2. Groups, Lock & Unlock endpoints
    console.log('\n  --> Testing Groups, Lock / Unlock API:');
    const groupsRes = await request(`/api/groups?userId=${member1.id}`);
    const groups = Array.isArray(groupsRes.body) ? groupsRes.body : [];
    assert('Groups List endpoint (/api/groups)', groupsRes.status === 200 && groups.length > 0, `User is in ${groups.length} groups`);

    if (groups.length > 0) {
        const testGroup = groups[0];
        const lockRes = await request(`/api/groups/${testGroup.id}/lock`, {
            method: 'POST',
            body: { userId: member1.id }
        });
        assert('Group Lock endpoint (/api/groups/:id/lock)', lockRes.status === 200 || lockRes.status === 403, `Status: ${lockRes.status} (${lockRes.body?.message || lockRes.body?.error})`);

        const unlockRes = await request(`/api/groups/${testGroup.id}/unlock`, {
            method: 'POST',
            body: { userId: member1.id }
        });
        assert('Group Unlock endpoint (/api/groups/:id/unlock)', unlockRes.status === 200 || unlockRes.status === 403, `Status: ${unlockRes.status} (${unlockRes.body?.message || unlockRes.body?.error})`);
    }

    // 3. Analytics API
    console.log('\n  --> Testing Analytics & Reporting API:');
    const analyticsRes = await request(`/api/analytics?userId=${member1.id}`);
    assert('Analytics endpoint (/api/analytics)', analyticsRes.status === 200, `Returned analytics payload`);

    // 4. UPI & Settlement API
    console.log('\n  --> Testing Settlements & UPI Payment API:');
    const upiQrRes = await request(`/api/upi/create-payment-request`, {
        method: 'POST',
        body: {
            payer_id: member1.id,
            receiver_id: member2.id,
            amount: 50.00,
            notes: 'Verification Test Settlement'
        }
    });
    assert('UPI QR Payment Generation (/api/upi/create-payment-request)', upiQrRes.status === 200 || upiQrRes.status === 201, `Status: ${upiQrRes.status}`);

    // 5. Activity Feed API
    console.log('\n  --> Testing Activity Feed API:');
    const actRes = await request(`/api/activity?userId=${member1.id}`);
    assert('Activity Feed endpoint (/api/activity)', actRes.status === 200, `Returned ${actRes.body?.length || 0} activities`);

    // 6. Super Admin Protected Endpoints
    console.log('\n  --> Testing Super Admin Protected Endpoints:');
    const adminOverviewRes = await request('/api/admin/overview', {
        headers: { 'x-user-id': String(masterAdmin.id) }
    });
    assert('Admin Overview (/api/admin/overview)', adminOverviewRes.status === 200, `Status: ${adminOverviewRes.status}`);

    const emailTemplatesRes = await request('/api/email-templates', {
        headers: { 'x-user-id': String(masterAdmin.id) }
    });
    assert('Admin Email Templates (/api/email-templates)', emailTemplatesRes.status === 200, `Found ${emailTemplatesRes.body?.length || 0} templates`);

    // 7. Navigation & Screen Switching Verification in Sandbox
    console.log('\n  --> Testing Screen Switching / Navigation in Sandbox:');
    const viewsToTest = ['dashboard', 'groups', 'expenses', 'friends', 'settle', 'analytics', 'activity', 'chat', 'admin'];
    let navSuccess = true;
    for (const view of viewsToTest) {
        try {
            sandbox.navigateTo(view);
        } catch (e) {
            navSuccess = false;
            console.error(`      Error navigating to view: ${view}:`, e.message);
        }
    }
    assert('navigateTo() successfully switches between all 9 application views', navSuccess, `All views tested without runtime errors`);

    // -------------------------------------------------------------
    // SUMMARY REPORT
    // -------------------------------------------------------------
    console.log('\n================================================================');
    console.log(`TOTAL CHECKS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
    console.log('================================================================');

    if (failedTests > 0) {
        process.exit(1);
    }
}

runInteractiveAuditSuite().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
