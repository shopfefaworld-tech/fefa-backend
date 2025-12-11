import type { VercelRequest, VercelResponse } from '@vercel/node';
import app from '../src/server';
import { connectDB } from '../src/config/database';
import { initializeFirebase } from '../src/config/firebase';
import { initializeCloudinary } from '../src/config/cloudinary';
import { redisConfig } from '../src/config/redis';
import mongoose from 'mongoose';

// Track initialization state
let isInitialized = false;
let initializationPromise: Promise<void> | null = null;

// Initialize services (idempotent - safe to call multiple times)
const ensureInitialized = async (): Promise<void> => {
  // If already initialized, return immediately
  if (isInitialized) {
    return;
  }

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start initialization
  initializationPromise = (async () => {
    try {
      // Connect to MongoDB (mongoose handles connection reuse)
      if (mongoose.connection.readyState === 0) {
        try {
          await connectDB();
        } catch (error) {
          console.error('❌ MongoDB connection failed:', error);
          // Continue - MongoDB will retry on next request
        }
      }

      // Initialize Redis (with fallback)
      try {
        await redisConfig.connect();
      } catch (error) {
        console.log('⚠️ Redis unavailable, using in-memory caching');
      }

      // Initialize Firebase (has internal check for already initialized)
      try {
        await initializeFirebase();
      } catch (error) {
        console.error('❌ Firebase initialization failed:', error);
        // Continue - Firebase might not be critical for all endpoints
      }

      // Initialize Cloudinary (has internal check for already initialized)
      try {
        initializeCloudinary();
      } catch (error) {
        console.error('❌ Cloudinary initialization failed:', error);
        // Continue - Cloudinary might not be critical for all endpoints
      }

      isInitialized = true;
      console.log('✅ Services initialized for Vercel serverless function');
    } catch (error) {
      console.error('❌ Failed to initialize services:', error);
      // Mark as initialized anyway to prevent infinite retry loops
      // Some services might still work
      isInitialized = true;
    }
  })();

  return initializationPromise;
};

// Vercel serverless function handler
// This handles ALL routes including root / and /api/*
export default async (req: VercelRequest, res: VercelResponse) => {
  try {
    // Ensure services are initialized before handling request
    // Don't fail if initialization has errors - let Express handle the request
    try {
      await ensureInitialized();
    } catch (initError) {
      console.error('[Vercel] Initialization warning:', initError);
      // Continue anyway - some endpoints might work without all services
    }
    
    // Log the request path for debugging
    console.log(`[Vercel] Handling request: ${req.method} ${req.url}`);
    
    // Set timeout for the request
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({
          success: false,
          error: 'Request timeout'
        });
      }
    }, 25000); // 25 second timeout (Vercel limit is 30s)
    
    // Pass request to Express app
    // Express will handle routing including root /
    app(req, res);
    
    // Clear timeout when response is sent
    res.on('finish', () => {
      clearTimeout(timeout);
    });
    
  } catch (error) {
    console.error('[Vercel] Serverless function error:', error);
    // Return error response instead of crashing
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
        ...(process.env.NODE_ENV === 'development' && { 
          stack: error instanceof Error ? error.stack : undefined 
        })
      });
    }
  }
};

