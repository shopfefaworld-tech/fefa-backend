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
import { redisConfig } from './config/redis';

// Import routes
import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import userRoutes from './routes/users';
import cartRoutes from './routes/cart';
import orderRoutes from './routes/orders';
import paymentRoutes from './routes/payments';
import categoryRoutes from './routes/categories';
import bannerRoutes from './routes/banners';
import wishlistRoutes from './routes/wishlist';
import reviewRoutes from './routes/reviews';

// Import middleware
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { generalRateLimit, authRateLimit } from './middleware/rateLimiter';

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
  exposedHeaders: ['Content-Type', 'Authorization'],
  preflightContinue: false,
  optionsSuccessStatus: 204,
  maxAge: 86400 // 24 hours - cache preflight requests
};

// Apply CORS to all routes FIRST - handles OPTIONS preflight automatically
app.use(cors(corsOptions));

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
      banners: '/api/banners',
      wishlist: '/api/wishlist',
      reviews: '/api/reviews'
    },
    documentation: 'Visit /api/health for API status'
  });
});

// Apply general rate limiting to all routes (except OPTIONS for CORS preflight)
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    return next(); // Skip rate limiting for OPTIONS requests
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

// Test route to verify routing works
app.get('/api/test', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Test route works!',
    url: req.url,
    originalUrl: req.originalUrl
  });
});

// CORS test endpoint - GET
app.get('/api/test/cors', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'CORS test successful',
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
    message: 'CORS POST test successful',
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

// Test endpoint for products POST (no auth, no upload)
app.post('/api/test/products', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Products POST test successful (no auth)',
    method: req.method,
    origin: req.headers.origin,
    contentType: req.headers['content-type'],
    hasBody: !!req.body,
    timestamp: new Date().toISOString()
  });
});

// OPTIONS handler for test products endpoint
app.options('/api/test/products', (req, res) => {
  res.status(204).end();
});

// API routes
app.use('/api/auth', authRateLimit, authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/users', userRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/banners', bannerRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/reviews', reviewRoutes);

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

    // Initialize Redis (with fallback)
    try {
      await redisConfig.connect();
      if (redisConfig.isRedisConnected()) {
        console.log('✅ Redis connected');
      } else {
        console.log('⚠️ Redis unavailable, using in-memory caching');
      }
    } catch (error) {
      console.log('⚠️ Redis unavailable, using in-memory caching');
    }

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
        console.log(`📦 Redis caching enabled`);
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
