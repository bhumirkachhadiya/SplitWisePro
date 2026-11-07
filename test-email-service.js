const emailService = require('./emailService');

async function runTests() {
    console.log('====================================================');
    console.log('🧪 TESTING CENTRALIZED SPLITWISE EMAIL SERVICE');
    console.log('====================================================\n');

    let passed = 0;
    let failed = 0;

    // Test 1: Service Verification
    try {
        console.log('[Test 1] Verifying email service provider configuration...');
        const config = await emailService.verifyEmailService();
        console.log('✓ Provider Status:', config);
        passed++;
    } catch (e) {
        console.error('✗ Test 1 failed:', e.message);
        failed++;
    }

    // Test 2: Signup OTP Email Delivery
    try {
        console.log('\n[Test 2] Testing Signup OTP email delivery...');
        const res = await emailService.sendSignupOtpEmail({
            to: 'testuser@example.com',
            name: 'Priya Sharma',
            otp: '482910'
        });
        console.log('✓ Signup OTP Sent:', {
            provider: res.provider,
            messageId: res.messageId,
            previewUrl: res.previewUrl
        });
        if (res.previewUrl) console.log('  📬 Web Preview:', res.previewUrl);
        passed++;
    } catch (e) {
        console.error('✗ Test 2 failed:', e.message);
        failed++;
    }

    // Test 3: Password Reset OTP Email Delivery
    try {
        console.log('\n[Test 3] Testing Password Reset OTP email delivery...');
        const res = await emailService.sendPasswordResetOtpEmail({
            to: 'testuser@example.com',
            name: 'Priya Sharma',
            otp: '739104'
        });
        console.log('✓ Reset OTP Sent:', {
            provider: res.provider,
            messageId: res.messageId,
            previewUrl: res.previewUrl
        });
        passed++;
    } catch (e) {
        console.error('✗ Test 3 failed:', e.message);
        failed++;
    }

    // Test 4: Group Invitation Email Delivery
    try {
        console.log('\n[Test 4] Testing Group Invitation email delivery...');
        const res = await emailService.sendGroupInvitationEmail({
            to: 'inviteduser@example.com',
            recipientName: 'Rahul Verma',
            inviterName: 'Priya Sharma',
            groupName: 'Goa Trip 2026',
            role: 'editor',
            joinUrl: 'http://localhost:5000'
        });
        console.log('✓ Group Invitation Sent:', {
            provider: res.provider,
            messageId: res.messageId
        });
        passed++;
    } catch (e) {
        console.error('✗ Test 4 failed:', e.message);
        failed++;
    }

    // Test 5: Expense Added Notification Email Delivery
    try {
        console.log('\n[Test 5] Testing Expense Added notification email delivery...');
        const res = await emailService.sendExpenseAddedEmail({
            to: 'participant@example.com',
            recipientName: 'Rahul Verma',
            payerName: 'Priya Sharma',
            expenseTitle: 'Beach Shack Dinner',
            groupName: 'Goa Trip 2026',
            shareAmount: 850.00,
            totalAmount: 2550.00
        });
        console.log('✓ Expense Notification Sent:', {
            provider: res.provider,
            messageId: res.messageId
        });
        passed++;
    } catch (e) {
        console.error('✗ Test 5 failed:', e.message);
        failed++;
    }

    // Test 6: Settlement Completed Notification Email Delivery
    try {
        console.log('\n[Test 6] Testing Settlement Completed notification email delivery...');
        const res = await emailService.sendSettlementCompletedEmail({
            to: 'receiver@example.com',
            recipientName: 'Priya Sharma',
            payerName: 'Rahul Verma',
            receiverName: 'Priya Sharma',
            amount: 850.00,
            paymentMethod: 'UPI',
            transactionRef: 'UPI-984124-PAY',
            isPayer: false
        });
        console.log('✓ Settlement Notification Sent:', {
            provider: res.provider,
            messageId: res.messageId
        });
        passed++;
    } catch (e) {
        console.error('✗ Test 6 failed:', e.message);
        failed++;
    }

    // Test 7: Expense Reminder Email Delivery
    try {
        console.log('\n[Test 7] Testing Expense Reminder email delivery...');
        const res = await emailService.sendExpenseReminderEmail({
            to: 'debtor@example.com',
            debtorName: 'Rahul Verma',
            payerName: 'Priya Sharma',
            payerUpi: 'priya@okaxis',
            expenseTitle: 'Beach Shack Dinner',
            groupName: 'Goa Trip 2026',
            shareAmount: 850.00,
            customNote: 'Please settle this before Friday!'
        });
        console.log('✓ Expense Reminder Sent:', {
            provider: res.provider,
            messageId: res.messageId
        });
        passed++;
    } catch (e) {
        console.error('✗ Test 7 failed:', e.message);
        failed++;
    }

    // Test 8: Invalid Email Validation
    try {
        console.log('\n[Test 8] Testing Invalid Email validation...');
        await emailService.sendEmail({
            to: 'not-an-email',
            subject: 'Test',
            text: 'Test',
            html: '<p>Test</p>'
        });
        console.error('✗ Test 8 failed: Expected invalid email format to throw');
        failed++;
    } catch (e) {
        console.log('✓ Caught expected invalid email format error:', e.message);
        passed++;
    }

    // Test 9: Missing Recipient Validation
    try {
        console.log('\n[Test 9] Testing Missing Recipient validation...');
        await emailService.sendEmail({
            to: '',
            subject: 'Test',
            text: 'Test',
            html: '<p>Test</p>'
        });
        console.error('✗ Test 9 failed: Expected missing recipient to throw');
        failed++;
    } catch (e) {
        console.log('✓ Caught expected missing recipient error:', e.message);
        passed++;
    }

    console.log('\n====================================================');
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED out of ${passed + failed} tests`);
    console.log('====================================================');

    if (failed > 0) {
        process.exit(1);
    }
}

runTests();
