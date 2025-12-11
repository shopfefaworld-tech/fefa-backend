// API Testing Script for Fefa Backend (Node.js version)
// Usage: node test-api.js [base-url] [auth-token]

const https = require('https');
const http = require('http');

const BASE_URL = process.argv[2] || 'https://fefa-backend.vercel.app';
const AUTH_TOKEN = process.argv[3] || '';

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m'
};

function makeRequest(method, path, requiresAuth = false) {
  return new Promise((resolve) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (requiresAuth && AUTH_TOKEN) {
      options.headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
    }

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      resolve(res.statusCode);
    });

    req.on('error', () => resolve(0));
    req.end();
  });
}

async function testEndpoint(method, path, description, requiresAuth) {
  process.stdout.write(`Testing ${method} ${path} ... `);
  
  if (requiresAuth && !AUTH_TOKEN) {
    console.log(`${colors.yellow}SKIPPED (needs auth token)${colors.reset}`);
    return;
  }

  const statusCode = await makeRequest(method, path, requiresAuth);
  
  if (statusCode >= 200 && statusCode < 300) {
    console.log(`${colors.green}✓ OK (${statusCode})${colors.reset}`);
  } else if (statusCode === 401 || statusCode === 403) {
    console.log(`${colors.yellow}⚠ Auth Required (${statusCode})${colors.reset}`);
  } else if (statusCode === 404) {
    console.log(`${colors.red}✗ NOT FOUND (${statusCode})${colors.reset}`);
  } else if (statusCode === 0) {
    console.log(`${colors.red}✗ CONNECTION ERROR${colors.reset}`);
  } else {
    console.log(`${colors.red}✗ ERROR (${statusCode})${colors.reset}`);
  }
}

async function runTests() {
  console.log('=========================================');
  console.log('Testing Fefa Backend API');
  console.log(`Base URL: ${BASE_URL}`);
  console.log('=========================================');
  console.log('');

  console.log('=== PUBLIC ENDPOINTS ===');
  await testEndpoint('GET', '/api/health', 'Health check', false);
  await testEndpoint('GET', '/api/endpoints', 'Endpoints list', false);
  await testEndpoint('GET', '/api/auth', 'Auth API info', false);
  await testEndpoint('GET', '/api/products', 'Get products', false);
  await testEndpoint('GET', '/api/categories', 'Get categories', false);
  await testEndpoint('GET', '/api/banners', 'Get banners', false);
  await testEndpoint('GET', '/api/reviews', 'Get reviews', false);
  console.log('');

  console.log('=== AUTHENTICATED ENDPOINTS ===');
  await testEndpoint('GET', '/api/users', 'Get users (Admin)', true);
  await testEndpoint('GET', '/api/auth/me', 'Get current user', true);
  await testEndpoint('GET', '/api/cart', 'Get cart', true);
  await testEndpoint('GET', '/api/orders', 'Get orders', true);
  await testEndpoint('GET', '/api/wishlist', 'Get wishlist', true);
  console.log('');

  console.log('=========================================');
  console.log('Testing complete!');
  if (!AUTH_TOKEN) {
    console.log('');
    console.log('To test authenticated endpoints, run:');
    console.log(`node test-api.js ${BASE_URL} <your-auth-token>`);
  }
  console.log('=========================================');
}

runTests().catch(console.error);

