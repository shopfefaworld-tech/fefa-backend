import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import dotenv from 'dotenv';

// Import configurations
import { connectDB } from './config/database';
import { initializeFirebase } from './config/firebase';
import { initializeCloudinary } from './config/cloudinary';
import { redisConfig } from './config/redis';

// Import routes
import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import userRoutes from './routes/users';
import cartRoutes from './routes/cart';
import orderRoutes from './routes/orders';
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

// Security middleware
app.use(helmet());

// CORS configuration
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://fefa-frontend.vercel.app',
  'http://localhost:3000'
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression middleware
app.use(compression());

// Logging middleware
app.use(morgan('combined'));

// Apply general rate limiting to all routes
app.use(generalRateLimit);

// Root endpoint
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Fefa Jewelry API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Fefa Jewelry API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API routes
app.use('/api/auth', authRateLimit, authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/users', userRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
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
