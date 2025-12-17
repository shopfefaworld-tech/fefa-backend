import type { VercelRequest, VercelResponse } from '@vercel/node';
import app from '../src/server';
import { connectDB } from '../src/config/database';
import { initializeFirebase } from '../src/config/firebase';
import { initializeCloudinary } from '../src/config/cloudinary';
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
      // Add timeout to prevent hanging
      if (mongoose.connection.readyState === 0) {
        try {
          // Race connection against timeout to prevent hanging
          await Promise.race([
            connectDB(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('MongoDB connection timeout')), 8000)
            )
          ]);
        } catch (error) {
          console.error('❌ MongoDB connection failed:', error instanceof Error ? error.message : error);
          // Continue - MongoDB will retry on next request
        }
      }

      // Using in-memory caching (no Redis)
      console.log('✅ Using in-memory caching');

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
    // Add timeout to prevent hanging
    try {
      await Promise.race([
        ensureInitialized(),
        new Promise((resolve) => 
          setTimeout(() => {
            console.log('[Vercel] Initialization timeout, continuing anyway');
            resolve(undefined);
          }, 10000) // 10 second timeout
        )
      ]);
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
    return new Promise<void>((resolve) => {
      let finished = false;
      
      const finish = () => {
        if (!finished) {
          finished = true;
          resolve();
        }
      };
      
      // Set a timeout to ensure we don't hang forever
      const timeout = setTimeout(() => {
        if (!finished && !res.headersSent) {
          finished = true;
          console.error('[Vercel] Request timeout');
          try {
            res.status(504).json({
              success: false,
              error: 'Request timeout'
            });
          } catch (timeoutError) {
            console.error('[Vercel] Error sending timeout response:', timeoutError);
          }
          resolve();
        } else if (!finished) {
          finished = true;
          resolve();
        }
      }, 25000); // 25 seconds
      
      // Listen for response completion
      const cleanup = () => {
        clearTimeout(timeout);
        try {
          res.removeListener('finish', finish);
          res.removeListener('close', finish);
          res.removeListener('error', finish);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
      };
      
      res.once('finish', () => {
        cleanup();
        finish();
      });
      res.once('close', () => {
        cleanup();
        finish();
      });
      res.once('error', () => {
        cleanup();
        finish(); // Don't reject, just finish
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
            console.error('[Vercel] Error stack:', err?.stack);
            // Express error handler should deal with this
            // Always resolve to prevent unhandled rejections
            if (!res.headersSent && !finished) {
              try {
                res.status(500).json({
                  success: false,
                  error: 'Internal server error',
                  message: err?.message || 'Unknown error'
                });
              } catch (responseError) {
                console.error('[Vercel] Error sending error response:', responseError);
              }
            }
            finish();
          } else {
            // No error but no route matched - this shouldn't happen if routes are registered
            // But if it does, Express should have sent a 404 response
            if (!finished && !res.headersSent) {
              // Wait a bit to see if response comes
              setTimeout(() => {
                if (!finished && !res.headersSent) {
                  console.log('[Vercel] No response sent, sending 404');
                  try {
                    res.status(404).json({
                      success: false,
                      message: 'Route not found'
                    });
                  } catch (responseError) {
                    console.error('[Vercel] Error sending 404 response:', responseError);
                  }
                }
                finish();
              }, 100);
            } else {
              finish();
            }
          }
        });
      } catch (err) {
        console.error('[Vercel] Express call exception:', err);
        cleanup();
        if (!finished && !res.headersSent) {
          try {
            res.status(500).json({
              success: false,
              error: 'Internal server error',
              message: err instanceof Error ? err.message : 'Unknown error'
            });
          } catch (responseError) {
            console.error('[Vercel] Error sending exception response:', responseError);
          }
        }
        finish();
      }
    });
    
  } catch (error) {
    console.error('[Vercel] Serverless function error:', error);
    console.error('[Vercel] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    // Ensure CORS headers are set on error responses
    try {
      const errorOrigin = req.headers.origin;
      const errorAllowedOrigins = [
        process.env.FRONTEND_URL,
        'https://fefa-frontend.vercel.app',
        'http://localhost:3000',
        'http://localhost:3001'
      ].filter(Boolean);
      
      if (errorOrigin && !res.headersSent) {
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
      } else if ((process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) && !res.headersSent) {
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
    } catch (corsError) {
      console.error('[Vercel] Error setting CORS headers:', corsError);
    }
    
    // Return error response instead of crashing
    if (!res.headersSent) {
      try {
        res.status(500).json({
          success: false,
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error',
          ...(process.env.NODE_ENV === 'development' && { 
            stack: error instanceof Error ? error.stack : undefined 
          })
        });
      } catch (responseError) {
        console.error('[Vercel] Error sending error response:', responseError);
        // If we can't send JSON, try to end the response
        if (!res.headersSent) {
          try {
            res.status(500).end('Internal Server Error');
          } catch (finalError) {
            console.error('[Vercel] Failed to send any response:', finalError);
          }
        }
      }
    }
    return;
  }
};

