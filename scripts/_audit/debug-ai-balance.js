const BASE = 'http://127.0.0.1:5000';
(async () => {
  const l = await fetch(BASE + '/api/users/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'alex', password: 'password123' }) }).then(r => r.json());
  const t = l.session_token;
  const qs = [
    'Hello',
    'Show my balance',
    'What is my balance?',
    'How much do I owe?',
    'How much am I owed?',
    'Show my total balance',
    'मेरा बैलेंस बताओ',
    'મારું બૅલેન્સ કેટલું છે?'
  ];
  for (let i = 0; i < qs.length; i++) {
    const r = await fetch(BASE + '/api/chatbot/query', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
      body: JSON.stringify({ query: qs[i], conversation_id: 'dbg-bal-' + Date.now() + '-' + i })
    }).then(r => r.json());
    console.log('\nQ: ' + qs[i] + '\nA: ' + String(r.reply).replace(/\n/g, ' | ').slice(0, 260));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
