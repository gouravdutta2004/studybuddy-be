const axios = require('axios');

async function testProfile() {
  try {
    // 1. login first
    console.log("Logging in...");
    const loginRes = await axios.post('http://localhost:5001/api/auth/login', {
      email: 'testuser1@example.com',
      password: 'password123'
    });
    const token = loginRes.data.token;
    console.log("Token:", token.substring(0, 10) + "...");

    // 2. update profile
    console.log("Updating profile...");
    const updateRes = await axios.put('http://localhost:5001/api/users/profile', {
      location: 'New York',
      university: 'NYU',
      bio: 'Hello world',
      subjects: ['Math']
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log("Update Response:", updateRes.data);

    // 3. fetch profile to verify
    console.log("Fetching profile...");
    const meRes = await axios.get('http://localhost:5001/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log("Me Response:", meRes.data);
  } catch(e) {
    console.error("Error:", e.response ? e.response.data : e.message);
  }
}

testProfile();
