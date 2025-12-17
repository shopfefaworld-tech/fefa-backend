import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';

// In-memory store for rate limiting (simplified, no Redis needed)
const memoryStore = new Map<string, { count: number; resetTime: number }>();

const createMemoryStore = () => {
  return {
    async increment(key: string) {
      const now = Date.now();
      const windowMs = 900000; // 15 minutes
      const item = memoryStore.get(key);
      
      if (!item || item.resetTime < now) {
        // New or expired entry
        memoryStore.set(key, { count: 1, resetTime: now + windowMs });
        return { totalHits: 1, resetTime: new Date(now + windowMs) };
      }
      
      // Increment existing entry
      item.count++;
      memoryStore.set(key, item);
      return { totalHits: item.count, resetTime: new Date(item.resetTime) };
    },
    
    async decrement(key: string) {
      const item = memoryStore.get(key);
      if (item && item.count > 0) {
        item.count--;
        memoryStore.set(key, item);
      }
    },
    
    async resetKey(key: string) {
      memoryStore.delete(key);
    }
  };
};

// Custom key generator that works with Vercel's proxy
const getClientIp = (req: Request): string => {
  // When trust proxy is enabled, req.ip will use X-Forwarded-For automatically
  // But we'll also handle it manually for safety
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return ips.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
};

// General API rate limiter
export const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  keyGenerator: (req: Request) => getClientIp(req),
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: createMemoryStore(),
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      message: 'Too many requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    });
  }
});

// Auth endpoints rate limiter (more restrictive)
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 auth requests per windowMs
  keyGenerator: (req: Request) => getClientIp(req),
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: createMemoryStore(),
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      message: 'Too many authentication attempts, please try again later.',
      retryAfter: '15 minutes'
    });
  }
});

// Banner analytics rate limiter
export const bannerAnalyticsRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // Limit each IP to 50 analytics requests per windowMs
  keyGenerator: (req: Request) => getClientIp(req),
  message: {
    success: false,
    message: 'Too many analytics requests, please try again later.',
    retryAfter: '5 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: createMemoryStore(),
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      message: 'Too many analytics requests, please try again later.',
      retryAfter: '5 minutes'
    });
  }
});

// Admin operations rate limiter
export const adminRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each authenticated user to 200 admin requests per windowMs
  keyGenerator: (req: Request): string => {
    // Use user ID for authenticated users
    const userId = (req as any).user?.id;
    if (userId) {
      return `user:${userId}`;
    }
    // For anonymous users, use IP-based key
    return `ip:${getClientIp(req)}`;
  },
  message: {
    success: false,
    message: 'Too many admin operations, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: createMemoryStore(),
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      message: 'Too many admin operations, please try again later.',
      retryAfter: '15 minutes'
    });
  }
});

// Strict rate limiter for banner clicks/impressions
export const bannerInteractionRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 interactions per minute
  keyGenerator: (req: Request) => getClientIp(req),
  message: {
    success: false,
    message: 'Too many banner interactions, please slow down.',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: createMemoryStore(),
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      message: 'Too many banner interactions, please slow down.',
      retryAfter: '1 minute'
    });
  }
});

export default {
  generalRateLimit,
  authRateLimit,
  bannerAnalyticsRateLimit,
  adminRateLimit,
  bannerInteractionRateLimit
};
