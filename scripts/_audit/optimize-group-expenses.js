const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');
const startMarker = '        const expenses = await Promise.all(expensesRes.rows.map(async (exp) => {';
const endMarker = '        const totalSpend = roundMoney(expenses.reduce((acc, e) => acc + e.base_amount, 0));';
const start = c.indexOf(startMarker);
const end = c.indexOf(endMarker);
if (start === -1 || end === -1) { console.error('markers missing', start, end); process.exit(1); }

const replacement = `        const expIds = expensesRes.rows.map(e => e.id);
        const splitsByExpense = new Map();
        if (expIds.length > 0) {
            const allSplits = await pool.query(\`
                SELECT es.*, u.name as user_name, u.name as name, u.email as user_email, u.avatar_initials, u.upi_id
                FROM expense_splits es
                JOIN users u ON es.user_id = u.id
                WHERE es.expense_id = ANY($1::int[])
                ORDER BY u.name ASC
            \`, [expIds]);
            allSplits.rows.forEach(row => {
                if (!splitsByExpense.has(row.expense_id)) splitsByExpense.set(row.expense_id, []);
                splitsByExpense.get(row.expense_id).push(row);
            });
        }

        const expenses = expensesRes.rows.map(exp => {
            const splits = (splitsByExpense.get(exp.id) || []).map(s => {
                const isPayer = parseInt(s.user_id) === parseInt(exp.paid_by);
                const amount = parseFloat(s.amount || 0);
                const settled = roundMoney(s.settled_amount || 0) + (isPayer ? amount : 0);
                const outstanding = isPayer ? 0 : Math.max(0, roundMoney(amount - roundMoney(s.settled_amount || 0)));
                const status = outstanding <= 0.005 ? 'PAID' : (settled > 0.005 ? 'PARTIALLY_PAID' : 'PENDING');
                return {
                    ...s,
                    name: s.name || s.user_name || 'Member',
                    user_name: s.user_name || s.name || 'Member',
                    amount,
                    paid_amount: roundMoney(settled),
                    outstanding_amount: outstanding,
                    is_locked: s.is_locked === true,
                    is_settled: outstanding <= 0.005,
                    payment_status: status,
                    status
                };
            });

            const paidAmount = splits.reduce((acc, s) => acc + s.paid_amount, 0);
            const baseTotal = roundMoney(exp.converted_amount || exp.amount);
            const basePending = splits.reduce((acc, s) => {
                const isPayer = parseInt(s.user_id) === parseInt(exp.paid_by);
                if (isPayer) return acc;
                return acc + Math.max(0, roundMoney(parseFloat(s.base_amount || 0) - parseFloat(s.settled_amount_base || 0)));
            }, 0);

            return {
                ...exp,
                title: exp.description || exp.title || 'Expense',
                payer_name: exp.paid_by_name || 'User',
                paid_by_name: exp.paid_by_name || 'User',
                amount: parseFloat(exp.amount || 0),
                base_amount: baseTotal,
                paid_amount: roundMoney(paidAmount),
                pending_amount: roundMoney(basePending),
                splits,
                is_fully_settled: basePending <= 0.01
            };
        });

`;
c = c.slice(0, start) + replacement + c.slice(end);
fs.writeFileSync('server.js', c);
console.log('batch-optimised group expenses');
