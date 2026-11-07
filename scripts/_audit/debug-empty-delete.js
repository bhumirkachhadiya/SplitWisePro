const BASE = 'http://127.0.0.1:5000';
(async () => {
  const l = await fetch(BASE + '/api/users/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'alex', password: 'password123' }) }).then(r => r.json());
  const t = l.session_token;
  const g = await fetch(BASE + '/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ name: 'B DEL ' + Date.now(), members: [] }) }).then(r => r.json());
  console.log('created', g);
  const get = await fetch(BASE + '/api/groups/' + g.id, { headers: { Authorization: 'Bearer ' + t } });
  console.log('get', get.status, JSON.stringify(await get.json()).slice(0, 300));
  const del = await fetch(BASE + '/api/groups/' + g.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + t } });
  console.log('delete', del.status, await del.text());
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
