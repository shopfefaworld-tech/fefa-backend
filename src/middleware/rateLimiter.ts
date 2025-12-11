import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { redisConfig } from '../config/redis';

// Create Redis store for rate limiting
const createRedisStore = () => {
  return {
    async increment(key: string) {
      try {
        const client = await redisConfig.connect();
        if (!client) {
          // Fallback to in-memory counting
          return { totalHits: 1, resetTime: new Date(Date.now() + 900000) };
        }
        
        const current = await client.get(key);
        const count = current ? parseInt(current) + 1 : 1;
        
        // Set expiration to windowMs
        await client.setEx(key, 900, count.toString()); // 15 minutes
        return { totalHits: count, resetTime: new Date(Date.now() + 900000) };
      } catch (error) {
        console.error('Redis rate limit error:', error);
        return { totalHits: 1, resetTime: new Date(Date.now() + 900000) };
      }
    },
    
    async decrement(key: string) {
      try {
        const client = await redisConfig.connect();
        if (!client) return;
        
        const current = await client.get(key);
        if (current) {
          const count = Math.max(0, parseInt(current) - 1);
          await client.setEx(key, 900, count.toString());
        }
      } catch (error) {
        console.error('Redis rate limit decrement error:', error);
      }
    },
    
    async resetKey(key: string) {
      try {
        const client = await redisConfig.connect();
        if (!client) return;
        
        await client.del(key);
      } catch (error) {
        console.error('Redis rate limit reset error:', error);
      }
    }
  };
};

// General API rate limiter
export const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore(),
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
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore(),
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
  message: {
    success: false,
    message: 'Too many analytics requests, please try again later.',
    retryAfter: '5 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore(),
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
    // For anonymous users, use a safe IP-based key
    // Extract IP from various headers (Vercel uses x-forwarded-for)
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded 
      ? (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim())
      : req.socket.remoteAddress || 'unknown';
    return `ip:${ip}`;
  },
  message: {
    success: false,
    message: 'Too many admin operations, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore(),
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
  message: {
    success: false,
    message: 'Too many banner interactions, please slow down.',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore(),
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
