const fs = require('fs');
const ids = JSON.parse(fs.readFileSync('scripts/referenced_element_ids.json', 'utf8'));

console.log('Total referenced IDs:', ids.length);
const groups = {
  auth: [],
  sidebar_nav: [],
  header: [],
  dashboard: [],
  expenses: [],
  add_expense: [],
  groups_view: [],
  friends: [],
  settle: [],
  analytics: [],
  activity: [],
  chat: [],
  chatbot: [],
  modals: [],
  other: []
};

ids.forEach(id => {
  const l = id.toLowerCase();
  if (l.includes('auth') || l.includes('signup') || l.includes('login') || l.includes('otp')) groups.auth.push(id);
  else if (l.includes('sidebar') || l.includes('nav')) groups.sidebar_nav.push(id);
  else if (l.includes('header') || l.includes('globalsearch') || l.includes('themetoggle')) groups.header.push(id);
  else if (l.includes('dash')) groups.dashboard.push(id);
  else if (l.includes('addexpense') || l.includes('split') || l.includes('expenseamount') || l.includes('expensegroup') || l.includes('expensedesc')) groups.add_expense.push(id);
  else if (l.includes('expense')) groups.expenses.push(id);
  else if (l.includes('group')) groups.groups_view.push(id);
  else if (l.includes('friend')) groups.friends.push(id);
  else if (l.includes('settle') || l.includes('debt') || l.includes('upi')) groups.settle.push(id);
  else if (l.includes('analytic') || l.includes('chart')) groups.analytics.push(id);
  else if (l.includes('activity')) groups.activity.push(id);
  else if (l.includes('chatbot') || l.includes('voice')) groups.chatbot.push(id);
  else if (l.includes('chat')) groups.chat.push(id);
  else if (l.includes('modal') || l.includes('drawer') || l.includes('forgot')) groups.modals.push(id);
  else groups.other.push(id);
});

for (const [k, v] of Object.entries(groups)) {
  console.log(`\n=== ${k.toUpperCase()} (${v.length}) ===`);
  console.log(v.join(', '));
}
