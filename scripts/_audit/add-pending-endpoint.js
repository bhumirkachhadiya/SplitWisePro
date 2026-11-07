const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');
const anchor = "// 2.1 Confirm a UPI bank UTR reference (receiver-side confirmation)";
if (!c.includes(anchor)) { console.error('anchor missing'); process.exit(1); }
const block = `// 2.0 List payment requests that need attention (payer or receiver)
app.get('/api/upi/pending-requests', async (req, res) => {
    try {
        const authId = actingUserId(req);
        const result = await pool.query(\`
            SELECT upr.request_id, upr.payer_id, upr.receiver_id, upr.group_id, upr.amount,
                   upr.currency, upr.status, upr.notes, upr.claimed_at, upr.claimed_utr,
                   upr.created_at, p.name AS payer_name, r.name AS receiver_name,
                   g.name AS group_name
            FROM upi_payment_requests upr
            JOIN users p ON p.id = upr.payer_id
            JOIN users r ON r.id = upr.receiver_id
            LEFT JOIN groups g ON g.id = upr.group_id
            WHERE upr.status = 'PENDING'
              AND (upr.payer_id = $1 OR upr.receiver_id = $1)
            ORDER BY upr.created_at DESC
            LIMIT 50
        \`, [authId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: formatUserError(err, 'Unable to load pending payments.') });
    }
});

`;
c = c.replace(anchor, block + anchor);
fs.writeFileSync('server.js', c);
console.log('added pending-requests endpoint');
