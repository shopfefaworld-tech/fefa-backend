# Vercel Backend Deployment Guide

## Prerequisites
- Vercel account
- GitHub repository with backend code
- Environment variables configured

## Deployment Steps

### 1. Connect Repository to Vercel
1. Go to [vercel.com](https://vercel.com)
2. Click "Add New Project"
3. Import your GitHub repository (`fefa-backend`)
4. Configure the project:
   - **Framework Preset**: Other
   - **Root Directory**: `fefa-backend` (if monorepo) or leave blank
   - **Build Command**: `npm run build` (optional, Vercel will auto-detect)
   - **Output Directory**: Leave blank (not needed for serverless)
   - **Install Command**: `npm install`

### 2. Configure Environment Variables
In Vercel project settings → Environment Variables, add:

**Required:**
- `MONGODB_URI` - Your MongoDB connection string
- `JWT_SECRET` - Secret for JWT tokens
- `JWT_REFRESH_SECRET` - Secret for refresh tokens
- `FRONTEND_URL` - `https://fefa-frontend.vercel.app`
- `NODE_ENV` - `production`

**Firebase:**
- `FIREBASE_PROJECT_ID` - Your Firebase project ID
- `FIREBASE_PRIVATE_KEY` - Firebase private key (with escaped newlines)
- `FIREBASE_CLIENT_EMAIL` - Firebase client email

**Cloudinary:**
- `CLOUDINARY_CLOUD_NAME` - Your Cloudinary cloud name
- `CLOUDINARY_API_KEY` - Cloudinary API key
- `CLOUDINARY_API_SECRET` - Cloudinary API secret

**Redis (Optional):**
- `REDIS_URL` - Redis connection URL (if using Redis)

### 3. Deploy
1. Click "Deploy"
2. Wait for build to complete
3. Your API will be available at: `https://your-project.vercel.app/api/*`

### 4. Update Frontend API URL
Update your frontend `.env.production` or Vercel environment variables:
```
NEXT_PUBLIC_API_URL=https://your-backend-project.vercel.app/api
```

## API Endpoints
All endpoints are prefixed with `/api`:
- `/api/health` - Health check
- `/api/auth/*` - Authentication routes
- `/api/products/*` - Product routes
- `/api/users/*` - User routes
- `/api/cart/*` - Cart routes
- `/api/orders/*` - Order routes
- `/api/categories/*` - Category routes
- `/api/banners/*` - Banner routes
- `/api/wishlist/*` - Wishlist routes
- `/api/reviews/*` - Review routes

## Notes
- The backend runs as serverless functions on Vercel
- Database connections are managed per function invocation
- Redis is optional (falls back to in-memory cache)
- CORS is configured to allow requests from your frontend domain

