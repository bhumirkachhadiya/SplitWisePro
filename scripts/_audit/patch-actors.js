const fs = require('fs');
const file = 'server.js';
let src = fs.readFileSync(file, 'utf8');
const original = src;

const patches = [
  // ---- users currency ----
  {
    find: `        const userId = parseInt(req.params.id);
        const { currency } = req.body;
        const cur = (currency || 'INR').toUpperCase();`,
    replace: `        const userId = parseInt(req.params.id);
        const authId = actingUserId(req);
        if (userId !== authId && (!req.authUser || req.authUser.role !== 'master_admin')) {
            return res.status(403).json({ error: 'Permission denied: you can only change your own currency preference.' });
        }
        const { currency } = req.body;
        const cur = (currency || 'INR').toUpperCase();`
  },
  // ---- group currency ----
  {
    find: `        const groupId = parseInt(req.params.id);
        const { currency, requester_id } = req.body;
        const cur = (currency || 'INR').toUpperCase();
        if (!currencyService.SUPPORTED_CURRENCIES[cur]) {
            return res.status(400).json({ error: \`Unsupported currency '\${currency}'.\` });
        }
        if (requester_id) {
            const adminRes = await pool.query("SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2 AND role = 'admin'", [groupId, requester_id]);
            if (adminRes.rows.length === 0) {
                return res.status(403).json({ error: 'Only group administrators can change the base currency.' });
            }
        }`,
    replace: `        const groupId = parseInt(req.params.id);
        const { currency } = req.body;
        const cur = (currency || 'INR').toUpperCase();
        if (!currencyService.SUPPORTED_CURRENCIES[cur]) {
            return res.status(400).json({ error: \`Unsupported currency '\${currency}'.\` });
        }
        const requesterId = actingUserId(req);
        const adminRes = await pool.query(
            "SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2",
            [groupId, requesterId]
        );
        if (adminRes.rows.length === 0 || adminRes.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Only group administrators can change the base currency.' });
        }`
  },
  // ---- friends list ----
  {
    find: `        const userId = parseInt(req.query.userId);
        if (!userId || isNaN(userId)) {
            return res.json([]);
        }
        const friendsRes = await pool.query(\``,
    replace: `        const userId = actingUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required.' });
        }
        const friendsRes = await pool.query(\``
  },
  // ---- friend requests ----
  {
    find: `        const userId = parseInt(req.query.userId);
        if (!userId || isNaN(userId)) {
            return res.json({ incoming: [], outgoing: [] });
        }`,
    replace: `        const userId = actingUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required.' });
        }`
  },
  // ---- friend search ----
  {
    find: `        const { userId } = req.query;
        const currentUserId = parseInt(userId);
        if (!q || q.trim().length < 2) {`,
    replace: `        const currentUserId = actingUserId(req);
        if (!q || q.trim().length < 2) {`
  },
  // ---- send friend request ----
  {
    find: `        const { senderId, targetUserCodeOrEmail } = req.body;
        const sender = parseInt(senderId);
        if (!sender || isNaN(sender)) {`,
    replace: `        const { targetUserCodeOrEmail } = req.body;
        const sender = actingUserId(req);
        if (!sender) {`
  },
  // ---- respond friend request ----
  {
    find: `        const { requestId, userId, action } = req.body;
        const currentUserId = parseInt(userId);
        if (!['accept', 'reject'].includes(action)) {`,
    replace: `        const { requestId, action } = req.body;
        const currentUserId = actingUserId(req);
        if (!currentUserId) {
            await client.query('ROLLBACK');
            return res.status(401).json({ error: 'Authentication required.' });
        }
        if (!['accept', 'reject'].includes(action)) {`
  },
  // ---- cancel friend request ----
  {
    find: `        const { requestId, userId } = req.body;
        const currentUserId = parseInt(userId);

        const cancelRes = await pool.query(`,
    replace: `        const { requestId } = req.body;
        const currentUserId = actingUserId(req);

        const cancelRes = await pool.query(`
  },
  // ---- remove friend ----
  {
    find: `        const friendId = parseInt(req.params.friendId);
        const userId = parseInt(req.query.userId || req.body.userId);
        if (!userId || isNaN(userId)) {`,
    replace: `        const friendId = parseInt(req.params.friendId);
        const userId = actingUserId(req);
        if (!userId) {`
  },
  // ---- master admin middleware (both copies) ----
  {
    find: `        const rawId = req.headers['x-admin-user-id'] || req.headers['x-user-id'] || req.query.admin_user_id || req.body?.admin_user_id;
        const userId = parseInt(rawId);

        if (!userId || isNaN(userId) || userId <= 0) {`,
    replace: `        const userId = actingUserId(req);

        if (!userId) {`,
    all: true
  },
  // ---- groups list ----
  {
    find: `        const rawUserId = req.headers['x-user-id'] || req.query.userId || req.query.user_id;
        const currentUserId = parseInt(rawUserId);
        if (!currentUserId || isNaN(currentUserId)) {
            return res.json([]);
        }`,
    replace: `        const currentUserId = actingUserId(req);
        if (!currentUserId) {
            return res.status(401).json({ error: 'Authentication required.' });
        }`
  },
  // ---- create group ----
  {
    find: `        const creator = parseInt(created_by || req.body.user_id || req.headers['x-user-id'] || 1);`,
    replace: `        const creator = actingUserId(req);`
  },
  // ---- update group ----
  {
    find: `        const requesterId = parseInt(user_id || req.body?.requester_id || req.headers['x-user-id'] || req.query.userId || req.query.user_id);`,
    replace: `        const requesterId = actingUserId(req);`
  },
  // ---- delete group ----
  {
    find: `        const requesterId = parseInt(req.headers['x-user-id'] || req.query.userId || req.query.user_id || req.body?.userId || req.body?.requester_id);`,
    replace: `        const requesterId = actingUserId(req);`
  },
  // ---- lock / unlock ----
  {
    find: `        const requesterId = parseInt(req.headers['x-user-id'] || req.body?.userId || req.body?.requester_id || req.query.userId || req.query.user_id);`,
    replace: `        const requesterId = actingUserId(req);`,
    all: true
  },
  // ---- add member ----
  {
    find: `        const requesterId = parseInt(added_by || req.headers['x-user-id'] || req.body.requester_id);
        if (requesterId) {`,
    replace: `        const requesterId = actingUserId(req);
        if (requesterId) {`
  },
  // ---- update member role ----
  {
    find: `        const { role, requester_id } = req.body;
        const rawRequester = req.headers['x-user-id'] || requester_id || req.body?.user_id || req.query.requester_id || req.query.userId || req.query.user_id;
        const requesterId = parseInt(rawRequester);`,
    replace: `        const { role } = req.body;
        const requesterId = actingUserId(req);`
  },
  // ---- remove member ----
  {
    find: `        const rawRequester = req.headers['x-user-id'] || (req.body && (req.body.requester_id || req.body.user_id)) || req.query.requester_id || req.query.userId || req.query.user_id;
        const requesterId = parseInt(rawRequester);`,
    replace: `        const requesterId = actingUserId(req);`
  },
  // ---- expenses list ----
  {
    find: `        const { groupId, category, search, dateRange, status, userId, fromDate, toDate } = req.query;
        const currentUserId = parseInt(userId);
        if (!currentUserId || isNaN(currentUserId)) {
            return res.json([]);
        }`,
    replace: `        const { groupId, category, search, dateRange, status, fromDate, toDate } = req.query;
        const currentUserId = actingUserId(req);
        if (!currentUserId) {
            return res.status(401).json({ error: 'Authentication required.' });
        }`
  },
  // ---- create expense creator ----
  {
    find: `        const effectiveCreatorId = parseInt(created_by || req.body.creator_id || paid_by);`,
    replace: `        const effectiveCreatorId = actingUserId(req);`
  },
  // ---- delete expense ----
  {
    find: `        const rawRequester = req.headers['x-user-id'] || req.query.userId || req.query.user_id || req.body?.userId || req.body?.requester_id;
        const requesterId = parseInt(rawRequester);`,
    replace: `        const requesterId = actingUserId(req);`
  },
  // ---- update expense ----
  {
    find: `        const rawUpdater = req.headers['x-user-id'] || updated_by || req.body?.user_id || req.query.userId || req.query.user_id;
        const updaterId = parseInt(rawUpdater);`,
    replace: `        const updaterId = actingUserId(req);`
  },
  // ---- expense correction ----
  {
    find: `        const { requested_by, reason, new_amount, corrected_amount, new_description } = req.body;
        const requesterId = parseInt(requested_by || req.headers['x-user-id']);`,
    replace: `        const { reason, new_amount, corrected_amount, new_description } = req.body;
        const requesterId = actingUserId(req);`
  },
  // ---- settlements list ----
  {
    find: `        const currentUserId = parseInt(req.query.userId);
        if (!currentUserId || isNaN(currentUserId)) {
            return res.json([]);
        }`,
    replace: `        const currentUserId = actingUserId(req);
        if (!currentUserId) {
            return res.status(401).json({ error: 'Authentication required.' });
        }`
  },
  // ---- balances summary ----
  {
    find: `        const currentUserId = parseInt(req.query.userId);
        if (!currentUserId || isNaN(currentUserId)) {
            return res.json({
                total_owe: 0,`,
    replace: `        const currentUserId = actingUserId(req);
        if (!currentUserId) {
            return res.json({
                total_owe: 0,`
  },
  // ---- analytics ----
  {
    find: `        const currentUserId = parseInt(req.query.userId);
        if (!currentUserId || isNaN(currentUserId)) {
            return res.json({
                categories: [],`,
    replace: `        const currentUserId = actingUserId(req);
        if (!currentUserId) {
            return res.json({
                categories: [],`
  },
  // ---- chat auth helper ----
  {
    find: `    const rawId = req.headers['x-user-id'] || req.query.user_id || (req.body && req.body.user_id);
    const userId = parseInt(rawId);
    if (!userId || isNaN(userId) || userId <= 0) {`,
    replace: `    const userId = actingUserId(req);
    if (!userId) {`
  },
  // ---- chatbot query ----
  {
    find: `        const authHeader = req.headers['x-user-id'];
        const effectiveUserId = parseInt(authHeader) || parseInt(user_id);`,
    replace: `        const effectiveUserId = actingUserId(req);`
  },
  // ---- chatbot confirm ----
  {
    find: `        const { toolCall, user_id } = req.body;
        const currentUserId = parseInt(user_id || req.headers['x-user-id']);`,
    replace: `        const { toolCall } = req.body;
        const currentUserId = actingUserId(req);`
  },
  // ---- activity ----
  {
    find: `        const { userId, fromDate, toDate } = req.query;
        const rawId = userId || req.headers['x-user-id'] || req.query.user_id;
        const currentUserId = parseInt(rawId);`,
    replace: `        const { fromDate, toDate } = req.query;
        const currentUserId = actingUserId(req);`
  }
];

let failures = 0;
for (const p of patches) {
  const count = src.split(p.find).length - 1;
  if (count === 0) {
    console.error('MISS:', p.find.split('\n')[0].trim().slice(0, 90));
    failures++;
    continue;
  }
  if (!p.all && count > 1) {
    console.error('AMBIGUOUS (' + count + '):', p.find.split('\n')[0].trim().slice(0, 90));
    failures++;
    continue;
  }
  src = p.all ? src.split(p.find).join(p.replace) : src.replace(p.find, p.replace);
  console.log('OK (' + count + '):', p.find.split('\n')[0].trim().slice(0, 80));
}

if (failures > 0) {
  console.error('\nAborting: ' + failures + ' patch(es) failed. No file written.');
  process.exit(1);
}
fs.writeFileSync(file, src);
console.log('\nWritten. Delta bytes:', src.length - original.length);
