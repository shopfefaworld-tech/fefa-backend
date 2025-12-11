// Quick CORS test script
// Run with: node test-cors.js

const testCORS = async () => {
  const backendUrl = 'https://fefa-backend.vercel.app';
  const frontendOrigin = 'https://fefa-frontend.vercel.app';

  console.log('🧪 Testing CORS Configuration...\n');

  // Test 1: OPTIONS preflight request
  console.log('1️⃣ Testing OPTIONS preflight request...');
  try {
    const optionsResponse = await fetch(`${backendUrl}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        'Origin': frontendOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,Authorization'
      }
    });

    console.log('   Status:', optionsResponse.status);
    console.log('   Headers:');
    console.log('   - Access-Control-Allow-Origin:', optionsResponse.headers.get('Access-Control-Allow-Origin'));
    console.log('   - Access-Control-Allow-Methods:', optionsResponse.headers.get('Access-Control-Allow-Methods'));
    console.log('   - Access-Control-Allow-Headers:', optionsResponse.headers.get('Access-Control-Allow-Headers'));
    console.log('   - Access-Control-Allow-Credentials:', optionsResponse.headers.get('Access-Control-Allow-Credentials'));
    
    if (optionsResponse.headers.get('Access-Control-Allow-Origin') === frontendOrigin) {
      console.log('   ✅ OPTIONS request passed!\n');
    } else {
      console.log('   ❌ OPTIONS request failed - CORS headers missing or incorrect\n');
    }
  } catch (error) {
    console.log('   ❌ OPTIONS request error:', error.message, '\n');
  }

  // Test 2: GET request to health endpoint
  console.log('2️⃣ Testing GET request with CORS...');
  try {
    const getResponse = await fetch(`${backendUrl}/api/health`, {
      method: 'GET',
      headers: {
        'Origin': frontendOrigin
      }
    });

    console.log('   Status:', getResponse.status);
    console.log('   Access-Control-Allow-Origin:', getResponse.headers.get('Access-Control-Allow-Origin'));
    
    if (getResponse.headers.get('Access-Control-Allow-Origin') === frontendOrigin) {
      console.log('   ✅ GET request passed!\n');
    } else {
      console.log('   ❌ GET request failed - CORS headers missing\n');
    }
  } catch (error) {
    console.log('   ❌ GET request error:', error.message, '\n');
  }

  // Test 3: POST request (simulated login)
  console.log('3️⃣ Testing POST request with CORS...');
  try {
    const postResponse = await fetch(`${backendUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Origin': frontendOrigin,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'test@test.com',
        password: 'test'
      })
    });

    console.log('   Status:', postResponse.status);
    console.log('   Access-Control-Allow-Origin:', postResponse.headers.get('Access-Control-Allow-Origin'));
    
    // Even if login fails, CORS headers should be present
    if (postResponse.headers.get('Access-Control-Allow-Origin')) {
      console.log('   ✅ POST request CORS headers present!\n');
    } else {
      console.log('   ❌ POST request failed - CORS headers missing\n');
    }
  } catch (error) {
    console.log('   ❌ POST request error:', error.message, '\n');
  }

  console.log('✨ CORS test complete!');
};

testCORS();

