const { pool } = require('../../db');
(async () => {
  const groups = await pool.query("SELECT id FROM groups WHERE name ILIKE 'MARKPAID%'");
  const users = await pool.query("SELECT id FROM users WHERE name ILIKE 'Mkt %' OR name ILIKE 'Browser Debtor%' OR name ILIKE 'Browser Receiver%'");
  const c = await pool.connect();
  try {
    await c.query('BEGIN'); await c.query("SET LOCAL session_replication_role='replica'");
    for (const g of groups.rows) {
      const gid = g.id;
      await c.query('DELETE FROM activity_logs WHERE group_id=$1', [gid]);
      await c.query('DELETE FROM chat_messages WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id=$1)', [gid]);
      await c.query('DELETE FROM chat_conversation_members WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id=$1)', [gid]);
      await c.query('DELETE FROM chat_conversations WHERE group_id=$1', [gid]);
      await c.query('DELETE FROM payment_requests WHERE group_id=$1', [gid]);
      await c.query('DELETE FROM settlements WHERE group_id=$1', [gid]);
      await c.query('DELETE FROM expense_corrections WHERE expense_id IN (SELECT id FROM expenses WHERE group_id=$1)', [gid]);
      await c.query('DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE group_id=$1)', [gid]);
      await c.query('DELETE FROM expenses WHERE group_id=$1', [gid]);
      await c.query('DELETE FROM group_members WHERE group_id=$1', [gid]);
      await c.query('DELETE FROM groups WHERE id=$1', [gid]);
    }
    for (const u of users.rows) {
      await c.query('DELETE FROM payment_requests WHERE payer_id=$1 OR receiver_id=$1', [u.id]);
      await c.query('DELETE FROM activity_logs WHERE user_id=$1', [u.id]);
      await c.query('DELETE FROM group_members WHERE user_id=$1', [u.id]);
      await c.query('DELETE FROM users WHERE id=$1', [u.id]);
    }
    await c.query('COMMIT');
    console.log('removed groups', groups.rowCount, 'users', users.rowCount);
  } catch (e) { await c.query('ROLLBACK'); console.error(e.message); } finally { c.release(); }
  const check = await pool.query('SELECT COUNT(*)::int n FROM payment_requests');
  console.log('payment_requests remaining', check.rows[0].n);
  process.exit(0);
})();
