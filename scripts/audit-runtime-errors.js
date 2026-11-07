const fs = require('fs');
const path = require('path');

function runAudit() {
    console.log('================================================================');
    console.log('      SPLITWISE EXHAUSTIVE RUNTIME ERROR & FUNCTION AUDIT       ');
    console.log('================================================================\n');

    const indexHtml = fs.readFileSync('index.html', 'utf8');
    const serverJs = fs.readFileSync('server.js', 'utf8');

    // 1. Extract all script contents from index.html
    const scriptMatches = indexHtml.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi) || [];
    const scriptBody = scriptMatches.map(s => s.replace(/<script[\s\S]*?>/i, '').replace(/<\/script>/i, '')).join('\n');

    // 2. Extract all function declarations / definitions in scripts
    const declaredFunctions = new Set();

    // Regex patterns for function definitions
    const funcDeclRegex = /(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(/g;
    let m;
    while ((m = funcDeclRegex.exec(scriptBody)) !== null) {
        declaredFunctions.add(m[1]);
    }

    const varFuncRegex = /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/g;
    while ((m = varFuncRegex.exec(scriptBody)) !== null) {
        declaredFunctions.add(m[1]);
    }

    const windowFuncRegex = /window\.([a-zA-Z0-9_$]+)\s*=/g;
    while ((m = windowFuncRegex.exec(scriptBody)) !== null) {
        declaredFunctions.add(m[1]);
    }

    console.log(`[1] Total functions declared in <script> blocks: ${declaredFunctions.size}`);

    // 3. Extract all inline event handlers from index.html (both static HTML and template literals)
    // Common event attributes: onclick, onchange, onsubmit, oninput, onkeydown, onkeyup, onload, onerror
    const eventHandlerRegex = /\b(on(?:click|change|submit|input|keydown|keyup|load|error|blur|focus))\s*=\s*["']([^"']+)["']/gi;
    
    const handlerCalls = [];
    while ((m = eventHandlerRegex.exec(indexHtml)) !== null) {
        handlerCalls.push({
            event: m[1],
            code: m[2],
            index: m.index
        });
    }

    console.log(`[2] Total inline event attributes found: ${handlerCalls.length}`);

    // 4. Extract function names called in these event handlers
    // Examples of code: "searchFriends()", "event.preventDefault(); sendActiveChatMessage();", "if(event.key==='Enter') searchFriends()", "selectConversation(1)"
    const callExtractionRegex = /([a-zA-Z0-9_$]+)\s*\(/g;
    const missingFunctions = new Map();
    const calledFunctions = new Set();

    // Standard JS builtins / keywords to ignore
    const ignoredKeywords = new Set([
        'if', 'for', 'while', 'switch', 'catch', 'return', 'function',
        'alert', 'confirm', 'prompt', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
        'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
        'fetch', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
        'JSON', 'parse', 'stringify', 'Math', 'floor', 'ceil', 'round', 'abs', 'min', 'max',
        'Date', 'now', 'String', 'Number', 'Boolean', 'Array', 'Object',
        'preventDefault', 'stopPropagation', 'focus', 'blur', 'trim', 'replace',
        'toLowerCase', 'toUpperCase', 'split', 'join', 'slice', 'substring', 'includes',
        'indexOf', 'push', 'pop', 'shift', 'unshift', 'forEach', 'map', 'filter', 'reduce',
        'find', 'some', 'every', 'addEventListener', 'removeEventListener', 'setAttribute',
        'getAttribute', 'removeAttribute', 'classList', 'add', 'remove', 'toggle', 'contains',
        'getElementById', 'querySelector', 'querySelectorAll', 'createElement', 'appendChild',
        'removeChild', 'closest', 'dispatchEvent', 'CustomEvent', 'RegExp', 'exec', 'test',
        'match', 'toString', 'valueOf', 'stopGlobalLoading', 'startGlobalLoading', 'showToast'
    ]);

    for (const h of handlerCalls) {
        let callMatch;
        const code = h.code;
        const regex = new RegExp(callExtractionRegex);
        while ((callMatch = regex.exec(code)) !== null) {
            const funcName = callMatch[1];
            if (ignoredKeywords.has(funcName)) continue;
            calledFunctions.add(funcName);

            if (!declaredFunctions.has(funcName)) {
                // Check if it's a property method like event.preventDefault or list.map
                const preChar = code.charAt(callMatch.index - 1);
                if (preChar === '.') continue; // It's a method call on an object!

                if (!missingFunctions.has(funcName)) {
                    missingFunctions.set(funcName, []);
                }
                missingFunctions.get(funcName).push(h);
            }
        }
    }

    console.log(`[3] Unique custom functions called from event handlers: ${calledFunctions.size}`);
    console.log(`[4] Potential missing / undefined functions: ${missingFunctions.size}`);

    for (const [funcName, occurrences] of missingFunctions.entries()) {
        console.log(`\n  🚨 MISSING FUNCTION: "${funcName}" (${occurrences.length} occurrences)`);
        occurrences.slice(0, 3).forEach(occ => {
            console.log(`     ↳ In handler ${occ.event}="${occ.code.substring(0, 60)}"`);
        });
    }

    // 5. Audit all document.getElementById calls in scripts
    console.log('\n[5] Auditing document.getElementById calls against DOM elements...');
    const getElemRegex = /document\.getElementById\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
    const referencedElementIds = new Set();
    while ((m = getElemRegex.exec(scriptBody)) !== null) {
        referencedElementIds.add(m[1]);
    }

    // Find all IDs in HTML
    const idRegex = /id=["']([^"']+)["']/g;
    const existingElementIds = new Set();
    while ((m = idRegex.exec(indexHtml)) !== null) {
        existingElementIds.add(m[1]);
    }

    console.log(`    Total IDs referenced in JS: ${referencedElementIds.size}`);
    console.log(`    Total IDs defined in HTML:  ${existingElementIds.size}`);

    const missingElementIds = [];
    for (const id of referencedElementIds) {
        // Some IDs are dynamic (e.g. `${...}`), check for literal IDs
        if (id.includes('$') || id.includes('{')) continue;
        if (!existingElementIds.has(id)) {
            missingElementIds.push(id);
        }
    }

    console.log(`    Missing DOM IDs: ${missingElementIds.length}`);
    if (missingElementIds.length > 0) {
        console.log('    List of missing IDs:');
        missingElementIds.forEach(id => console.log(`      - #${id}`));
    }

    // 6. Audit duplicate function declarations
    console.log('\n[6] Checking for duplicate function declarations...');
    const allFuncNames = [];
    const dupCheckRegex = /(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(/g;
    while ((m = dupCheckRegex.exec(scriptBody)) !== null) {
        allFuncNames.push(m[1]);
    }

    const counts = {};
    const duplicates = [];
    for (const name of allFuncNames) {
        counts[name] = (counts[name] || 0) + 1;
        if (counts[name] === 2) {
            duplicates.push(name);
        }
    }

    console.log(`    Duplicate function declarations found: ${duplicates.length}`);
    if (duplicates.length > 0) {
        duplicates.forEach(d => console.log(`      - ${d} (${counts[d]} declarations)`));
    }

    // 7. Audit fetch() endpoints in scripts against server.js routes
    console.log('\n[7] Auditing API endpoints called in index.html against server.js...');
    const fetchRegex = /fetch\(\s*(?:`\${API}([^`?]+)|["']\/api([^"'?]+))/g;
    const calledEndpoints = new Set();
    while ((m = fetchRegex.exec(scriptBody)) !== null) {
        const ep = m[1] || ('/api' + m[2]);
        calledEndpoints.add(ep);
    }

    console.log(`    Unique endpoints called in index.html: ${calledEndpoints.size}`);

    // Extract endpoints defined in server.js
    const serverRouteRegex = /app\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g;
    const serverRoutes = new Set();
    while ((m = serverRouteRegex.exec(serverJs)) !== null) {
        serverRoutes.add(m[2]);
    }

    console.log(`    Unique routes defined in server.js: ${serverRoutes.size}`);

    const unmatchedEndpoints = [];
    for (const ep of calledEndpoints) {
        let normEp = ep.replace(/\$\{[^}]+\}/g, ':param').replace(/\/(\d+)(\/|$)/g, '/:param$2');
        if (!normEp.startsWith('/api')) normEp = '/api' + normEp;

        let matched = false;
        for (const route of serverRoutes) {
            const regexStr = '^' + route.replace(/:[a-zA-Z0-9_]+/g, '[^/]+') + '$';
            // Also handle dynamic subpath endpoints like /groups/:groupId/:endpoint where endpoint is lock/unlock
            const routeParamNorm = route.replace(/:[a-zA-Z0-9_]+/g, ':param');
            if (new RegExp(regexStr).test(normEp) || new RegExp(regexStr).test('/api' + ep) || route === normEp || routeParamNorm.startsWith(normEp.replace(/\/:param$/, ''))) {
                matched = true;
                break;
            }
        }
        if (!matched) {
            unmatchedEndpoints.push(ep);
        }
    }

    console.log(`    Potentially unmatched API endpoints: ${unmatchedEndpoints.length}`);
    if (unmatchedEndpoints.length > 0) {
        unmatchedEndpoints.forEach(ep => console.log(`      - ${ep}`));
    }

    console.log('\n================================================================');
    console.log('                   AUDIT SCAN COMPLETE                          ');
    console.log('================================================================');
}

runAudit();
