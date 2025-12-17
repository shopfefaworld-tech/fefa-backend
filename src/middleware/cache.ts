import { Request, Response, NextFunction } from 'express';

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  key?: string; // Custom cache key
  skipCache?: boolean; // Skip cache for this request
}

export interface CacheResponse {
  success: boolean;
  data?: any;
  cached?: boolean;
  message?: string;
}

class CacheService {
  private defaultTTL = 300; // 5 minutes default
  private memoryCache = new Map<string, { data: any; expires: number }>();

  /**
   * Generate cache key based on request
   */
  private generateCacheKey(req: Request, customKey?: string): string {
    if (customKey) {
      return customKey;
    }

    const baseKey = `${req.method}:${req.originalUrl}`;
    const queryString = req.query ? JSON.stringify(req.query) : '';
    const userId = (req as any).user?.id || 'anonymous';
    
    return `${baseKey}:${userId}:${queryString}`;
  }

  /**
   * Get data from cache (in-memory only)
   */
  async get(key: string): Promise<any | null> {
    try {
      // Use in-memory cache
      const memoryItem = this.memoryCache.get(key);
      if (memoryItem && memoryItem.expires > Date.now()) {
        return memoryItem.data;
      } else if (memoryItem) {
        // Remove expired item
        this.memoryCache.delete(key);
      }

      return null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  /**
   * Set data in cache (in-memory only)
   */
  async set(key: string, data: any, ttl?: number): Promise<boolean> {
    try {
      const expireTime = ttl || this.defaultTTL;
      
      // Use in-memory cache
      const expires = Date.now() + (expireTime * 1000);
      this.memoryCache.set(key, { data, expires });
      
      // Clean up expired items periodically
      this.cleanupMemoryCache();
      
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  /**
   * Delete data from cache
   */
  async del(key: string): Promise<boolean> {
    try {
      // Remove from memory cache
      this.memoryCache.delete(key);
      return true;
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  }

  /**
   * Delete multiple keys with pattern
   */
  async delPattern(pattern: string): Promise<number> {
    try {
      let deletedCount = 0;

      // Clean memory cache
      for (const key of this.memoryCache.keys()) {
        if (key.includes(pattern.replace('*', ''))) {
          this.memoryCache.delete(key);
          deletedCount++;
        }
      }

      return deletedCount;
    } catch (error) {
      console.error('Cache pattern delete error:', error);
      return 0;
    }
  }

  /**
   * Clear all banner-related cache
   */
  async clearBannerCache(): Promise<void> {
    try {
      const patterns = [
        'GET:/api/banners*',
        'POST:/api/banners*',
        'PUT:/api/banners*',
        'DELETE:/api/banners*'
      ];

      for (const pattern of patterns) {
        await this.delPattern(pattern);
      }
    } catch (error) {
      console.error('❌ Error clearing banner cache:', error);
    }
  }

  /**
   * Clean up expired memory cache items
   */
  private cleanupMemoryCache(): void {
    const now = Date.now();
    for (const [key, item] of this.memoryCache.entries()) {
      if (item.expires <= now) {
        this.memoryCache.delete(key);
      }
    }
  }

  /**
   * Middleware to cache GET requests
   */
  cacheMiddleware(options: CacheOptions = {}) {
    return async (req: Request, res: Response, next: NextFunction) => {
      // Only cache GET requests
      if (req.method !== 'GET' || options.skipCache) {
        return next();
      }

      try {
        const cacheKey = this.generateCacheKey(req, options.key);
        const cachedData = await this.get(cacheKey);

        if (cachedData) {
          return res.status(200).json({
            ...cachedData,
            cached: true
          });
        }

        // Store original res.json to intercept response
        const originalJson = res.json;
        res.json = function(data: any) {
          // Cache the response
          const cacheService = new CacheService();
          cacheService.set(cacheKey, data, options.ttl);
          
          return originalJson.call(this, data);
        };

        next();
      } catch (error) {
        console.error('Cache middleware error:', error);
        next();
      }
    };
  }

  /**
   * Middleware to invalidate cache on data changes
   */
  invalidateCacheMiddleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      // Store original res.json to intercept response
      const originalJson = res.json;
      res.json = function(data: any) {
        // Only invalidate cache on successful operations
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const cacheService = new CacheService();
          
          // Clear banner cache for any banner-related operations
          if (req.originalUrl.includes('/banners')) {
            cacheService.clearBannerCache();
          }
        }
        
        return originalJson.call(this, data);
      };

      next();
    };
  }
}

export const cacheService = new CacheService();
export default cacheService;
