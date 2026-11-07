const fs = require('fs');
let c = fs.readFileSync('index.html', 'utf8');
const reps = [
  {
    find: `                    currentUser = data.user;
                    sessionStorage.setItem('splitease_user', JSON.stringify(currentUser));
                    localStorage.setItem('splitease_user', JSON.stringify(currentUser));

                    showToast(\`Welcome back, \${currentUser.name}!\`, 'success');`,
    replace: `                    currentUser = data.user;
                    if (window.__splitwiseSetSession) window.__splitwiseSetSession(data.session_token, data.user);
                    sessionStorage.setItem('splitease_user', JSON.stringify(currentUser));
                    localStorage.setItem('splitease_user', JSON.stringify(currentUser));

                    showToast(\`Welcome back, \${currentUser.name}!\`, 'success');`
  },
  {
    find: `                // Email Verified and User Account Created!
                currentUser = data.user;
                sessionStorage.setItem('splitease_user', JSON.stringify(currentUser));
                localStorage.setItem('splitease_user', JSON.stringify(currentUser));`,
    replace: `                // Email Verified and User Account Created!
                currentUser = data.user;
                if (window.__splitwiseSetSession) window.__splitwiseSetSession(data.session_token, data.user);
                sessionStorage.setItem('splitease_user', JSON.stringify(currentUser));
                localStorage.setItem('splitease_user', JSON.stringify(currentUser));`
  },
  {
    find: `        function handleLogout() {
            sessionStorage.removeItem('splitease_user');
            localStorage.removeItem('splitease_user');`,
    replace: `        function handleLogout(skipServer) {
            // Revoke the server-side session so a copied token cannot be reused.
            try {
                if (!skipServer) fetch(\`\${API}/auth/logout\`, { method: 'POST' }).catch(() => {});
            } catch (e) {}
            if (window.__splitwiseClearSession) window.__splitwiseClearSession();
            sessionStorage.removeItem('splitease_user');
            localStorage.removeItem('splitease_user');`
  },
  {
    find: `        // -------------------------------------------------------------
        // FORGOT PASSWORD: 3-STEP EMAIL OTP VERIFICATION
        // -------------------------------------------------------------`,
    replace: `        // Session expiry / revocation handler used by the fetch wrapper.
        window.__splitwiseForceLogout = function () {
            if (!currentUser) return;
            handleLogout(true);
            if (typeof showToast === 'function') showToast('Your session expired. Please sign in again.', 'warning');
        };

        // -------------------------------------------------------------
        // FORGOT PASSWORD: 3-STEP EMAIL OTP VERIFICATION
        // -------------------------------------------------------------`
  },
  {
    find: `            const storedUser = sessionStorage.getItem('splitease_user');
            if (storedUser) {
                try {
                    currentUser = JSON.parse(storedUser);
                    launchApp();
                } catch(e) {
                    sessionStorage.removeItem('splitease_user');
                }
            }`,
    replace: `            const storedUser = sessionStorage.getItem('splitease_user');
            if (storedUser) {
                try {
                    currentUser = JSON.parse(storedUser);
                    window.currentUser = currentUser;
                    launchApp();
                } catch(e) {
                    sessionStorage.removeItem('splitease_user');
                }
            } else {
                // Restore a valid cookie/token session (new tab or after reload).
                fetch(\`\${API}/auth/session\`)
                    .then(r => r.ok ? r.json() : null)
                    .then(d => {
                        if (d && d.user) {
                            currentUser = d.user;
                            window.currentUser = currentUser;
                            sessionStorage.setItem('splitease_user', JSON.stringify(currentUser));
                            launchApp();
                        }
                    })
                    .catch(() => {});
            }`
  }
];

let fail = 0;
for (const r of reps) {
  const n = c.split(r.find).length - 1;
  if (n !== 1) { console.error('MATCH(' + n + '): ' + r.find.split('\n')[0].trim().slice(0, 70)); fail++; continue; }
  c = c.replace(r.find, r.replace);
  console.log('OK ' + r.find.split('\n')[0].trim().slice(0, 60));
}
if (fail) { console.error('failed ' + fail); process.exit(1); }
fs.writeFileSync('index.html', c);
console.log('done');
