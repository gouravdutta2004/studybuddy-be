const http = require('http');

const request = (method, path, body = null, token = null) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5001,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data || '{}') }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
};

const run = async () => {
  try {
    console.log('[1/5] Testing Auth Login (admin@test.com)...');
    const auth = await request('POST', '/api/auth/login', {email:'admin@test.com', password:'123456'});
    if(auth.status !== 200) throw new Error('Login Failed: ' + JSON.stringify(auth));
    const token = auth.data.token;
    console.log('Login OK. Token retrieved.');

    console.log('[2/5] Testing GET /api/auth/me...');
    const me = await request('GET', '/api/auth/me', null, token);
    if(me.status !== 200) throw new Error('/me Failed: ' + JSON.stringify(me));
    console.log('/me OK.');

    console.log('[3/5] Testing Admin Endpoint /api/admin/users...');
    const admin = await request('GET', '/api/admin/users', null, token);
    if(admin.status !== 200) throw new Error('Admin Users Failed: ' + JSON.stringify(admin));
    console.log('Admin Users OK. Count:', admin.data.length);

    console.log('[4/5] Testing Matches Endpoint /api/users/matches...');
    const matches = await request('GET', '/api/users/matches', null, token);
    if(matches.status !== 200) throw new Error('Matches Failed: ' + JSON.stringify(matches));
    console.log('Matches OK.');

    console.log('[5/5] Testing Connections Endpoint /api/users/connections...');
    const conns = await request('GET', '/api/users/connections', null, token);
    if(conns.status !== 200) throw new Error('Connections Failed: ' + JSON.stringify(conns));
    console.log('Connections OK.');

    console.log('\n✅ ALL SYSTEMS FULLY OPERATIONAL AND BRIDGED SUCCESSFULLY.');
  } catch (err) {
    console.error('❌ INTEGRATION TEST FAILED:', err.message);
  }
};
run();
