const { openPage } = require('./cdp-lib');
const { pool } = require('../../db');
const BASE = 'http://127.0.0.1:5000';
async function api(method, p, token, body) {
  const h = { 'Content-Type': 'application/json' }; if (token) h.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text(); let d = null; try { d = JSON.parse(t); } catch (e) {}
  return { status: res.status, data: d, text: t };
}
(async () => {
  const alexT = (await api('POST', '/api/users/login', null, { identifier: 'alex', password: 'password123' })).data.session_token;
  const rahulT = (await api('POST', '/api/users/login', null, { identifier: 'rahul', password: 'password123' })).data.session_token;
  const g = await api('POST', '/api/groups', alexT, { name: 'DBG Pay ' + Date.now(), members: [{ user_id: 2, role: 'member' }] });
  console.log('group', g.status, g.data && g.data.id);
  const gid = g.data.id;
  const e = await api('POST', '/api/expenses', alexT, { group_id: gid, paid_by: 1, amount: 600, description: 'dbg', split_type: 'equal', splits: [{ user_id: 1 }, { user_id: 2 }] });
  console.log('expense', e.status, e.text.slice(0, 100));
  const pr = await api('POST', '/api/upi/create-payment-request', rahulT, { payer_id: 2, receiver_id: 1, group_id: gid, amount: 300 });
  console.log('request', pr.status, pr.text.slice(0, 160));
  const rid = pr.data && pr.data.request_id;
  const claim = await api('POST', '/api/upi/claim-payment', rahulT, { request_id: rid });
  console.log('claim', claim.status, claim.text.slice(0, 120));
  const pend = await api('GET', '/api/upi/pending-requests', rahulT);
  console.log('pending', pend.status, Array.isArray(pend.data) ? pend.data.length : pend.text.slice(0, 100), (pend.data || []).filter(x => x.request_id === rid).length);

  const c = await openPage(BASE + '/');
  await c.waitFor('document.readyState === "complete"');
  await c.send('Network.clearBrowserCookies');
  await c.evaluate('localStorage.clear(); sessionStorage.clear();');
  await c.goto(BASE + '/');
  await new Promise(r => setTimeout(r, 800));
  await c.evaluate(`(() => { document.getElementById('authEmail').value='rahul'; document.getElementById('authPassword').value='password123'; document.getElementById('authForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); })()`);
  await c.waitFor('!document.getElementById("appWorkspace").classList.contains("hidden")', 15000);
  await new Promise(r => setTimeout(r, 2500));
  await c.evaluate(`navigateTo('settle')`);
  await new Promise(r => setTimeout(r, 2500));
  console.log('panel:', await c.evaluate(`(() => { const p=document.getElementById('pendingPaymentsPanel'); const l=document.getElementById('pendingPaymentsList'); return { cls:p.className, len:l.innerHTML.length, hasRid:l.innerHTML.indexOf(${JSON.stringify(rid)})!==-1, rows: Array.from(l.querySelectorAll(':scope > div')).map(r=>r.innerText.replace(/\\s+/g,' ').slice(0,80)) }; })()`));
  console.log('manual render:', await c.evaluate(`(async () => { try { const t = typeof renderSettleUp; renderSettleUp(); await new Promise(r=>setTimeout(r,1000)); const p=document.getElementById('pendingPaymentsPanel'); const l=document.getElementById('pendingPaymentsList'); return { t, cls:p.className, len:l.innerHTML.length, hasRid:l.innerHTML.indexOf(${JSON.stringify(rid)})!==-1 }; } catch(e){ return String(e); } })()`));
  console.log('api from page:', await c.evaluate(`(async()=>{const r=await fetch(API+'/upi/pending-requests'); const t=await r.text(); return {status:r.status,len:t.length, has: t.indexOf(${JSON.stringify(rid)})!==-1};})()`));
  console.log('errors:', c.errors.slice(0,5));
  c.close();
  // cleanup
  const cl = await pool.connect();
  try { await cl.query('BEGIN'); await cl.query("SET LOCAL session_replication_role='replica'");
    await cl.query('DELETE FROM activity_logs WHERE group_id=$1',[gid]);
    await cl.query('DELETE FROM upi_payment_requests WHERE group_id=$1',[gid]);
    await cl.query('DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE group_id=$1)',[gid]);
    await cl.query('DELETE FROM expenses WHERE group_id=$1',[gid]);
    await cl.query('DELETE FROM chat_conversations WHERE group_id=$1',[gid]);
    await cl.query('DELETE FROM group_members WHERE group_id=$1',[gid]);
    await cl.query('DELETE FROM groups WHERE id=$1',[gid]);
    await cl.query('COMMIT'); console.log('cleaned');
  } catch(e){ await cl.query('ROLLBACK'); console.error(e.message);} finally{cl.release();}
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
