const fs = require('fs');
const p = 'scripts/_audit/test-browser-settle-load.js';
let c = fs.readFileSync(p, 'utf8');

const oldSetup = `  const alexT = (await api('POST', '/api/users/login', null, { identifier: 'alex', password: 'password123' })).data.session_token;
  const g = await api('POST', '/api/groups', alexT, { name: 'SETTLE Load ' + Date.now(), members: [{ user_id: 2 }] });
  const gid = g.data.id;
  await api('POST', '/api/expenses', alexT, {
    group_id: gid, paid_by: 2, amount: 1000, description: 'Settle load test',
    split_type: 'equal', splits: [{ user_id: 1 }, { user_id: 2 }]
  });`;

const newSetup = `  const alexT = (await api('POST', '/api/users/login', null, { identifier: 'alex', password: 'password123' })).data.session_token;
  const bcrypt = require('bcrypt');
  const suffix = Date.now();
  const peerRes = await pool.query(\`
    INSERT INTO users (name, email, username, password_hash, avatar_initials, upi_id, phone, is_verified, is_active)
    VALUES ($1, $2, $3, $4, 'ST', $5, '+91 90000 00000', TRUE, TRUE)
    RETURNING id
  \`, ['Settle Peer ' + suffix, 'settle.peer.' + suffix + '@example.com', 'settlepeer' + suffix, await bcrypt.hash('password123', 10), 'settlepeer' + suffix + '@okaxis']);
  const peerId = peerRes.rows[0].id;
  const g = await api('POST', '/api/groups', alexT, { name: 'SETTLE Load ' + suffix, members: [{ user_id: peerId }] });
  const gid = g.data.id;
  await api('POST', '/api/expenses', alexT, {
    group_id: gid, paid_by: peerId, amount: 1000, description: 'Settle load test',
    split_type: 'equal', splits: [{ user_id: 1 }, { user_id: peerId }]
  });`;

if (!c.includes(oldSetup)) { console.error('setup block not found'); process.exit(1); }
c = c.replace(oldSetup, newSetup);

c = c.replace(
  `const peerClicked = await cdp.evaluate(\`(() => { const b = document.querySelector("button[onclick*=\\\\"openSettleForPeer(2,\\\\"]"); if (!b) return false; b.click(); return true; })()\`);`,
  `const peerClicked = await cdp.evaluate(\`(() => { const b = document.querySelector("button[onclick*=\\\\"openSettleForPeer(\\${'$'}{peerId},\\\\"]"); if (!b) return false; b.click(); return true; })()\`);`
);
c = c.replace(
  `check('selecting a peer prefills that peer only', peerClicked && selected.receiver === 'Rahul Sharma' && Number(selected.amount) === 500, JSON.stringify(selected));`,
  `check('selecting a peer prefills that peer only', peerClicked && selected.receiver === 'Settle Peer ' + suffix && Number(selected.amount) === 500, JSON.stringify(selected));`
);
c = c.replace(
  `const created = (pendingAfterGenerate.data || []).find(r => Number(r.payer_id) === 1 && Number(r.receiver_id) === 2);`,
  `const created = (pendingAfterGenerate.data || []).find(r => Number(r.payer_id) === 1 && Number(r.receiver_id) === peerId);`
);
c = c.replace(
  `const samePair = (pendingAfterRegen.data || []).filter(r => Number(r.payer_id) === 1 && Number(r.receiver_id) === 2);`,
  `const samePair = (pendingAfterRegen.data || []).filter(r => Number(r.payer_id) === 1 && Number(r.receiver_id) === peerId);`
);
c = c.replace(
  `    await cl.query('DELETE FROM groups WHERE id=$1', [gid]);
    await cl.query('COMMIT');`,
  `    await cl.query('DELETE FROM groups WHERE id=$1', [gid]);
    await cl.query('DELETE FROM users WHERE id=$1', [peerId]);
    await cl.query('COMMIT');`
);
fs.writeFileSync(p, c);
console.log('patched settle load test with isolated peer');
