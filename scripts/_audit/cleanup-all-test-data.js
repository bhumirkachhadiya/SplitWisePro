const { pool } = require('../../db');

(async () => {
  const client = await pool.connect();
  try {
    const pattern = `(name LIKE 'SETTLE Load %' OR name LIKE 'UIPAY Audit %' OR name LIKE 'PAY Audit %'
      OR name LIKE 'BROWSER Circle %' OR name LIKE 'AUDIT Circle %' OR name LIKE 'GROUP Audit %'
      OR name LIKE 'MODEL Status %' OR name LIKE 'MODAL Status %' OR name LIKE 'STATUS Audit %'
      OR name LIKE 'DBG%' OR name LIKE 'DELTEST %' OR name LIKE 'EMPTY Audit %' OR name LIKE 'Role Verification %'
      OR name LIKE 'Role-Test-Circle-%' OR name LIKE 'STATUS DEBUG %')`;
    const groups = await client.query(`SELECT id, name FROM groups WHERE ${pattern}`);
    const users = await client.query(`SELECT id, name, email FROM users WHERE name LIKE 'Settle Peer %' AND email LIKE 'settle.peer.%@example.com'`);

    await client.query('BEGIN');
    await client.query("SET LOCAL session_replication_role = 'replica'");

    for (const g of groups.rows) {
      const gid = g.id;
      await client.query('DELETE FROM activity_logs WHERE group_id=$1', [gid]);
      await client.query('DELETE FROM chat_messages WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id=$1)', [gid]);
      await client.query('DELETE FROM chat_conversation_members WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id=$1)', [gid]);
      await client.query('DELETE FROM chat_conversations WHERE group_id=$1', [gid]);
      await client.query('DELETE FROM upi_payment_requests WHERE group_id=$1', [gid]);
      await client.query('DELETE FROM settlements WHERE group_id=$1', [gid]);
      await client.query('DELETE FROM expense_corrections WHERE expense_id IN (SELECT id FROM expenses WHERE group_id=$1)', [gid]);
      await client.query('DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE group_id=$1)', [gid]);
      await client.query('DELETE FROM expenses WHERE group_id=$1', [gid]);
      await client.query('DELETE FROM group_members WHERE group_id=$1', [gid]);
      await client.query('DELETE FROM groups WHERE id=$1', [gid]);
    }

    for (const u of users.rows) {
      await client.query('DELETE FROM activity_logs WHERE user_id=$1', [u.id]);
      await client.query('DELETE FROM friends WHERE user_id=$1 OR friend_id=$1', [u.id]);
      await client.query('DELETE FROM friend_requests WHERE sender_id=$1 OR receiver_id=$1', [u.id]);
      await client.query('DELETE FROM chat_conversation_members WHERE user_id=$1', [u.id]);
      await client.query('DELETE FROM group_members WHERE user_id=$1', [u.id]);
      await client.query('DELETE FROM upi_payment_requests WHERE payer_id=$1 OR receiver_id=$1', [u.id]);
      await client.query('DELETE FROM settlements WHERE payer_id=$1 OR receiver_id=$1', [u.id]);
      await client.query('DELETE FROM expense_splits WHERE user_id=$1', [u.id]);
      await client.query('DELETE FROM expenses WHERE paid_by=$1', [u.id]);
      await client.query('DELETE FROM users WHERE id=$1', [u.id]);
    }

    const expired = await client.query("UPDATE upi_payment_requests SET status='EXPIRED', updated_at=NOW() WHERE status='PENDING' AND claimed_at IS NULL");
    await client.query('COMMIT');
    console.log('removed groups:', groups.rowCount, '| removed test users:', users.rowCount, '| expired unclaimed pending:', expired.rowCount);
  } catch (e) {
    await client.query('ROLLBACK'); console.error(e.message); process.exitCode = 1;
  } finally {
    client.release();
    const c = await pool.query(`SELECT (SELECT count(*)::int FROM groups) groups, (SELECT count(*)::int FROM expenses) expenses, (SELECT count(*)::int FROM users) users, (SELECT count(*)::int FROM upi_payment_requests WHERE status='PENDING') pending`);
    console.table(c.rows);
    process.exit();
  }
})();
