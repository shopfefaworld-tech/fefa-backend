import { cacheService } from '../middleware/cache';

export class BannerCacheManager {
  /**
   * Clear all banner-related cache
   */
  static async clearAllBannerCache(): Promise<void> {
    try {
      await cacheService.clearBannerCache();
    } catch (error) {
      console.error('❌ Error clearing banner cache:', error);
    }
  }

  /**
   * Clear cache for specific banner
   */
  static async clearBannerCache(bannerId: string): Promise<void> {
    try {
      const patterns = [
        `banner:${bannerId}`,
        `banner:${bannerId}:clicks`,
        `banner:${bannerId}:impressions`,
        `GET:/api/banners/${bannerId}*`
      ];

      for (const pattern of patterns) {
        await cacheService.del(pattern);
      }
    } catch (error) {
      console.error(`❌ Error clearing cache for banner ${bannerId}:`, error);
    }
  }

  /**
   * Warm up cache with banner data
   */
  static async warmUpBannerCache(bannerId: string): Promise<void> {
    try {
      const Banner = require('../models/Banner').default;
      const banner = await Banner.findById(bannerId);
      
      if (banner) {
        await cacheService.set(`banner:${bannerId}`, banner, 600);
      }
    } catch (error) {
      console.error(`❌ Error warming up cache for banner ${bannerId}:`, error);
    }
  }

  /**
   * Get banner analytics from cache
   */
  static async getBannerAnalytics(bannerId: string): Promise<{
    clicks: number;
    impressions: number;
  }> {
    try {
      const clicks = await cacheService.get(`banner:${bannerId}:clicks`) || 0;
      const impressions = await cacheService.get(`banner:${bannerId}:impressions`) || 0;
      
      return { clicks, impressions };
    } catch (error) {
      console.error(`❌ Error getting analytics for banner ${bannerId}:`, error);
      return { clicks: 0, impressions: 0 };
    }
  }

  /**
   * Sync analytics from cache to database
   */
  static async syncAnalyticsToDatabase(bannerId: string): Promise<void> {
    try {
      const analytics = await this.getBannerAnalytics(bannerId);
      
      if (analytics.clicks > 0 || analytics.impressions > 0) {
        const Banner = require('../models/Banner').default;
        await Banner.findByIdAndUpdate(bannerId, {
          $inc: {
            clicks: analytics.clicks,
            impressions: analytics.impressions
          }
        });

        // Clear analytics cache after sync
        await cacheService.del(`banner:${bannerId}:clicks`);
        await cacheService.del(`banner:${bannerId}:impressions`);
      }
    } catch (error) {
      console.error(`❌ Error syncing analytics for banner ${bannerId}:`, error);
    }
  }

  /**
   * Schedule periodic cache cleanup
   */
  static scheduleCacheCleanup(): void {
    // Clean up expired cache entries every hour
    setInterval(async () => {
      try {
        // Redis automatically handles TTL, but we can add custom cleanup logic here
      } catch (error) {
        console.error('❌ Cache cleanup error:', error);
      }
    }, 3600000); // 1 hour
  }
}

export default BannerCacheManager;
