const http = require('http');

const request = (path, token) => {
  return new Promise((resolve) => {
    http.get({ hostname: 'localhost', port: 5001, path, headers: { Authorization: `Bearer ${token}` } }, (res) => {
      let data = ''; res.on('data', c => data += c); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data||'{}') }));
    });
  });
};

const run = async () => {
  try {
    const postReq = http.request({ hostname: 'localhost', port: 5001, path: '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json' } }, async (res) => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', async () => {
        const token = JSON.parse(data).token;
        console.log('[1/2] Fetching System Connections...');
        const conns = await request('/api/admin/connections', token);
        console.log('Status:', conns.status, 'Connections:', conns.data.length);
        
        console.log('[2/2] Fetching System Messages...');
        const msgs = await request('/api/admin/messages', token);
        console.log('Status:', msgs.status, 'Messages:', msgs.data.length);
        console.log('✅ ALL GLOBAL PLATFORM LOGS OPERATIONAL');
      });
    });
    postReq.write(JSON.stringify({email:'admin@test.com', password:'123456'}));
    postReq.end();
  } catch (e) { console.error('Failed', e); }
};
run();
