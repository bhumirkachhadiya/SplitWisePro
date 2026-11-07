const BASE = 'http://127.0.0.1:5000';
const { pool } = require('../../db');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log('PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { failed++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('FAIL  ' + name + (detail ? '  — ' + detail : '')); }
}
async function api(method, path, token, body) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch (e) {}
  return { status: res.status, data, text };
}
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

(async () => {
  const login = async id => (await api('POST', '/api/users/login', null, { identifier: id, password: 'password123' })).data.session_token;
  const alexT = await login('alex');
  const rahulT = await login('rahul');
  const priyaT = await login('priya');

  const summaryBefore = await api('GET', '/api/balances/summary', alexT);

  // ---------- Create isolated test circle ----------
  const gname = 'AUDIT Circle ' + Date.now();
  const g = await api('POST', '/api/groups', alexT, {
    name: gname, description: 'automated audit', category: 'Test',
    members: [{ user_id: 2, role: 'editor' }, { user_id: 3, role: 'member' }]
  });
  check('create group', g.status === 201 && g.data.id, 'id=' + (g.data && g.data.id));
  const gid = g.data.id;

  const dup = await api('POST', '/api/groups', alexT, { name: gname, members: [] });
  check('duplicate group submission blocked (409)', dup.status === 409, 'status=' + dup.status);

  const memberCreate = await api('POST', '/api/expenses', priyaT, {
    group_id: gid, paid_by: 3, amount: 100, description: 'should fail',
    split_type: 'equal', splits: [{ user_id: 3, amount: 100 }]
  });
  check('normal member cannot create expense (403)', memberCreate.status === 403, 'status=' + memberCreate.status);

  const outsider = await api('GET', `/api/groups/${gid}/expenses`, rahulT === alexT ? null : null);
  check('unauthenticated group access blocked', outsider.status === 401, 'status=' + outsider.status);

  // ---------- Equal split 1000 / 3 ----------
  const eq = await api('POST', '/api/expenses', alexT, {
    group_id: gid, paid_by: 1, amount: 1000, description: 'Equal 1000',
    split_type: 'equal', splits: [{ user_id: 1 }, { user_id: 2 }, { user_id: 3 }]
  });
  check('equal expense created', eq.status === 201, 'status=' + eq.status + ' body=' + eq.text.slice(0, 120));
  const eqId = eq.data && eq.data.id;
  let eqDetail = await api('GET', '/api/expenses/' + eqId, alexT);
  const eqSplits = eqDetail.data.splits || [];
  const eqSum = round2(eqSplits.reduce((a, s) => a + Number(s.amount), 0));
  check('equal split sums exactly to total', eqSplits.length === 3 && eqSum === 1000, 'n=' + eqSplits.length + ' sum=' + eqSum);
  const eqAmounts = eqSplits.map(s => s.amount).sort((a, b) => a - b);
  check('equal split penny-accurate (333.33/333.33/333.34)',
    JSON.stringify(eqAmounts) === JSON.stringify([333.33, 333.33, 333.34]), JSON.stringify(eqAmounts));

  // ---------- Exact split ----------
  const exact = await api('POST', '/api/expenses', alexT, {
    group_id: gid, paid_by: 1, amount: 1000, description: 'Exact split',
    split_type: 'exact', splits: [{ user_id: 1, amount: 500 }, { user_id: 2, amount: 300 }, { user_id: 3, amount: 200 }]
  });
  const exactDetail = await api('GET', '/api/expenses/' + exact.data.id, alexT);
  check('exact split preserved exactly',
    exact.status === 201 && round2(exactDetail.data.splits.reduce((a, s) => a + Number(s.amount), 0)) === 1000,
    exact.text.slice(0, 100));

  // ---------- Percentage ----------
  const pct = await api('POST', '/api/expenses', alexT, {
    group_id: gid, paid_by: 1, amount: 999.99, description: 'Pct split',
    split_type: 'percentage',
    splits: [{ user_id: 1, percentage: 33.33 }, { user_id: 2, percentage: 33.33 }, { user_id: 3, percentage: 33.34 }]
  });
  const pctDetail = await api('GET', '/api/expenses/' + pct.data.id, alexT);
  const pctSum = round2(pctDetail.data.splits.reduce((a, s) => a + Number(s.amount), 0));
  check('percentage split sums exactly to 999.99', pct.status === 201 && pctSum === 999.99, 'status=' + pct.status + ' sum=' + pctSum + ' ' + pct.text.slice(0, 80));

  const badPct = await api('POST', '/api/expenses', alexT, {
    group_id: gid, paid_by: 1, amount: 100, description: 'bad pct',
    split_type: 'percentage', splits: [{ user_id: 1, percentage: 50 }, { user_id: 2, percentage: 40 }]
  });
  check('percentage not equal to 100 is rejected', badPct.status === 400, 'status=' + badPct.status);

  // ---------- Shares ----------
  const shares = await api('POST', '/api/expenses', alexT, {
    group_id: gid, paid_by: 1, amount: 1000, description: 'Shares split',
    split_type: 'shares',
    splits: [{ user_id: 1, shares: 2 }, { user_id: 2, shares: 1 }, { user_id: 3, shares: 1 }]
  });
  const sharesDetail = await api('GET', '/api/expenses/' + shares.data.id, alexT);
  const shareMap = {};
  (sharesDetail.data.splits || []).forEach(s => shareMap[s.user_id] = Number(s.amount));
  check('shares split allocates 2:1:1 exactly',
    shares.status === 201 && shareMap[1] === 500 && shareMap[2] === 250 && shareMap[3] === 250,
    JSON.stringify(shareMap));

  const badShares = await api('POST', '/api/expenses', alexT, {
    group_id: gid, paid_by: 1, amount: 100, description: 'bad shares',
    split_type: 'shares', splits: [{ user_id: 1, shares: 0 }, { user_id: 2, shares: 0 }]
  });
  check('zero-share split is rejected', badShares.status === 400, 'status=' + badShares.status);

  // ---------- Group balances ----------
  const balAlex = await api('GET', `/api/groups/${gid}/balances`, alexT);
  const balMap = {};
  (balAlex.data || []).forEach(b => balMap[b.user_id] = b.net_balance);
  const expectedAlex = round2((1000 - 333.34) + (1000 - 500) + round2(999.99 - 333.33) + (1000 - 500));
  // alex is creditor for all four expenses; his net = sum of others' outstanding
  check('group balance is consistent with splits', Math.abs(balMap[1] + balMap[2] + balMap[3]) < 0.02,
    JSON.stringify(balMap));
  check('paid-by member receives, others owe', balMap[1] > 0 && balMap[2] < 0 && balMap[3] < 0, JSON.stringify(balMap));

  // ---------- Partial settlement ----------
  const rahulOwedBefore = Math.abs(balMap[2]);
  const partial = await api('POST', '/api/settlements', rahulT, {
    group_id: gid, payer_id: 2, receiver_id: 1, amount: 100, payment_method: 'UPI'
  });
  check('partial settlement accepted (100)', partial.status === 201, 'status=' + partial.status + ' ' + partial.text.slice(0, 120));
  const balAfterPartial = await api('GET', `/api/groups/${gid}/balances`, rahulT);
  const pMap = {};
  (balAfterPartial.data || []).forEach(b => pMap[b.user_id] = b.net_balance);
  check('partial settlement reduces balance by exactly 100',
    Math.abs(Math.abs(pMap[2]) - (rahulOwedBefore - 100)) < 0.02,
    'before=' + rahulOwedBefore + ' after=' + Math.abs(pMap[2]));

  const over = await api('POST', '/api/settlements', rahulT, {
    group_id: gid, payer_id: 2, receiver_id: 1, amount: 999999
  });
  check('over-settlement is rejected (400)', over.status === 400, 'status=' + over.status + ' ' + over.text.slice(0, 100));

  const spoofPay = await api('POST', '/api/settlements', rahulT, {
    group_id: gid, payer_id: 3, receiver_id: 1, amount: 10
  });
  check('cannot record a settlement as another payer (403)', spoofPay.status === 403, 'status=' + spoofPay.status);

  // ---------- Delete protection ----------
  const delProtected = await api('DELETE', '/api/expenses/' + eqId, alexT);
  check('partially settled expense cannot be deleted (403)', delProtected.status === 403, 'status=' + delProtected.status + ' ' + delProtected.text.slice(0, 100));

  const editProtected = await api('PUT', '/api/expenses/' + eqId, alexT, {
    description: 'edited', amount: 1000, split_type: 'equal',
    splits: [{ user_id: 1, amount: 500 }, { user_id: 2, amount: 300 }, { user_id: 3, amount: 200 }]
  });
  check('partially settled expense cannot be destructively edited (403)', editProtected.status === 403, 'status=' + editProtected.status);

  // ---------- Correction ----------
  const corr = await api('POST', `/api/expenses/${eqId}/correction`, alexT, {
    reason: 'audit test correction', new_amount: 1200
  });
  const corrDetail = await api('GET', '/api/expenses/' + eqId, alexT);
  const corrSum = round2((corrDetail.data.splits || []).reduce((a, s) => a + Number(s.amount), 0));
  const corrSettled = round2((corrDetail.data.splits || []).reduce((a, s) => a + Number(s.settled_amount || 0), 0));
  check('correction keeps total and settled amounts exact',
    corr.status === 200 && corrSum === 1200 && corrSettled === 100,
    'status=' + corr.status + ' sum=' + corrSum + ' settled=' + corrSettled);

  // ---------- Lock ----------
  const lock = await api('POST', `/api/groups/${gid}/lock`, alexT, {});
  check('group lock succeeds', lock.status === 200, 'status=' + lock.status);
  const lockedExpense = await api('POST', '/api/expenses', alexT, {
    group_id: gid, paid_by: 1, amount: 50, description: 'locked attempt',
    split_type: 'equal', splits: [{ user_id: 1 }, { user_id: 2 }]
  });
  check('locked group rejects new expense (400)', lockedExpense.status === 400, 'status=' + lockedExpense.status);
  const lockedEdit = await api('PUT', '/api/expenses/' + eqId, alexT, {
    description: 'locked edit', amount: 1200, split_type: 'equal',
    splits: [{ user_id: 1, amount: 600 }, { user_id: 2, amount: 300 }, { user_id: 3, amount: 300 }]
  });
  check('locked group rejects expense edit (400)', lockedEdit.status === 400, 'status=' + lockedEdit.status);
  const unlock = await api('POST', `/api/groups/${gid}/unlock`, alexT, {});
  check('group unlock succeeds', unlock.status === 200, 'status=' + unlock.status);

  // ---------- Personal summary delta ----------
  const balNow = await api('GET', `/api/groups/${gid}/balances`, alexT);
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
    'details=' + gd.data.user_net_balance + ' balances=' + balNowMap[1]);

  // ---------- AI participant selection ----------
  const ai = await api('POST', '/api/chatbot/query', alexT, {
    query: `Add an expense of ₹4000 for me and Rahul Sharma in ${gname}`, conversation_id: 'audit-ai-1'
  });
  const aiOk = ai.status === 200 && ai.data.action === 'CONFIRM_TOOL';
  check('AI proposes an expense for named participants', aiOk, 'action=' + (ai.data && ai.data.action) + ' reply=' + (ai.data && String(ai.data.reply).slice(0, 120)));
  if (aiOk) {
    const parts = (ai.data.toolCall.params.participants || []).map(p => p.id).sort();
    check('AI participant set is exactly [1,2] (not all group members)', JSON.stringify(parts) === JSON.stringify([1, 2]), JSON.stringify(parts));
    const conf = await api('POST', '/api/chatbot/confirm-action', alexT, { toolCall: ai.data.toolCall });
    check('AI expense confirmed and created', conf.status === 200 && conf.data.success !== false, 'status=' + conf.status + ' ' + conf.text.slice(0, 120));
    if (conf.data && conf.data.result && conf.data.result.expenseId) {
      const aiExp = await api('GET', '/api/expenses/' + conf.data.result.expenseId, alexT);
      const aiUids = (aiExp.data.splits || []).map(s => s.user_id).sort();
      const aiSum = round2((aiExp.data.splits || []).reduce((a, s) => a + Number(s.amount), 0));
      check('AI-created expense has exactly 2 splits and exact total',
        JSON.stringify(aiUids) === JSON.stringify([1, 2]) && aiSum === 4000,
        'uids=' + JSON.stringify(aiUids) + ' sum=' + aiSum);
    }
  }

  const aiNoParticipants = await api('POST', '/api/chatbot/query', alexT, {
    query: `Add an expense of ₹500 for team lunch in ${gname}`, conversation_id: 'audit-ai-2'
  });
  check('AI does not auto-add all members when participants are missing',
    aiNoParticipants.status === 200 && aiNoParticipants.data.action !== 'CONFIRM_TOOL',
    'action=' + (aiNoParticipants.data && aiNoParticipants.data.action));

  // ---------- cross-user isolation ----------
  const otherGroup = await api('GET', '/api/groups/1/expenses', rahulT); // rahul is in group 1
  check('member can read own group', otherGroup.status === 200, 'status=' + otherGroup.status);
  const foreign = await pool.query('SELECT g.id FROM groups g WHERE NOT EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = 1) LIMIT 1');
  if (foreign.rows.length > 0) {
    const notMember = await api('GET', `/api/groups/${foreign.rows[0].id}/expenses`, alexT);
    check('non-member cannot read another circle (403)', notMember.status === 403, 'status=' + notMember.status + ' group=' + foreign.rows[0].id);
    const notMemberMembers = await api('GET', `/api/groups/${foreign.rows[0].id}/members`, alexT);
    check('non-member cannot list another circle\'s members (403)', notMemberMembers.status === 403, 'status=' + notMemberMembers.status);
  } else {
    check('non-member cannot read another circle (403)', false, 'no foreign group available');
  }

  console.log('\nRESULT:', passed, 'passed,', failed, 'failed');
  if (failures.length) console.log('FAILURES:\n - ' + failures.join('\n - '));

  // Cleanup isolated test circle
  try {
    await pool.query('DELETE FROM activity_logs WHERE group_id = $1', [gid]);
    await pool.query('DELETE FROM chat_conversation_members WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id = $1)', [gid]);
    await pool.query('DELETE FROM chat_messages WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id = $1)', [gid]);
    await pool.query('DELETE FROM chat_conversations WHERE group_id = $1', [gid]);
    await pool.query('DELETE FROM settlements WHERE group_id = $1', [gid]);
    await pool.query('DELETE FROM upi_payment_requests WHERE group_id = $1', [gid]);
    await pool.query('DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = $1)', [gid]);
    await pool.query('DELETE FROM expense_corrections WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = $1)', [gid]);
    await pool.query('DELETE FROM expenses WHERE group_id = $1', [gid]);
    await pool.query('DELETE FROM group_members WHERE group_id = $1', [gid]);
    await pool.query('DELETE FROM groups WHERE id = $1', [gid]);
    console.log('Cleaned up test circle', gid);
  } catch (e) { console.error('cleanup warning', e.message); }

  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
