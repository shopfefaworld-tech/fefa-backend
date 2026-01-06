import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

// Import configurations
import { connectDB } from './config/database';
import { initializeFirebase } from './config/firebase';
import { initializeCloudinary } from './config/cloudinary';
import { initializeRazorpay } from './config/razorpay';

// Import routes
import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import userRoutes from './routes/users';
import cartRoutes from './routes/cart';
import orderRoutes from './routes/orders';
import paymentRoutes from './routes/payments';
import categoryRoutes from './routes/categories';
import collectionRoutes from './routes/collections';
import occasionRoutes from './routes/occasions';
import bannerRoutes from './routes/banners';
import wishlistRoutes from './routes/wishlist';
import reviewRoutes from './routes/reviews';
import analyticsRoutes from './routes/analytics';
import settingsRoutes from './routes/settings';

// Import middleware
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { generalRateLimit, authRateLimit, adminRateLimit } from './middleware/rateLimiter';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Trust proxy - REQUIRED for Vercel and rate limiting to work correctly
// This tells Express to trust the X-Forwarded-* headers from Vercel's proxy
app.set('trust proxy', true);

// CORS configuration - MUST be before other middleware
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://fefa-frontend.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001'
].filter(Boolean);

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps, curl requests, or same-origin requests)
    if (!origin) {
      return callback(null, true);
    }
    
    // Normalize origin (remove trailing slash if present)
    const normalizedOrigin = origin.endsWith('/') ? origin.slice(0, -1) : origin;
    
    // Check if origin (normalized or original) is in allowed list
    if (allowedOrigins.includes(origin) || allowedOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }
    
    // Allow in development mode
    if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
      return callback(null, true);
    }
    
    // Log blocked origins for debugging
    console.log(`[CORS] Blocked origin: ${origin}`);
    console.log(`[CORS] Allowed origins:`, allowedOrigins);
    callback(new Error(`Not allowed by CORS. Origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'x-auth-token', 
    'X-Requested-With',
    'Accept',
    'Origin',
    'X-HTTP-Method-Override'
  ],
  // Expose headers that the client might need to read
  exposedHeaders: ['Content-Type', 'Authorization'],
  preflightContinue: false,
  optionsSuccessStatus: 204,
  maxAge: 86400 // 24 hours - cache preflight requests
};

// Apply CORS to all routes FIRST - handles OPTIONS preflight automatically
app.use(cors(corsOptions));

// Additional middleware to ensure CORS headers are ALWAYS set on responses
// This is a safety net in case Express CORS middleware doesn't catch everything
app.use((req, res, next) => {
  // Store original end function
  const originalEnd = res.end.bind(res);
  
  // Override end to ensure CORS headers are set before sending response
  (res as any).end = function(chunk?: any, encoding?: any, cb?: any) {
    // Check if headers are already sent - if so, don't try to set them
    if (res.headersSent) {
      // Headers already sent, just call original end
      if (typeof chunk === 'function') {
        return originalEnd(chunk);
      } else if (typeof encoding === 'function') {
        return originalEnd(chunk, encoding);
      } else if (cb) {
        return originalEnd(chunk, encoding, cb);
      } else {
        return originalEnd(chunk, encoding);
      }
    }
    
    // Only set CORS headers if they're not already set and headers haven't been sent
    if (!res.getHeader('Access-Control-Allow-Origin')) {
      const origin = req.headers.origin;
      const allowedOrigins = [
        process.env.FRONTEND_URL,
        'https://fefa-frontend.vercel.app',
        'http://localhost:3000',
        'http://localhost:3001'
      ].filter(Boolean);
      
      if (origin) {
        const normalizedOrigin = origin.endsWith('/') ? origin.slice(0, -1) : origin;
        if (allowedOrigins.includes(origin) || 
            allowedOrigins.includes(normalizedOrigin) || 
            process.env.NODE_ENV === 'development' ||
            !process.env.NODE_ENV) {
          try {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-auth-token, X-Requested-With, Accept, Origin');
          } catch (error) {
            // Headers might have been sent between check and set, ignore error
            console.error('CORS header set error (ignored):', error);
          }
        }
      } else if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
        try {
          res.setHeader('Access-Control-Allow-Origin', '*');
        } catch (error) {
          // Headers might have been sent between check and set, ignore error
          console.error('CORS header set error (ignored):', error);
        }
      }
    }
    
    // Call original end function with all possible signatures
    if (typeof chunk === 'function') {
      return originalEnd(chunk);
    } else if (typeof encoding === 'function') {
      return originalEnd(chunk, encoding);
    } else if (cb) {
      return originalEnd(chunk, encoding, cb);
    } else {
      return originalEnd(chunk, encoding);
    }
  };
  
  next();
});

// Security middleware (configured to not interfere with CORS)
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false // Disable CSP to avoid CORS issues
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression middleware
app.use(compression());

// Logging middleware
app.use(morgan('combined'));

// Custom request logging middleware to track all requests
app.use((req, res, next) => {
  console.log(`[EXPRESS] ${req.method} ${req.originalUrl || req.url}`);
  console.log(`[EXPRESS] Origin: ${req.headers.origin || 'none'}`);
  console.log(`[EXPRESS] Content-Type: ${req.headers['content-type'] || 'none'}`);
  next();
});

// Favicon handler - prevent 404/500 errors from browser favicon requests
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Root endpoint - MUST be before rate limiting to catch root requests
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Fefa Jewelry API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      products: '/api/products',
      users: '/api/users',
      cart: '/api/cart',
      orders: '/api/orders',
      categories: '/api/categories',
      collections: '/api/collections',
      banners: '/api/banners',
      wishlist: '/api/wishlist',
      reviews: '/api/reviews'
    },
    documentation: 'Visit /api/health for API status'
  });
});

// Test endpoints - MUST be before rate limiting to ensure they work
// These routes are defined directly on app (not in routers) to ensure they're matched first

// Test route to verify routing works
app.get('/api/test', (req, res) => {
  res.status(200).json({
    success: true,
    message: '✅ Test is successful! API routing is working correctly.',
    test: 'api-routing',
    url: req.url,
    originalUrl: req.originalUrl,
    timestamp: new Date().toISOString()
  });
});

// CORS test endpoint - GET
app.get('/api/test/cors', (req, res) => {
  res.status(200).json({
    success: true,
    message: '✅ Test is successful! CORS GET is working correctly.',
    test: 'cors-get',
    method: req.method,
    origin: req.headers.origin,
    headers: {
      origin: req.headers.origin,
      'access-control-allow-origin': res.getHeader('Access-Control-Allow-Origin'),
    },
    timestamp: new Date().toISOString()
  });
});

// CORS test endpoint - POST (no auth required)
app.post('/api/test/cors', (req, res) => {
  res.status(200).json({
    success: true,
    message: '✅ Test is successful! CORS POST is working correctly.',
    test: 'cors-post',
    method: req.method,
    origin: req.headers.origin,
    contentType: req.headers['content-type'],
    bodyReceived: !!req.body,
    bodyKeys: req.body ? Object.keys(req.body) : [],
    timestamp: new Date().toISOString()
  });
});

// CORS test endpoint - OPTIONS (explicit handler)
app.options('/api/test/cors', (req, res) => {
  res.status(204).end();
});

// Test endpoint for products - GET and POST (no auth, no upload)
// IMPORTANT: These must be defined before any app.use() routes
app.get('/api/test/products', (req, res) => {
  console.log('[TEST] GET /api/test/products called');
  res.status(200).json({
    success: true,
    message: '✅ Test is successful! Products GET test endpoint is working correctly.',
    test: 'products-get-no-auth',
    method: req.method,
    origin: req.headers.origin,
    url: req.url,
    originalUrl: req.originalUrl,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/test/products', (req, res) => {
  console.log('[TEST] POST /api/test/products called');
  res.status(200).json({
    success: true,
    message: '✅ Test is successful! Products POST test endpoint is working correctly.',
    test: 'products-post-no-auth',
    method: req.method,
    origin: req.headers.origin,
    contentType: req.headers['content-type'],
    hasBody: !!req.body,
    url: req.url,
    originalUrl: req.originalUrl,
    timestamp: new Date().toISOString()
  });
});

// OPTIONS handler for test products endpoint
app.options('/api/test/products', (req, res) => {
  console.log('[TEST] OPTIONS /api/test/products called');
  res.status(204).end();
});

// Apply general rate limiting to all routes (except OPTIONS for CORS preflight)
// Also skip for product routes as they use adminRateLimit
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    return next(); // Skip rate limiting for OPTIONS requests
  }
  // Skip general rate limit for product routes (they use adminRateLimit)
  if (req.path.startsWith('/api/products')) {
    return next();
  }
  return generalRateLimit(req, res, next);
});

// API root endpoint
app.get('/api', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Fefa Jewelry API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      products: '/api/products',
      users: '/api/users',
      cart: '/api/cart',
      orders: '/api/orders',
      categories: '/api/categories',
      banners: '/api/banners',
      wishlist: '/api/wishlist',
      reviews: '/api/reviews'
    }
  });
});

// Health check endpoint (no database required)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Fefa Jewelry API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    vercel: !!process.env.VERCEL,
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Fefa Jewelry API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    vercel: !!process.env.VERCEL,
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// API routes
app.use('/api/auth', authRateLimit, authRoutes);
// Products route - use admin rate limit (higher limit for admin operations)
app.use('/api/products', adminRateLimit, productRoutes);
app.use('/api/users', userRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/occasions', occasionRoutes);
app.use('/api/banners', bannerRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings', settingsRoutes);

// 404 handler
app.use(notFound);

// Error handling middleware
app.use(errorHandler);

// Initialize services
const initializeServices = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    console.log('✅ Connected to MongoDB');

    // Using in-memory caching (no Redis)
    console.log('✅ Using in-memory caching');

    // Initialize Firebase
    await initializeFirebase();
    console.log('✅ Firebase initialized');

    // Initialize Cloudinary
    await initializeCloudinary();
    console.log('✅ Cloudinary initialized');

    // Initialize Razorpay
    try {
      initializeRazorpay();
      console.log('✅ Razorpay initialized');
    } catch (error) {
      console.log('⚠️ Razorpay unavailable:', (error as Error).message);
    }
  } catch (error) {
    console.error('❌ Failed to initialize services:', error);
    throw error;
  }
};

// Check if running on Vercel
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV;

// Initialize services (for both Vercel and regular server)
if (isVercel) {
  // On Vercel, initialize services but don't start HTTP server
  initializeServices().catch((error) => {
    console.error('❌ Failed to initialize services on Vercel:', error);
  });
} else {
  // Regular server mode - start HTTP server
  const startServer = async () => {
    try {
      await initializeServices();

      // Start server
      app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🔗 Health check: http://localhost:${PORT}/health`);
        console.log(`📦 In-memory caching enabled`);
        console.log(`🛡️ Rate limiting enabled`);
      });
    } catch (error) {
      console.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  };

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (err: Error) => {
    console.error('Unhandled Promise Rejection:', err);
    process.exit(1);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (err: Error) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
  });

  // Start the server
  startServer();
}

export default app;
