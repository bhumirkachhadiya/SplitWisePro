const http = require('http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  console.log('Testing Chatbot Endpoint...');
  
  // 1. English Trip Query
  const r1 = await post('/api/chatbot/query', { query: 'Which expense was for Goa trip?', language: 'en', user_id: 1 });
  console.log('Q1 (Goa Trip):', r1.data.reply);
  console.log('Q1 Action:', r1.data.action, r1.data.group_name);

  // 2. Hindi Balance Query
  const r2 = await post('/api/chatbot/query', { query: 'राहुल को कितना देना है?', language: 'hi', user_id: 1 });
  console.log('\nQ2 (Hindi Rahul):', r2.data.reply);
  console.log('Q2 Action:', r2.data.action, r2.data.peer_name);

  // 3. Gujarati Settle Redirection Query
  const r3 = await post('/api/chatbot/query', { query: 'મને ચૂકવણી પેજ પર લઈ જાઓ (Settle up)', language: 'gu', user_id: 1 });
  console.log('\nQ3 (Gujarati Settle):', r3.data.reply);
  console.log('Q3 Action:', r3.data.action, r3.data.view);

  // 4. Specific Expense Search
  const r4 = await post('/api/chatbot/query', { query: 'Tell me about the Villa stay', language: 'en', user_id: 1 });
  console.log('\nQ4 (Villa stay):', r4.data.reply);
  console.log('Q4 Action:', r4.data.action, r4.data.search_term);

  // 5. Test Reminder Email
  console.log('\nTesting Expense Reminder Email...');
  const r5 = await post('/api/reminders/send', {
    expense_id: 1, // Villa Stay
    debtor_id: 2, // Rahul
    payer_id: 1, // Alex
    client_url: 'http://localhost:5000'
  });
  console.log('Reminder Email Status:', r5.status);
  console.log('Reminder Result:', r5.data.message);
  console.log('Redirection URL in Email:', r5.data.redirection_url);
}

run().catch(console.error);
