const http = require('http');

function post(path, body) {
    return new Promise((resolve) => {
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
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch(e) { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.write(payload);
        req.end();
    });
}

function get(path) {
    return new Promise((resolve) => {
        const req = http.request({
            hostname: 'localhost',
            port: 5000,
            path,
            method: 'GET'
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch(e) { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.end();
    });
}

async function inspect() {
    const cur = await get('/api/currencies');
    console.log('1. /api/currencies:', JSON.stringify(cur, null, 2));

    const conv = await post('/api/currencies/convert', { amount: 100, from: 'USD', to: 'INR' });
    console.log('\n2. /api/currencies/convert:', JSON.stringify(conv, null, 2));

    const err = await post('/api/admin/errors/report', {
        title: 'Inspection Error',
        message: 'Inspection Error Message',
        category: 'backend'
    });
    console.log('\n3. /api/admin/errors/report:', JSON.stringify(err, null, 2));

    const friends = await get('/api/friends?userId=1');
    console.log('\n4. /api/friends?userId=1:', JSON.stringify(friends, null, 2));

    const badLogin = await post('/api/users/login', { username: 'alex', password: 'wrong' });
    console.log('\n5. Bad login:', JSON.stringify(badLogin, null, 2));

    process.exit(0);
}

inspect();
