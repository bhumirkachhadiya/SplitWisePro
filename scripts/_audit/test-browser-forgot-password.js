require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const path = require('path');
const { openPage } = require('./cdp-lib');
const { pool } = require('../../db');
const BASE = 'http://127.0.0.1:5000';
let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('FAIL  ' + name + (detail ? '  — ' + detail : '')); }
}
function hashOtp(otp, email, purpose) {
  return crypto.createHmac('sha256', process.env.OTP_SECRET || 'splitwise-secure-otp-secret-key-2026')
    .update(`${email.trim().toLowerCase()}:${purpose}:${String(otp).trim()}`).digest('hex');
}
async function loginUI(cdp, identifier, password) {
  await cdp.evaluate(`(() => { document.getElementById('authEmail').value=${JSON.stringify(identifier)}; document.getElementById('authPassword').value=${JSON.stringify(password)}; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  return cdp.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 20000);
}
(async () => {
  const tag = Date.now().toString().slice(-8);
  const email = `forgot.${tag}@example.com`;
  const username = `forgot${tag}`;
  const oldPassword = 'OldPass@123';
  const newPassword = 'NewPass@456';
  const hash = await bcrypt.hash(oldPassword, 10);
  const u = await pool.query(`INSERT INTO users (name,email,username,password_hash,avatar_initials,upi_id,phone,is_verified,is_active)
    VALUES ($1,$2,$3,$4,'FT',$5,'+91 90000 00000',TRUE,TRUE) RETURNING id`, ['Forgot Test ' + tag, email, username, hash, `forgot${tag}@okaxis`]);
  const userId = u.rows[0].id;

  const cdp = await openPage(BASE + '/');
  await cdp.waitFor('document.readyState === "complete"');
  await cdp.send('Network.clearBrowserCookies');
  await cdp.evaluate('localStorage.clear(); sessionStorage.clear();');
  await cdp.goto(BASE + '/');
  await new Promise(r => setTimeout(r, 900));
  cdp.errors.length = 0;

  // 1. Click Forgot password and submit email
  await cdp.evaluate(`document.querySelector('button[onclick="openForgotPasswordModal()"]').click()`);
  await new Promise(r => setTimeout(r, 400));
  const opened = await cdp.evaluate(`!document.getElementById('forgotPasswordModal').classList.contains('hidden')`);
  check('Forgot password button opens the modal', opened);
  await cdp.evaluate(`(() => { document.getElementById('forgotEmailInput').value=${JSON.stringify(email)}; document.getElementById('forgotStep1Form').requestSubmit(); })()`);
  const step2 = await cdp.waitFor(`!document.getElementById('forgotStep2Form').classList.contains('hidden')`, 15000);
  check('email submission advances to the OTP step without hanging', step2);

  // 2. Set a known OTP in the generated verification row (email delivery is external)
  const row = await pool.query("SELECT verification_id FROM email_verifications WHERE LOWER(email)=LOWER($1) AND purpose='password_reset' ORDER BY created_at DESC LIMIT 1", [email]);
  if (row.rows.length === 0) { console.error('No OTP row generated'); process.exit(1); }
  await pool.query("UPDATE email_verifications SET otp_hash=$1, attempts=0, is_used=FALSE, expires_at=NOW()+INTERVAL '5 minutes' WHERE verification_id=$2", [hashOtp('123456', email, 'password_reset'), row.rows[0].verification_id]);

  await cdp.evaluate(`(() => {
    ['0','1','2','3','4','5'].forEach((d,i) => { const el = document.getElementById('forgotOtp'+i); el.value = '123456'[i]; el.dispatchEvent(new Event('input',{bubbles:true})); });
    document.getElementById('forgotStep2Form').requestSubmit();
  })()`);
  const step3 = await cdp.waitFor(`!document.getElementById('forgotStep3Form').classList.contains('hidden')`, 15000);
  check('valid OTP advances to the new-password step', step3);

  await cdp.evaluate(`(() => {
    document.getElementById('forgotNewPasswordInput').value=${JSON.stringify(newPassword)};
    document.getElementById('forgotConfirmPasswordInput').value=${JSON.stringify(newPassword)};
    document.getElementById('forgotStep3Form').requestSubmit();
  })()`);
  const closed = await cdp.waitFor(`document.getElementById('forgotPasswordModal').classList.contains('hidden')`, 15000);
  check('new password submission closes the reset flow', closed);
  check('no console errors during reset', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

  // 3. Login with the new password
  const login = await loginUI(cdp, username, newPassword);
  check('new password can sign in', login);
  const oldLogin = await cdp.evaluate(`(async () => {
    const r = await fetch('/api/users/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ identifier:${JSON.stringify(username)}, password:${JSON.stringify(oldPassword)} }) });
    return r.status;
  })()`);
  check('old password no longer works', oldLogin === 400 || oldLogin === 401, 'status=' + oldLogin);

  // Cleanup
  const c = await pool.connect();
  try {
    await c.query('BEGIN'); await c.query("SET LOCAL session_replication_role='replica'");
    await c.query('DELETE FROM email_verifications WHERE LOWER(email)=LOWER($1)', [email]);
    await c.query('DELETE FROM user_sessions WHERE user_id=$1', [userId]);
    await c.query('DELETE FROM users WHERE id=$1', [userId]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); console.error('cleanup', e.message); } finally { c.release(); }

  console.log('\nRESULT:', pass, 'passed,', fail, 'failed');
  if (failures.length) console.log('FAILURES:\n - ' + failures.join('\n - '));
  cdp.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
