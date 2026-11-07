const adminService = require('../adminService');

async function testAdmin() {
    try {
        console.log('Testing getPlatformOverview...');
        const overview = await adminService.getPlatformOverview();
        console.log('Overview:', JSON.stringify(overview, null, 2));

        console.log('\nTesting listUsers...');
        const users = await adminService.listUsers({ page: 1, limit: 5 });
        console.log(`Total users: ${users.total}, Returned: ${users.users.length}`);
        console.table(users.users.map(u => ({ id: u.id, name: u.name, email: u.email, username: u.username, role: u.role, is_active: u.is_active })));

        console.log('\nTesting recordSystemError...');
        const errResult = await adminService.recordSystemError({
            title: 'Test Baseline Error Event',
            message: 'Testing system error tracker recording and fingerprint generation',
            category: 'backend_api',
            severity: 'low',
            module: 'adminService',
            apiRoute: '/api/admin/overview',
            httpStatus: 200,
            stackTrace: 'Error: Test Error\n    at testAdmin (test-admin-service.js:15:10)'
        });
        console.log('Error recorded:', errResult);

        console.log('\nTesting listSystemErrors...');
        const errorList = await adminService.listSystemErrors({});
        console.log('Error stats:', errorList.stats);
        console.log(`Error count: ${errorList.total}`);

        console.log('\nTesting generateAntigravityFixPrompt...');
        const promptRes = await adminService.generateAntigravityFixPrompt(errResult.errorId);
        console.log('Generated prompt preview (first 200 chars):\n', promptRes.prompt.substring(0, 200));

        console.log('\n✓ adminService verification completed successfully!');
        process.exit(0);
    } catch (e) {
        console.error('Test failed:', e);
        process.exit(1);
    }
}

testAdmin();
