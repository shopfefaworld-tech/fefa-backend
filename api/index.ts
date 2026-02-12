import type { VercelRequest, VercelResponse } from '@vercel/node';
import app from '../src/server';
import { connectDB } from '../src/config/database';
import { initializeFirebase } from '../src/config/firebase';
import { initializeCloudinary } from '../src/config/cloudinary';
import mongoose from 'mongoose';

let isInitialized = false;
let initializationPromise: Promise<void> | null = null;

const enableRequestLogs =
  process.env.ENABLE_REQUEST_LOGS === 'true' || process.env.NODE_ENV === 'development';

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://fefa-frontend.vercel.app',
  'https://frontend-dev.vercel.app',
  'https://shopfefa.world',
  'https://www.shopfefa.world',
  'http://localhost:3000',
  'http://localhost:3001'
].filter(Boolean) as string[];

const isOriginAllowed = (origin?: string): boolean => {
  if (!origin) return process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
  const normalizedOrigin = origin.endsWith('/') ? origin.slice(0, -1) : origin;

  return (
    allowedOrigins.includes(origin) ||
    allowedOrigins.includes(normalizedOrigin) ||
    process.env.NODE_ENV === 'development' ||
    !process.env.NODE_ENV
  );
};

const applyCorsHeaders = (req: VercelRequest, res: VercelResponse): void => {
  const origin = req.headers.origin;

  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, x-auth-token, X-Requested-With, Accept, Origin'
    );
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    return;
  }

  if (!origin && (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV)) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
};

const normalizeRequestUrl = (url: string, req: VercelRequest): string => {
  if (!url) return '/';

  const [pathname] = url.split('?');
  const pathFromQuery = req.query?.path;

  if ((pathname === '/api' || pathname === '/') && pathFromQuery) {
    const normalizedPath = Array.isArray(pathFromQuery)
      ? pathFromQuery.filter(Boolean).join('/')
      : String(pathFromQuery || '').trim();

    const query = new URLSearchParams();
    Object.entries(req.query || {}).forEach(([key, value]) => {
      if (key === 'path' || value === undefined) return;
      if (Array.isArray(value)) {
        value.forEach((v) => query.append(key, String(v)));
      } else {
        query.append(key, String(value));
      }
    });

    const queryString = query.toString();
    return `/api/${normalizedPath}${queryString ? `?${queryString}` : ''}`;
  }

  if (url.startsWith('/api')) return url;
  if (url === '/') return '/';

  const normalized = url.startsWith('/') ? url : `/${url}`;
  return `/api${normalized}`;
};

const ensureInitialized = async (): Promise<void> => {
  if (isInitialized) return;
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    try {
      if (mongoose.connection.readyState === 0) {
        try {
          await Promise.race([
            connectDB(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('MongoDB connection timeout')), 8000)
            )
          ]);
        } catch (error) {
          if (enableRequestLogs) {
            console.error('[Vercel] MongoDB initialization warning:', error);
          }
        }
      }

      try {
        await initializeFirebase();
      } catch (error) {
        if (enableRequestLogs) {
          console.error('[Vercel] Firebase initialization warning:', error);
        }
      }

      try {
        initializeCloudinary();
      } catch (error) {
        if (enableRequestLogs) {
          console.error('[Vercel] Cloudinary initialization warning:', error);
        }
      }
    } finally {
      isInitialized = true;
    }
  })();

  return initializationPromise;
};

export default async (req: VercelRequest, res: VercelResponse) => {
  applyCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    await Promise.race([
      ensureInitialized(),
      new Promise((resolve) => setTimeout(resolve, 10000))
    ]);

    const requestUrl = normalizeRequestUrl(req.url || '/', req);
    (req as any).url = requestUrl;
    (req as any).originalUrl = requestUrl;

    if (enableRequestLogs) {
      console.log(`[Vercel] ${req.method} ${requestUrl}`);
    }

    return await new Promise<void>((resolve) => {
      let finished = false;

      const finish = () => {
        if (!finished) {
          finished = true;
          resolve();
        }
      };

      const timeout = setTimeout(() => {
        if (!finished && !res.headersSent) {
          res.status(504).json({ success: false, error: 'Request timeout' });
        }
        finish();
      }, 25000);

      const cleanup = () => {
        clearTimeout(timeout);
        res.removeListener('finish', finish);
        res.removeListener('close', finish);
        res.removeListener('error', finish);
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
        finish();
      });

      try {
        app(req as any, res as any, (err?: any) => {
          cleanup();

          if (err && !res.headersSent) {
            res.status(500).json({
              success: false,
              error: 'Internal server error',
              message: err?.message || 'Unknown error'
            });
            finish();
            return;
          }

          if (!res.headersSent) {
            res.status(404).json({ success: false, message: 'Route not found' });
          }

          finish();
        });
      } catch (err) {
        cleanup();

        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: err instanceof Error ? err.message : 'Unknown error'
          });
        }

        finish();
      }
    });
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
};
