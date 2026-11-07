const BASE = 'http://127.0.0.1:5000';
(async () => {
  const l = await fetch(BASE + '/api/users/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'alex', password: 'password123' }) }).then(r => r.json());
  const t = l.session_token;
  const endpoints = ['/api/groups', '/api/expenses', '/api/groups/1/expenses', '/api/balances/summary', '/api/analytics', '/api/activities?x=1', '/api/activity', '/api/admin/overview', '/api/users'];
  for (const ep of endpoints) {
    const times = [];
    let status = 0;
    for (let i = 0; i < 5; i++) {
      const s = Date.now();
      const r = await fetch(BASE + ep, { headers: { Authorization: 'Bearer ' + t } });
      status = r.status;
      await r.text();
      times.push(Date.now() - s);
    }
    times.sort((a, b) => a - b);
    console.log(ep.padEnd(32), 'status=' + status, 'median=' + times[2] + 'ms', 'max=' + times[4] + 'ms');
  }
  const email = await fetch(BASE + '/api/email/status', { headers: { Authorization: 'Bearer ' + t } });
  console.log('email status:', email.status, (await email.text()).slice(0, 180));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
