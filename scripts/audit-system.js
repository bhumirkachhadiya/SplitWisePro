const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

const modalsToCheck = [
    'editGroupModal',
    'editExpenseModal',
    'expenseCorrectionModal',
    'forgotPasswordModal',
    'expenseReminderModal'
];

modalsToCheck.forEach(mId => {
    console.log(`\n=================== MODAL: #${mId} ===================`);
    const idx = html.indexOf(`id="${mId}"`);
    if (idx !== -1) {
        // extract ~1500 chars of the modal markup
        const markup = html.substring(idx, idx + 1500);
        console.log(markup.substring(0, 700));
        // find all buttons and forms inside it
        const formMatches = markup.match(/<form[^>]*>/gi);
        const btnMatches = markup.match(/<button[^>]*onclick=["'][^"']+["'][^>]*>/gi);
        console.log('Forms:', formMatches);
        console.log('Action Buttons:', btnMatches);
    } else {
        console.log('NOT FOUND');
    }
});
