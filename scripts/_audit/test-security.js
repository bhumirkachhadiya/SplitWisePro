const BASE = 'http://127.0.0.1:5000';
const out = [];
function rec(name, pass, detail) {
  out.push({ name, pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
}
async function j(method, path, { token, body, headers = {} } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token) h.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch (e) {}
  return { status: res.status, data, text };
}

(async () => {
  const alex = await j('POST', '/api/users/login', { body: { identifier: 'alex', password: 'password123' } });
  rec('login returns session token', alex.status === 200 && typeof alex.data.session_token === 'string' && alex.data.session_token.length >= 64, 'status=' + alex.status);
  rec('login does not leak password hash', !('password_hash' in (alex.data.user || {})) && !('plaintext_password' in (alex.data.user || {})));
  const alexToken = alex.data.session_token;

  const noAuth = await j('GET', '/api/groups');
  rec('unauthenticated API is rejected (401)', noAuth.status === 401, 'status=' + noAuth.status);

  const spoof = await j('GET', '/api/balances/summary?userId=2', { token: alexToken, headers: { 'x-user-id': '2' } });
  const legit = await j('GET', '/api/balances/summary', { token: alexToken });
  rec('query/header userId cannot impersonate another user',
    spoof.status === 200 && JSON.stringify(spoof.data) === JSON.stringify(legit.data),
    'spoofNet=' + (spoof.data && spoof.data.net_balance) + ' legitNet=' + (legit.data && legit.data.net_balance));

  const noAuthUsers = await j('GET', '/api/users');
  rec('user directory requires auth', noAuthUsers.status === 401, 'status=' + noAuthUsers.status);

  const source = await j('GET', '/server.js');
  rec('backend source is not publicly served', source.status === 404, 'status=' + source.status);

  const env = await j('GET', '/.env');
  rec('.env is not publicly served', env.status === 404, 'status=' + env.status);

  const adminAsUser = await j('GET', '/api/admin/overview', { token: alexToken });
  rec('master_admin can access admin overview', adminAsUser.status === 200, 'status=' + adminAsUser.status);

  const rahul = await j('POST', '/api/users/login', { body: { identifier: 'rahul', password: 'password123' } });
  rec('second user login works', rahul.status === 200, 'status=' + rahul.status);
  const rahulToken = rahul.data.session_token;

  const adminAsRahul = await j('GET', '/api/admin/overview', { token: rahulToken });
  rec('normal user is blocked from admin API (403)', adminAsRahul.status === 403, 'status=' + adminAsRahul.status);

  const editAlex = await j('PUT', '/api/users/1', { token: rahulToken, body: { name: 'Hacked', email: 'alex@splitease.io' } });
  rec('user cannot edit another profile (403)', editAlex.status === 403, 'status=' + editAlex.status);

  const wrongPass = await j('POST', '/api/users/login', { body: { identifier: 'alex', password: 'definitely-wrong' } });
  rec('wrong password is rejected', wrongPass.status === 400, 'status=' + wrongPass.status);

  const webhook = await j('POST', '/api/upi/webhook', { body: { request_id: 'x', status: 'SUCCESS' } });
  rec('payment webhook rejects unsigned request (401)', webhook.status === 401, 'status=' + webhook.status);

  const logout = await j('POST', '/api/auth/logout', { token: alexToken });
  const afterLogout = await j('GET', '/api/groups', { token: alexToken });
  rec('logout revokes the session token', logout.status === 200 && afterLogout.status === 401, 'afterStatus=' + afterLogout.status);

  const failed = out.filter(o => !o.pass).length;
  console.log('\nRESULT:', out.length - failed, '/', out.length, 'passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
