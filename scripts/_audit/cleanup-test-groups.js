const { pool } = require('../../db');
const { spawn } = require('child_process');

async function cleanupGroup(gid) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL session_replication_role = 'replica'");
    await client.query('DELETE FROM activity_logs WHERE group_id = $1', [gid]);
    await client.query("DELETE FROM chat_conversation_members WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id = $1)", [gid]);
    await client.query("DELETE FROM chat_messages WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id = $1)", [gid]);
    await client.query('DELETE FROM chat_conversations WHERE group_id = $1', [gid]);
    await client.query('DELETE FROM upi_payment_requests WHERE group_id = $1', [gid]);
    await client.query('DELETE FROM settlements WHERE group_id = $1', [gid]);
    await client.query('DELETE FROM expense_corrections WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = $1)', [gid]);
    await client.query('DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = $1)', [gid]);
    await client.query('DELETE FROM expenses WHERE group_id = $1', [gid]);
    await client.query('DELETE FROM group_members WHERE group_id = $1', [gid]);
    await client.query('DELETE FROM groups WHERE id = $1', [gid]);
    await client.query('COMMIT');
    console.log('cleaned group', gid);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('cleanup failed', gid, e.message);
  } finally { client.release(); }
}

(async () => {
  const r = await pool.query(`SELECT id FROM groups WHERE name LIKE 'PAY Audit %' OR name LIKE 'AUDIT Circle %' OR name LIKE 'BROWSER Circle %'`);
  for (const row of r.rows) await cleanupGroup(row.id);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
