const fs = require('fs');
let c = fs.readFileSync('scripts/_audit/test-groups.js', 'utf8');
const reps = [
  {
    find: `  const g2 = await api('POST', '/api/groups', alexT, { name: 'EMPTY Audit ' + Date.now(), members: [] });`,
    replace: `  const g2name = 'EMPTY Audit ' + Date.now();
  const g2 = await api('POST', '/api/groups', alexT, { name: g2name, members: [] });`
  },
  {
    find: `  const auditPreserved = await pool.query("SELECT COUNT(*)::int n FROM activity_logs WHERE activity_type='GROUP_DELETED' AND message LIKE '%EMPTY Audit%'");`,
    replace: `  const auditPreserved = await pool.query("SELECT COUNT(*)::int n FROM activity_logs WHERE activity_type='GROUP_DELETED' AND message LIKE '%' || $1 || '%'", [g2name]);`
  }
];
for (const r of reps) {
  const n = c.split(r.find).length - 1;
  if (n !== 1) { console.error('MATCH(' + n + ')'); process.exit(1); }
  c = c.replace(r.find, r.replace);
}
fs.writeFileSync('scripts/_audit/test-groups.js', c);
console.log('patched');
