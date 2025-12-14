# CORS Test Endpoints

After deploying, use these endpoints to test CORS functionality:

## Test Endpoints (No Auth Required)

### 1. GET CORS Test
```bash
curl -X GET https://fefa-backend.vercel.app/api/test/cors \
  -H "Origin: https://fefa-frontend.vercel.app" \
  -v
```

**Expected:** Should return 200 with CORS headers

### 2. POST CORS Test (Simple JSON)
```bash
curl -X POST https://fefa-backend.vercel.app/api/test/cors \
  -H "Origin: https://fefa-frontend.vercel.app" \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}' \
  -v
```

**Expected:** Should return 200 with CORS headers

### 3. OPTIONS Preflight Test
```bash
curl -X OPTIONS https://fefa-backend.vercel.app/api/test/cors \
  -H "Origin: https://fefa-frontend.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type,Authorization" \
  -v
```

**Expected:** Should return 204 with all CORS headers

### 4. Products POST Test (No Auth)
```bash
curl -X POST https://fefa-backend.vercel.app/api/products/test \
  -H "Origin: https://fefa-frontend.vercel.app" \
  -H "Content-Type: application/json" \
  -d '{"test": "product"}' \
  -v
```

**Expected:** Should return 200 with CORS headers

### 5. Products OPTIONS Preflight
```bash
curl -X OPTIONS https://fefa-backend.vercel.app/api/products \
  -H "Origin: https://fefa-frontend.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type,Authorization" \
  -v
```

**Expected:** Should return 204 with all CORS headers

### 6. Products POST with FormData (Simulated)
```bash
curl -X POST https://fefa-backend.vercel.app/api/products/test \
  -H "Origin: https://fefa-frontend.vercel.app" \
  -F "name=Test Product" \
  -F "price=100" \
  -v
```

**Expected:** Should return 200 with CORS headers

## Browser Console Test

Open browser console on `https://fefa-frontend.vercel.app` and run:

```javascript
// Test 1: Simple GET
fetch('https://fefa-backend.vercel.app/api/test/cors', {
  method: 'GET',
  headers: {
    'Origin': 'https://fefa-frontend.vercel.app'
  }
})
.then(r => r.json())
.then(console.log)
.catch(console.error);

// Test 2: POST with JSON
fetch('https://fefa-backend.vercel.app/api/test/cors', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Origin': 'https://fefa-frontend.vercel.app'
  },
  body: JSON.stringify({ test: 'data' })
})
.then(r => r.json())
.then(console.log)
.catch(console.error);

// Test 3: POST with FormData (like product creation)
const formData = new FormData();
formData.append('name', 'Test Product');
formData.append('price', '100');

fetch('https://fefa-backend.vercel.app/api/products/test', {
  method: 'POST',
  headers: {
    'Origin': 'https://fefa-frontend.vercel.app'
  },
  body: formData
})
.then(r => r.json())
.then(console.log)
.catch(console.error);
```

## What to Check

1. **Response Headers** should include:
   - `Access-Control-Allow-Origin: https://fefa-frontend.vercel.app`
   - `Access-Control-Allow-Credentials: true`
   - `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, PATCH, OPTIONS`
   - `Access-Control-Allow-Headers: Content-Type, Authorization, x-auth-token, X-Requested-With, Accept, Origin`

2. **OPTIONS requests** should return `204 No Content`

3. **No CORS errors** in browser console

4. **Check Vercel logs** for CORS debug messages:
   - `[CORS] OPTIONS request from origin: ...`
   - `[CORS] Origin check - ...`
   - `[CORS] OPTIONS request allowed, headers set`

## Troubleshooting

If CORS still fails:

1. Check Vercel environment variables:
   - `FRONTEND_URL` should be set to `https://fefa-frontend.vercel.app`

2. Check Vercel function logs for:
   - CORS debug messages
   - Origin matching issues
   - Missing headers

3. Verify the origin in browser:
   - Should be exactly `https://fefa-frontend.vercel.app` (no trailing slash)

4. Test with curl first to isolate browser vs server issues

