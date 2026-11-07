const http = require('http');

function request(method, pathUrl, headers = {}, body = null) {
    return new Promise((resolve) => {
        const payload = body ? JSON.stringify(body) : null;
        const reqHeaders = { ...headers };
        if (payload) {
            reqHeaders['Content-Type'] = 'application/json';
            reqHeaders['Content-Length'] = Buffer.byteLength(payload);
        }

        const req = http.request({
            hostname: 'localhost',
            port: 5000,
            path: pathUrl,
            method,
            headers: reqHeaders
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch(e) { resolve({ status: res.statusCode, body: data }); }
            });
        });
        if (payload) req.write(payload);
        req.end();
    });
}

async function debug() {
    const adminHeaders = { 'x-user-id': '1' };

    // 1. Ingest an error
    const report = await request('POST', '/api/admin/errors/report', {}, {
        title: 'Debug Error',
        message: 'Debug message',
        category: 'backend'
    });
    console.log('Reported:', report);
    const id = report.body.errorId;

    // 2. Fetch Prompt
    const prompt = await request('GET', `/api/admin/errors/${id}/antigravity-prompt`, adminHeaders);
    console.log('\nPrompt response:', JSON.stringify(prompt, null, 2));

    // 3. Resolve
    const resolve = await request('POST', `/api/admin/errors/${id}/resolve`, adminHeaders, {
        status: 'RESOLVED',
        resolution_notes: 'Tested resolution'
    });
    console.log('\nResolve response:', JSON.stringify(resolve, null, 2));

    process.exit(0);
}

debug();
