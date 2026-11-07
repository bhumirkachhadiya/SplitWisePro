const fs = require('fs');
let c = fs.readFileSync('scripts/_audit/test-idor.js', 'utf8');
const reps = [
  {
    find: `  const alexT = (await api('POST', '/api/users/login', null, { identifier: 'alex', password: 'password123' })).data.session_token;

  const foreignExp = await pool.query(\`
    SELECT e.id FROM expenses e
    WHERE NOT EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = e.group_id AND gm.user_id = 1)
      AND e.paid_by <> 1
      AND NOT EXISTS (SELECT 1 FROM expense_splits es WHERE es.expense_id = e.id AND es.user_id = 1)
    LIMIT 1\`);
  if (foreignExp.rows.length) {
    const id = foreignExp.rows[0].id;
    const r = await api('GET', '/api/expenses/' + id, alexT);
    check('foreign expense details are blocked (IDOR)', r.status === 403, 'expense=' + id + ' status=' + r.status);
    const put = await api('PUT', '/api/expenses/' + id, alexT, { description: 'hack', amount: 1, split_type: 'equal', splits: [{ user_id: 1, amount: 1 }] });
    check('foreign expense edit is blocked', put.status === 403, 'status=' + put.status);
    const del = await api('DELETE', '/api/expenses/' + id, alexT);
    check('foreign expense delete is blocked', del.status === 403, 'status=' + del.status);
  } else {
    check('foreign expense details are blocked (IDOR)', false, 'no foreign expense available');
  }`,
    replace: `  const alexT = (await api('POST', '/api/users/login', null, { identifier: 'alex', password: 'password123' })).data.session_token;
  const rahulT = (await api('POST', '/api/users/login', null, { identifier: 'rahul', password: 'password123' })).data.session_token;

  const foreignExp = await pool.query(\`
    SELECT e.id FROM expenses e
    WHERE NOT EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = e.group_id AND gm.user_id = 2)
      AND e.paid_by <> 2
      AND NOT EXISTS (SELECT 1 FROM expense_splits es WHERE es.expense_id = e.id AND es.user_id = 2)
      AND EXISTS (SELECT 1 FROM group_members gm3 WHERE gm3.group_id = e.group_id AND gm3.user_id = 1)
    LIMIT 1\`);
  if (foreignExp.rows.length) {
    const id = foreignExp.rows[0].id;
    const r = await api('GET', '/api/expenses/' + id, rahulT);
    check('foreign expense details are blocked (IDOR)', r.status === 403, 'expense=' + id + ' status=' + r.status);
    const put = await api('PUT', '/api/expenses/' + id, rahulT, { description: 'hack', amount: 1, split_type: 'equal', splits: [{ user_id: 2, amount: 1 }] });
    check('foreign expense edit is blocked', put.status === 403, 'status=' + put.status);
    const del = await api('DELETE', '/api/expenses/' + id, rahulT);
    check('foreign expense delete is blocked', del.status === 403, 'status=' + del.status);
    const adminView = await api('GET', '/api/expenses/' + id, alexT);
    check('master admin may inspect an expense for support', adminView.status === 200, 'status=' + adminView.status);
  } else {
    check('foreign expense details are blocked (IDOR)', false, 'no foreign expense available');
  }`
  }
];
for (const r of reps) {
  const n = c.split(r.find).length - 1;
  if (n !== 1) { console.error('MATCH(' + n + ')'); process.exit(1); }
  c = c.replace(r.find, r.replace);
}
fs.writeFileSync('scripts/_audit/test-idor.js', c);
console.log('patched');
