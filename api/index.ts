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
  // Log immediately when function is invoked - CRITICAL for debugging
  console.log(`[Vercel] ========== REQUEST RECEIVED ==========`);
  console.log(`[Vercel] Method: ${req.method}`);
  console.log(`[Vercel] URL: ${req.url || 'unknown'}`);
  console.log(`[Vercel] Origin: ${req.headers.origin || 'none'}`);
  console.log(`[Vercel] Content-Type: ${req.headers['content-type'] || 'none'}`);
  console.log(`[Vercel] Authorization: ${req.headers.authorization ? 'present' : 'missing'}`);
  console.log(`[Vercel] =======================================`);
  
  // Handle OPTIONS preflight requests immediately with CORS headers
  // This must happen BEFORE any other processing
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin;
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      'https://fefa-frontend.vercel.app',
      'http://localhost:3000',
      'http://localhost:3001'
    ].filter(Boolean);
    
    console.log(`[CORS] OPTIONS request from origin: ${origin}`);
    console.log(`[CORS] Allowed origins:`, allowedOrigins);
    
    if (origin) {
      const normalizedOrigin = origin.endsWith('/') ? origin.slice(0, -1) : origin;
      const isAllowed = allowedOrigins.includes(origin) || 
                        allowedOrigins.includes(normalizedOrigin) || 
                        process.env.NODE_ENV === 'development' ||
                        !process.env.NODE_ENV;
      
      console.log(`[CORS] Origin check - Original: ${origin}, Normalized: ${normalizedOrigin}, Allowed: ${isAllowed}`);
      
      if (isAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-auth-token, X-Requested-With, Accept, Origin');
        res.setHeader('Access-Control-Max-Age', '86400');
        console.log(`[CORS] OPTIONS request allowed, headers set`);
        return res.status(204).end();
      } else {
        console.log(`[CORS] OPTIONS request BLOCKED - origin not in allowed list`);
      }
    } else {
      console.log(`[CORS] OPTIONS request with no origin header`);
    }
    // If origin not allowed, still return 204 but without CORS headers (browser will block)
    return res.status(204).end();
  }
  
  // Set CORS headers for ALL requests (not just OPTIONS)
  // This ensures CORS headers are present on actual POST/GET/etc responses
  // CRITICAL: Must set headers BEFORE any processing to ensure they're on the response
  const origin = req.headers.origin;
  const allowedOrigins = [
    process.env.FRONTEND_URL,
    'https://fefa-frontend.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001'
  ].filter(Boolean);
  
  if (origin) {
    const normalizedOrigin = origin.endsWith('/') ? origin.slice(0, -1) : origin;
    const isAllowed = allowedOrigins.includes(origin) || 
                      allowedOrigins.includes(normalizedOrigin) || 
                      process.env.NODE_ENV === 'development' ||
                      !process.env.NODE_ENV;
    
    if (isAllowed) {
      // Set CORS headers immediately - these will be on ALL responses
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      // IMPORTANT: Allow multipart/form-data Content-Type for FormData uploads
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-auth-token, X-Requested-With, Accept, Origin');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '86400');
      console.log(`[CORS] Set CORS headers for ${req.method} request from origin: ${origin}`);
      console.log(`[CORS] Content-Type: ${req.headers['content-type'] || 'none'}`);
    } else {
      console.log(`[CORS] Origin not allowed: ${origin}`);
    }
  } else if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
    // Allow requests with no origin in development
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  
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
    let requestUrl = req.url || '/';
    console.log(`[Vercel] Raw request URL: ${requestUrl}`);
    
    // CRITICAL FIX: When Vercel routes /api/* to api/index.ts, it may strip the /api prefix
    // OR it may pass the full path. We need to handle both cases.
    // Check if URL starts with /api - if not, and it's an API route, prepend /api
    if (!requestUrl.startsWith('/api')) {
      // Check if this looks like an API route that should have /api prefix
      const apiRoutePatterns = ['/auth', '/users', '/products', '/cart', '/orders', 
                                '/categories', '/banners', '/wishlist', '/reviews', '/health', '/test'];
      const isApiRoute = apiRoutePatterns.some(pattern => 
        requestUrl === pattern || requestUrl.startsWith(pattern + '/')
      );
      
      if (isApiRoute || requestUrl !== '/') {
        requestUrl = '/api' + requestUrl;
        console.log(`[Vercel] Adjusted URL from ${req.url} to ${requestUrl}`);
      }
    }
    
    // Set both url and originalUrl for Express routing
    // Express uses originalUrl for route matching, url for internal routing
    (req as any).url = requestUrl;
    (req as any).originalUrl = requestUrl;
    
    console.log(`[Vercel] Final URL for Express: ${requestUrl}`);
    console.log(`[Vercel] Express app type: ${typeof app}, is function: ${typeof app === 'function'}`);
    
    // Verify app is callable
    if (typeof app !== 'function') {
      console.error('[Vercel] App is not a function:', typeof app);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Server configuration error',
          message: 'Express app is not properly initialized'
        });
      }
      return;
    }
    
    // Debug: Log available routes (if possible)
    try {
      const routes = (app as any)._router?.stack;
      if (routes) {
        console.log(`[Vercel] Express has ${routes.length} registered routes`);
        // Log first few routes for debugging
        routes.slice(0, 5).forEach((route: any, idx: number) => {
          if (route.route) {
            console.log(`[Vercel] Route ${idx}: ${Object.keys(route.route.methods).join(',')} ${route.route.path}`);
          } else if (route.regexp) {
            console.log(`[Vercel] Middleware ${idx}: ${route.name || 'anonymous'}`);
          }
        });
      }
    } catch (e) {
      console.log('[Vercel] Could not inspect routes:', e);
    }
    
    // Pass request to Express app directly
    // Express apps can be called as request handlers
    // Wrap in Promise to handle async properly
    return new Promise<void>((resolve, reject) => {
      let finished = false;
      
      const finish = () => {
        if (!finished) {
          finished = true;
          resolve();
        }
      };
      
      const error = (err: Error) => {
        if (!finished) {
          finished = true;
          console.error('[Vercel] Response error:', err);
          reject(err);
        }
      };
      
      // Set a timeout to ensure we don't hang forever
      const timeout = setTimeout(() => {
        if (!finished && !res.headersSent) {
          finished = true;
          console.error('[Vercel] Request timeout');
          res.status(504).json({
            success: false,
            error: 'Request timeout'
          });
          resolve();
        }
      }, 25000); // 25 seconds
      
      // Listen for response completion
      const cleanup = () => {
        clearTimeout(timeout);
        res.removeListener('finish', finish);
        res.removeListener('close', finish);
        res.removeListener('error', error);
      };
      
      res.once('finish', () => {
        cleanup();
        finish();
      });
      res.once('close', () => {
        cleanup();
        finish();
      });
      res.once('error', (err) => {
        cleanup();
        error(err);
      });
      
      // Call Express app as a request handler function
      // This is the standard way to use Express with serverless functions
      try {
        // Express app can be called directly as (req, res, next)
        // The next callback is called when no route matches (404) or on error
        app(req as any, res as any, (err?: any) => {
          cleanup();
          if (err) {
            console.error('[Vercel] Express middleware error:', err);
            console.error('[Vercel] Error stack:', err.stack);
            // Express error handler should deal with this
            // If response already sent, just resolve
            if (res.headersSent) {
              if (!finished) {
                finished = true;
                resolve();
              }
            } else if (!finished) {
              // Error handler should send response, but if not, reject
              finished = true;
              reject(err);
            }
          } else {
            // No error but no route matched - this shouldn't happen if routes are registered
            // But if it does, Express should have sent a 404 response
            console.log('[Vercel] No error, but route may not have matched');
            if (!finished && res.headersSent) {
              finished = true;
              resolve();
            } else if (!finished) {
              // Wait a bit to see if response comes
              setTimeout(() => {
                if (!finished) {
                  console.log('[Vercel] No response sent, resolving anyway');
                  finished = true;
                  resolve();
                }
              }, 100);
            }
          }
        });
      } catch (err) {
        console.error('[Vercel] Express call exception:', err);
        cleanup();
        if (!finished) {
          finished = true;
          if (!res.headersSent) {
            reject(err as Error);
          } else {
            resolve();
          }
        }
      }
    });
    
  } catch (error) {
    console.error('[Vercel] Serverless function error:', error);
    
    // Ensure CORS headers are set on error responses
    const errorOrigin = req.headers.origin;
    const errorAllowedOrigins = [
      process.env.FRONTEND_URL,
      'https://fefa-frontend.vercel.app',
      'http://localhost:3000',
      'http://localhost:3001'
    ].filter(Boolean);
    
    if (errorOrigin) {
      const normalizedErrorOrigin = errorOrigin.endsWith('/') ? errorOrigin.slice(0, -1) : errorOrigin;
      const isErrorAllowed = errorAllowedOrigins.includes(errorOrigin) || 
                            errorAllowedOrigins.includes(normalizedErrorOrigin) || 
                            process.env.NODE_ENV === 'development' ||
                            !process.env.NODE_ENV;
      
      if (isErrorAllowed) {
        res.setHeader('Access-Control-Allow-Origin', errorOrigin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-auth-token, X-Requested-With, Accept, Origin');
      }
    } else if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    
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
    return;
  }
};

