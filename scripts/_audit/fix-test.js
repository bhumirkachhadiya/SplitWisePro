const fs = require('fs');
let c = fs.readFileSync('scripts/_audit/test-financial-e2e.js', 'utf8');
const reps = [
  {
    find: `  // ---------- Personal summary delta ----------
  const summaryAfter = await api('GET', '/api/balances/summary', alexT);
  const netDelta = round2(summaryAfter.data.net_balance - summaryBefore.data.net_balance);
  const groupNet = round2(balMap[1]);
  check('personal ledger delta matches group exposure', Math.abs(netDelta - groupNet) < 1.0,
    'personalDelta=' + netDelta + ' groupNet=' + groupNet);

  // ---------- Cross-screen: group details vs balances ----------
  const gd = await api('GET', '/api/groups/' + gid, alexT);
  check('group details user_net_balance equals balances screen',
    Math.abs(round2(gd.data.user_net_balance) - round2(balMap[1])) < 0.02,
    'details=' + gd.data.user_net_balance + ' balances=' + balMap[1]);`,
    replace: `  // ---------- Personal summary delta ----------
  const balNow = await api('GET', \`/api/groups/\${gid}/balances\`, alexT);
  const balNowMap = {};
  (balNow.data || []).forEach(b => balNowMap[b.user_id] = b.net_balance);
  const summaryAfter = await api('GET', '/api/balances/summary', alexT);
  const netDelta = round2(summaryAfter.data.net_balance - summaryBefore.data.net_balance);
  const groupNet = round2(balNowMap[1]);
  check('personal ledger delta matches group exposure', Math.abs(netDelta - groupNet) < 1.0,
    'personalDelta=' + netDelta + ' groupNet=' + groupNet);

  // ---------- Cross-screen: group details vs balances ----------
  const gd = await api('GET', '/api/groups/' + gid, alexT);
  check('group details user_net_balance equals balances screen',
    Math.abs(round2(gd.data.user_net_balance) - round2(balNowMap[1])) < 0.02,
    'details=' + gd.data.user_net_balance + ' balances=' + balNowMap[1]);`
  },
  {
    find: `  const notMember = await api('GET', '/api/groups/84/expenses', alexT);
  check('non-member cannot read another circle (403)', notMember.status === 403, 'status=' + notMember.status);`,
    replace: `  const foreign = await pool.query('SELECT g.id FROM groups g WHERE NOT EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = 1) LIMIT 1');
  if (foreign.rows.length > 0) {
    const notMember = await api('GET', \`/api/groups/\${foreign.rows[0].id}/expenses\`, alexT);
    check('non-member cannot read another circle (403)', notMember.status === 403, 'status=' + notMember.status + ' group=' + foreign.rows[0].id);
    const notMemberMembers = await api('GET', \`/api/groups/\${foreign.rows[0].id}/members\`, alexT);
    check('non-member cannot list another circle\\'s members (403)', notMemberMembers.status === 403, 'status=' + notMemberMembers.status);
  } else {
    check('non-member cannot read another circle (403)', false, 'no foreign group available');
  }`
  }
];
for (const r of reps) {
  const n = c.split(r.find).length - 1;
  if (n !== 1) { console.error('MATCH(' + n + '): ' + r.find.slice(0, 60)); process.exit(1); }
  c = c.replace(r.find, r.replace);
}
fs.writeFileSync('scripts/_audit/test-financial-e2e.js', c);
console.log('test updated');
