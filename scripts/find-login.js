const fs = require('fs');
const content = fs.readFileSync(__dirname + '/../index.html.backup', 'utf8');

function findSnippet(phrase, len = 1500) {
    const idx = content.indexOf(phrase);
    if (idx !== -1) {
        return content.slice(idx, idx + len);
    }
    return 'NOT FOUND: ' + phrase;
}

const res = {
    handleLogin: findSnippet('async function handleLogin('),
    refreshAllData: findSnippet('async function refreshAllData(')
};

fs.writeFileSync(__dirname + '/login-snippets.txt', JSON.stringify(res, null, 2), 'utf8');
console.log('Done');
