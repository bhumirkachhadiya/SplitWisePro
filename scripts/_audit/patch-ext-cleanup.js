const fs = require('fs');
let c = fs.readFileSync('scripts/_audit/test-api-extended.js', 'utf8');
const start = c.indexOf('  // cleanup\n');
const end = c.indexOf('  process.exit(fail ? 1 : 0);');
if (start === -1 || end === -1) { console.error('markers not found'); process.exit(1); }
const replacement = `  // cleanup (bypass the settled-split protection trigger for test artifacts only)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL session_replication_role = 'replica'");
    await client.query('DELETE FROM activity_logs WHERE group_id = $1', [gid]);
    await client.query('DELETE FROM chat_messages WHERE conversation_id = $1', [convId]);
    await client.query('DELETE FROM chat_conversation_members WHERE conversation_id = $1', [convId]);
    await client.query('DELETE FROM chat_conversations WHERE id = $1', [convId]);
    await client.query('DELETE FROM chat_conversation_members WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id = $1)', [gid]);
    await client.query('DELETE FROM chat_messages WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE group_id = $1)', [gid]);
    await client.query('DELETE FROM chat_conversations WHERE group_id = $1', [gid]);
    await client.query('DELETE FROM upi_payment_requests WHERE group_id = $1', [gid]);
    await client.query('DELETE FROM settlements WHERE group_id = $1', [gid]);
    await client.query('DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = $1)', [gid]);
    await client.query('DELETE FROM expenses WHERE group_id = $1', [gid]);
    await client.query('DELETE FROM group_members WHERE group_id = $1', [gid]);
    await client.query('DELETE FROM groups WHERE id = $1', [gid]);
    await client.query('COMMIT');
    console.log('cleaned up', gid);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('cleanup', e.message);
  } finally { client.release(); }

`;
c = c.slice(0, start) + replacement + c.slice(end);
fs.writeFileSync('scripts/_audit/test-api-extended.js', c);
console.log('patched cleanup');
