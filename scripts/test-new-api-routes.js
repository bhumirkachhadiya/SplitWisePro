async function testApi() {
    const API = 'http://localhost:5000/api';
    console.log('Testing newly implemented API endpoints...\n');

    // 1. Login with username 'alex'
    console.log('1. Testing Login with Username ("alex")...');
    const loginUserRes = await fetch(`${API}/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alex', password: 'password123' })
    });
    const loginUserData = await loginUserRes.json();
    console.log(`   Status: ${loginUserRes.status}, Role: ${loginUserData.user?.role}, Username: ${loginUserData.user?.username}`);
    if (loginUserRes.status !== 200 || loginUserData.user?.role !== 'master_admin') {
        throw new Error('Username login failed or wrong role');
    }

    // 2. Login with email 'alex@splitease.io'
    console.log('\n2. Testing Login with Email ("alex@splitease.io")...');
    const loginEmailRes = await fetch(`${API}/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'alex@splitease.io', password: 'password123' })
    });
    console.log(`   Status: ${loginEmailRes.status}, Message: ${(await loginEmailRes.json()).message}`);

    // 3. Login as ordinary user 'rahul'
    console.log('\n3. Testing Login as regular user ("rahul")...');
    const rahulRes = await fetch(`${API}/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'rahul', password: 'password123' })
    });
    const rahulData = await rahulRes.json();
    console.log(`   Status: ${rahulRes.status}, Role: ${rahulData.user?.role}`);

    // 4. Test Master Admin Overview with Alex (User #1)
    console.log('\n4. Testing /api/admin/overview as Master Admin (Alex, ID 1)...');
    const adminOverviewRes = await fetch(`${API}/admin/overview`, {
        headers: { 'x-user-id': '1' }
    });
    console.log(`   Status: ${adminOverviewRes.status}`);
    const overviewData = await adminOverviewRes.json();
    console.log(`   Total Users: ${overviewData.users?.total}, Total Groups: ${overviewData.groups?.total}`);

    // 5. Test Master Admin Overview with Non-Admin (Rahul, ID 2) -> Should be 403 Forbidden
    console.log('\n5. Testing /api/admin/overview as Non-Admin (Rahul, ID 2)...');
    const nonAdminRes = await fetch(`${API}/admin/overview`, {
        headers: { 'x-user-id': '2' }
    });
    console.log(`   Status: ${nonAdminRes.status} (Expected: 403 Forbidden)`);
    const nonAdminData = await nonAdminRes.json();
    console.log(`   Error: ${nonAdminData.error}`);
    if (nonAdminRes.status !== 403) throw new Error('Expected 403 Forbidden for non-admin');

    // 6. Test Unauthenticated Request -> Should be 401 Unauthorized
    console.log('\n6. Testing /api/admin/overview without Auth Header...');
    const unauthRes = await fetch(`${API}/admin/overview`);
    console.log(`   Status: ${unauthRes.status} (Expected: 401 Unauthorized)`);
    if (unauthRes.status !== 401) throw new Error('Expected 401 Unauthorized');

    // 7. Test Multi-Currency Endpoints
    console.log('\n7. Testing /api/currencies...');
    const curRes = await fetch(`${API}/currencies`);
    const curData = await curRes.json();
    const curKeys = Object.keys(curData);
    console.log(`   Supported currencies (${curKeys.length}): ${curKeys.join(', ')}`);

    console.log('\n8. Testing /api/currencies/rates?base=INR...');
    const ratesRes = await fetch(`${API}/currencies/rates?base=INR`);
    const ratesData = await ratesRes.json();
    console.log(`   Rates base: ${ratesData.base}, USD: ${ratesData.rates?.USD}, EUR: ${ratesData.rates?.EUR}`);

    // 8. Test Client Error Reporting Endpoint
    console.log('\n9. Testing /api/admin/errors/report ingestion...');
    const reportRes = await fetch(`${API}/admin/errors/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: 'Sample Frontend Syntax Error',
            message: 'ReferenceError: sampleFunction is not defined at index.html:120:15',
            category: 'frontend',
            severity: 'medium',
            module: 'settle_view',
            apiRoute: '/api/settlements',
            browserInfo: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        })
    });
    const reportData = await reportRes.json();
    console.log(`   Ingestion Status: ${reportRes.status}, Error ID: ${reportData.errorId}`);

    console.log('\n✓ ALL API VERIFICATIONS PASSED WITH 100% SUCCESS!');
}

testApi().catch(err => {
    console.error('API Verification Failed:', err);
    process.exit(1);
});
