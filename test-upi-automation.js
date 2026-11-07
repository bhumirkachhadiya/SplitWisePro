const crypto = require('crypto');

const BASE_URL = 'http://localhost:5000/api';
const UPI_WEBHOOK_SECRET = process.env.UPI_WEBHOOK_SECRET || 'splitease_upi_webhook_secret_key_2025';

async function testUpiAutomation() {
    console.log('====================================================');
    console.log('   AUTOMATED UPI SETTLEMENT & WEBHOOK TEST SUITE    ');
    console.log('====================================================');

    // 1. Create UPI Payment Request
    console.log('\n--- 1. Create UPI Payment Request ---');
    let res = await fetch(`${BASE_URL}/upi/create-payment-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            payer_id: 1, // Alex
            receiver_id: 2, // Rahul
            amount: 500.00,
            notes: 'Goa Trip Settlement'
        })
    });
    let data = await res.json();
    if (res.status !== 201 || !data.success || !data.payment_request || data.payment_request.status !== 'PENDING') {
        console.error('❌ FAILED: Create UPI payment request', res.status, data);
        process.exit(1);
    }
    const req1 = data.payment_request;
    console.log(`✅ PASSED: Created Payment Request: ${req1.request_id}`);
    console.log(`  Amount: ₹${req1.amount}, Status: ${req1.status}, UPI String: ${req1.upi_string}`);

    // 2. Poll Initial Status: PENDING
    console.log('\n--- 2. Poll Status Before Payment (Expect PENDING) ---');
    res = await fetch(`${BASE_URL}/upi/payment-status/${req1.request_id}`);
    data = await res.json();
    if (res.status !== 200 || data.status !== 'PENDING' || data.settlement_id) {
        console.error('❌ FAILED: Initial status is not PENDING', res.status, data);
        process.exit(1);
    }
    console.log(`✅ PASSED: Live status verified: ${data.status} (No settlement created yet)`);

    // 3. Webhook Security: Invalid Signature Rejection (401)
    console.log('\n--- 3. Webhook Security: Tampered / Invalid Signature Guard ---');
    const fakePayload = {
        request_id: req1.request_id,
        status: 'SUCCESS',
        amount: 500.00,
        currency: 'INR'
    };
    res = await fetch(`${BASE_URL}/upi/webhook`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-webhook-signature': '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' // forged signature
        },
        body: JSON.stringify(fakePayload)
    });
    if (res.status === 401) {
        console.log('✅ PASSED: Webhook strictly rejected forged signature with HTTP 401 Unauthorized!');
    } else {
        console.error('❌ FAILED: Webhook did not reject forged signature', res.status);
        process.exit(1);
    }

    // 4. Edge Case: Non-Success Status (FAILED / CANCELLED) -> No Settlement Created!
    console.log('\n--- 4. Edge Case: Cancelled / Failed Payment Status ---');
    // Create new request to cancel
    res = await fetch(`${BASE_URL}/upi/create-payment-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payer_id: 1, receiver_id: 2, amount: 150.00 })
    });
    const cancelReq = (await res.json()).payment_request;

    // Send CANCELLED webhook with valid signature
    const cancelBody = JSON.stringify({
        request_id: cancelReq.request_id,
        status: 'CANCELLED',
        amount: 150.00,
        currency: 'INR',
        transaction_ref: 'USER-DROPPED-PAYMENT'
    });
    const cancelSig = crypto.createHmac('sha256', UPI_WEBHOOK_SECRET).update(cancelBody).digest('hex');

    res = await fetch(`${BASE_URL}/upi/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-signature': cancelSig },
        body: cancelBody
    });
    data = await res.json();
    if (res.status === 200 && data.status === 'CANCELLED') {
        console.log(`✅ PASSED: Cancelled payment handled gracefully. Status: ${data.status}`);
    } else {
        console.error('❌ FAILED: Webhook cancelled handling', res.status, data);
        process.exit(1);
    }

    // Check DB status: must remain un-settled
    res = await fetch(`${BASE_URL}/upi/payment-status/${cancelReq.request_id}`);
    data = await res.json();
    if (data.status === 'CANCELLED' && !data.settlement_id) {
        console.log('✅ PASSED: Zero settlement record created for CANCELLED status in database!');
    } else {
        console.error('❌ FAILED: Settlement was created for cancelled payment!', data);
        process.exit(1);
    }

    // 5. Edge Case: Amount Mismatch (Tampering / Partial Payment) -> Rejected!
    console.log('\n--- 5. Edge Case: Partial Payment / Amount Mismatch ---');
    const mismatchBody = JSON.stringify({
        request_id: req1.request_id,
        status: 'SUCCESS',
        amount: 100.00, // expected 500!
        currency: 'INR'
    });
    const mismatchSig = crypto.createHmac('sha256', UPI_WEBHOOK_SECRET).update(mismatchBody).digest('hex');
    res = await fetch(`${BASE_URL}/upi/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-signature': mismatchSig },
        body: mismatchBody
    });
    if (res.status === 400) {
        console.log('✅ PASSED: Amount mismatch rejected with HTTP 400 (Cannot settle 500 debt with 100 payment)!');
    } else {
        console.error('❌ FAILED: Amount mismatch not blocked', res.status);
        process.exit(1);
    }

    // 6. Verified Payment Success Webhook -> Automatic Settlement Creation
    console.log('\n--- 6. Verified Payment Success Webhook -> Automatic Settlement ---');
    const validUtr = `UTR-${Date.now()}-NPCI9928`;
    const successBody = JSON.stringify({
        request_id: req1.request_id,
        status: 'SUCCESS',
        amount: 500.00,
        currency: 'INR',
        transaction_ref: `REF-${validUtr}`,
        utr: validUtr
    });
    const successSig = crypto.createHmac('sha256', UPI_WEBHOOK_SECRET).update(successBody).digest('hex');

    res = await fetch(`${BASE_URL}/upi/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-signature': successSig },
        body: successBody
    });
    data = await res.json();
    if (res.status === 200 && data.success && data.settlement_id && data.status === 'SUCCESS') {
        console.log(`✅ PASSED: Webhook automatically verified and settled payment!`);
        console.log(`  Settlement ID: ${data.settlement_id}, UTR: ${data.utr}, Amount: ₹${data.amount}`);
    } else {
        console.error('❌ FAILED: Webhook settlement', res.status, data);
        process.exit(1);
    }
    const initialSettlementId = data.settlement_id;

    // 7. Polling Verification: Frontend Poller sees SUCCESS automatically
    console.log('\n--- 7. Poller Verification: Frontend Status Transformed to SUCCESS ---');
    res = await fetch(`${BASE_URL}/upi/payment-status/${req1.request_id}`);
    data = await res.json();
    if (res.status === 200 && data.status === 'SUCCESS' && data.settlement_id === initialSettlementId && data.utr === validUtr) {
        console.log(`✅ PASSED: Poller endpoint verified status is SUCCESS with confirmed settlement!`);
        console.log(`  Settled at: ${data.settled_at}, Receiver: ${data.receiver_name}`);
    } else {
        console.error('❌ FAILED: Poller status check', res.status, data);
        process.exit(1);
    }

    // 8. Idempotency Check: Duplicate Webhook Call MUST NEVER Create Duplicate Settlement
    console.log('\n--- 8. Idempotency Guard: Duplicate Webhook Delivery ---');
    res = await fetch(`${BASE_URL}/upi/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-signature': successSig },
        body: successBody
    });
    data = await res.json();
    if (res.status === 200 && data.settlement_id === initialSettlementId && data.is_duplicate) {
        console.log(`✅ PASSED: Duplicate webhook acknowledged without duplicate database entry (Settlement ID: ${data.settlement_id})!`);
    } else {
        console.error('❌ FAILED: Idempotency failed', res.status, data);
        process.exit(1);
    }

    // 9. Server-to-Server Verification Test (POST /api/upi/verify-payment)
    console.log('\n--- 9. Server-to-Server Direct Verification Test ---');
    // Create new request
    res = await fetch(`${BASE_URL}/upi/create-payment-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payer_id: 1, receiver_id: 3, amount: 300.00 })
    });
    const s2sReq = (await res.json()).payment_request;

    res = await fetch(`${BASE_URL}/upi/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            request_id: s2sReq.request_id,
            transaction_ref: `S2S-REF-${Date.now()}`,
            utr: `S2S-UTR-${Date.now()}`
        })
    });
    data = await res.json();
    if (res.status === 200 && data.success && data.settlement_id) {
        console.log(`✅ PASSED: Server-to-server verification completed settlement automatically! Settlement ID: ${data.settlement_id}`);
    } else {
        console.error('❌ FAILED: S2S verification', res.status, data);
        process.exit(1);
    }

    console.log('\n====================================================');
    console.log('   🎉 ALL AUTOMATED UPI SETTLEMENT TESTS PASSED!    ');
    console.log('====================================================\n');
}

testUpiAutomation().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
});
