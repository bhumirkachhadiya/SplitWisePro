const http = require('http');

function post(path, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = http.request({
            hostname: 'localhost',
            port: 5000,
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch(e) {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

function get(path) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: 'localhost',
            port: 5000,
            path,
            method: 'GET'
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch(e) {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runTest() {
    console.log('=== STARTING UPI ₹1 AUTOMATION & SETTLEMENT TEST ===');
    
    // Step 1: Create ₹1 Payment Request #1
    console.log('1. Creating ₹1 UPI payment request (payer: 1, receiver: 2)...');
    const req1 = await post('/api/upi/create-payment-request', {
        payer_id: 1,
        receiver_id: 2,
        amount: 1,
        notes: 'Pre-deployment verification ₹1 payment'
    });
    
    console.log('Response status:', req1.status);
    console.log('Response body:', req1.body);
    
    if (req1.status !== 200 && req1.status !== 201) {
        throw new Error('Failed to create payment request: ' + JSON.stringify(req1.body));
    }
    
    const reqId1 = req1.body.request_id || req1.body.payment_request?.request_id;
    console.log('✓ Created payment request ID:', reqId1);
    
    // Step 2: Immediate Poll (< 2.5s)
    console.log('\n2. Polling status immediately...');
    const poll1 = await get(`/api/upi/payment-status/${reqId1}`);
    console.log('Immediate poll response:', poll1.body.status, poll1.body.message);
    
    // Step 3: Wait 3 seconds for auto-settlement window
    console.log('\n3. Waiting 3.2 seconds for provider simulation window...');
    await sleep(3200);
    
    // Step 4: Poll after window
    console.log('4. Polling status after 3.2s...');
    const poll2 = await get(`/api/upi/payment-status/${reqId1}`);
    console.log('Poll after 3.2s status:', poll2.body.status);
    console.log('Settlement ID:', poll2.body.settlement_id);
    console.log('Transaction Ref:', poll2.body.transaction_ref);
    
    if (poll2.body.status !== 'SUCCESS' || !poll2.body.settlement_id) {
        throw new Error('Payment was not automatically settled: ' + JSON.stringify(poll2.body));
    }
    console.log('✓ First ₹1 payment successfully auto-settled in DB!');
    
    // Step 5: Test subsequent payment (Issue 3: "UPI stops working after first settlement")
    console.log('\n5. Testing SECOND ₹1 UPI payment (verifying UPI works repeatedly)...');
    const req2 = await post('/api/upi/create-payment-request', {
        payer_id: 2,
        receiver_id: 1,
        amount: 1,
        notes: 'Pre-deployment verification second ₹1 payment'
    });
    
    const reqId2 = req2.body.request_id || req2.body.payment_request?.request_id;
    console.log('✓ Created second payment request ID:', reqId2);
    
    await sleep(3200);
    const poll3 = await get(`/api/upi/payment-status/${reqId2}`);
    console.log('Second payment poll status:', poll3.body.status);
    console.log('Second Settlement ID:', poll3.body.settlement_id);
    
    if (poll3.body.status !== 'SUCCESS' || !poll3.body.settlement_id) {
        throw new Error('Second payment failed: ' + JSON.stringify(poll3.body));
    }
    console.log('✓ Second ₹1 payment successfully auto-settled in DB!');
    
    console.log('\n=== ALL UPI ₹1 AUTO-SETTLEMENT TESTS PASSED! ===');
    process.exit(0);
}

runTest().catch(err => {
    console.error('TEST FAILED:', err);
    process.exit(1);
});
