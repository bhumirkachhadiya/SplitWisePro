const fs = require('fs');
const content = fs.readFileSync('index.html.backup', 'utf8');

const modals = [
  'profileModal',
  'newGroupModal',
  'debtMatrixModal',
  'deleteExpenseModal',
  'expenseReminderModal',
  'forgotPasswordModal',
  'editGroupModal',
  'deleteGroupModal',
  'manageMembersModal',
  'editExpenseModal',
  'expenseCorrectionModal',
  'currencySettingsModal',
  'emailTemplateSettingsModal'
];

modals.forEach(m => {
  const start = content.indexOf(`id="${m}"`);
  if (start !== -1) {
    const end = content.indexOf('</div>\n\n', start);
    console.log(`Modal ${m} found at index ${start}`);
  } else {
    console.log(`Modal ${m} NOT found with exact id`);
  }
});
