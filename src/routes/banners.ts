import { Router, Request, Response } from 'express';
import Banner from '../models/Banner';
import { cacheService } from '../middleware/cache';
import { 
  generalRateLimit, 
  bannerAnalyticsRateLimit, 
  adminRateLimit,
  bannerInteractionRateLimit 
} from '../middleware/rateLimiter';
import { uploadSingle, handleUploadError } from '../middleware/upload';
import { uploadImage, deleteImage } from '../config/cloudinary';

const router = Router();

// @route   GET /api/banners
// @desc    Get all banners
// @access  Public
router.get('/', 
  generalRateLimit,
  cacheService.cacheMiddleware({ ttl: 300 }), // Cache for 5 minutes
  async (req: Request, res: Response) => {
    try {
      const banners = await Banner.find({ isActive: true })
        .sort({ sortOrder: 1, createdAt: -1 })
        .select('-__v');

      res.status(200).json({
        success: true,
        count: banners.length,
        data: banners
      });
    } catch (error) {
      console.error('Error fetching banners:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching banners',
        error: process.env.NODE_ENV === 'development' ? error : 'Internal server error'
      });
    }
  }
);

// @route   GET /api/banners/active
// @desc    Get active banners (with date filtering)
// @access  Public
router.get('/active', 
  generalRateLimit,
  cacheService.cacheMiddleware({ ttl: 180 }), // Cache for 3 minutes (shorter due to date filtering)
  async (req: Request, res: Response) => {
    try {
      const banners = await (Banner as any).getActiveBanners();

      return res.status(200).json({
        success: true,
        count: banners.length,
        data: banners
      });
    } catch (error) {
      console.error('Error fetching active banners:', error);
      return res.status(500).json({
        success: false,
        message: 'Error fetching active banners',
        error: process.env.NODE_ENV === 'development' ? error : 'Internal server error'
      });
    }
  }
);

// @route   GET /api/banners/:id
// @desc    Get single banner by ID
// @access  Public
router.get('/:id', 
  generalRateLimit,
  cacheService.cacheMiddleware({ ttl: 600 }), // Cache for 10 minutes
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const banner = await Banner.findById(id).select('-__v');

      if (!banner) {
        return res.status(404).json({
          success: false,
          message: 'Banner not found'
        });
      }

      return res.status(200).json({
        success: true,
        data: banner
      });
    } catch (error) {
      console.error('Error fetching banner:', error);
      return res.status(500).json({
        success: false,
        message: 'Error fetching banner',
        error: process.env.NODE_ENV === 'development' ? error : 'Internal server error'
      });
    }
  }
);

// @route   POST /api/banners
// @desc    Create new banner with image upload
// @access  Private/Admin
router.post('/', 
  adminRateLimit,
  uploadSingle,
  handleUploadError,
  cacheService.invalidateCacheMiddleware(),
  async (req: Request, res: Response) => {
    try {
      const bannerData = req.body;
      
      // Handle image upload if provided
      if (req.file) {
        try {
          const uploadResult = await uploadImage(req.file.buffer, {
            folder: 'fefa-jewelry/banners',
            public_id: `banner-${Date.now()}`,
          });
          
          bannerData.image = uploadResult.secure_url;
        } catch (uploadError) {
          console.error('Image upload error:', uploadError);
          return res.status(500).json({
            success: false,
            message: 'Failed to upload image',
            error: uploadError instanceof Error ? uploadError.message : 'Unknown error'
          });
        }
      }

      // Validate required fields
      if (!bannerData.title || !bannerData.image) {
        return res.status(400).json({
          success: false,
          message: 'Title and image are required'
        });
      }

      const banner = new Banner(bannerData);
      await banner.save();

      return res.status(201).json({
        success: true,
        data: banner
      });
    } catch (error) {
      console.error('Error creating banner:', error);
      return res.status(500).json({
        success: false,
        message: 'Error creating banner',
        error: process.env.NODE_ENV === 'development' ? error : 'Internal server error'
      });
    }
  }
);

// @route   PUT /api/banners/:id
// @desc    Update banner with optional image upload
// @access  Private/Admin
router.put('/:id', 
  adminRateLimit,
  uploadSingle,
  handleUploadError,
  cacheService.invalidateCacheMiddleware(),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const bannerData = req.body;
      
      // Handle image upload if provided
      if (req.file) {
        try {
          const uploadResult = await uploadImage(req.file.buffer, {
            folder: 'fefa-jewelry/banners',
            public_id: `banner-${id}-${Date.now()}`,
          });
          
          bannerData.image = uploadResult.secure_url;
        } catch (uploadError) {
          console.error('Image upload error:', uploadError);
          res.status(500).json({
            success: false,
            message: 'Failed to upload image',
            error: uploadError instanceof Error ? uploadError.message : 'Unknown error'
          });
          return;
        }
      }
      
      const banner = await Banner.findByIdAndUpdate(
        id,
        bannerData,
        { new: true, runValidators: true }
      );

      if (!banner) {
        res.status(404).json({
          success: false,
          message: 'Banner not found'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: banner
      });
    } catch (error) {
      console.error('Error updating banner:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating banner',
        error: process.env.NODE_ENV === 'development' ? error : 'Internal server error'
      });
    }
  }
);

// @route   DELETE /api/banners/:id
// @desc    Delete banner and its image from Cloudinary
// @access  Private/Admin
router.delete('/:id', 
  adminRateLimit,
  cacheService.invalidateCacheMiddleware(),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // Find the banner first to get image information
      const banner = await Banner.findById(id);

      if (!banner) {
        res.status(404).json({
          success: false,
          message: 'Banner not found'
        });
        return;
      }

      // Delete image from Cloudinary if it exists
      if (banner.image) {
        try {
          // Extract publicId from Cloudinary URL
          let publicId: string | null = null;
          
          // Try to extract publicId from URL
          if (banner.image) {
            const urlMatch = banner.image.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
            if (urlMatch && urlMatch[1]) {
              publicId = urlMatch[1];
            }
          }
          
          // If we found a publicId, delete the image from Cloudinary
          if (publicId) {
            try {
              await deleteImage(publicId, { folder: 'fefa-jewelry/banners' });
            } catch (cloudinaryError) {
              console.error(`Failed to delete banner image from Cloudinary:`, cloudinaryError);
              // Continue with deletion even if Cloudinary deletion fails
            }
          } else {
            console.warn(`Could not extract publicId from banner image URL: ${banner.image}`);
          }
        } catch (imageError) {
          console.error('Error processing banner image deletion:', imageError);
          // Continue with deletion even if image processing fails
        }
      }

      // Now delete the banner from database
      await Banner.findByIdAndDelete(id);

      res.status(200).json({
        success: true,
        message: 'Banner and associated image deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting banner:', error);
      res.status(500).json({
        success: false,
        message: 'Error deleting banner',
        error: process.env.NODE_ENV === 'development' ? error : 'Internal server error'
      });
    }
  }
);

// @route   POST /api/banners/:id/click
// @desc    Track banner click
// @access  Public
router.post('/:id/click', 
  bannerInteractionRateLimit,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // Check if banner exists (with caching)
      const cacheKey = `banner:${id}`;
      let banner = await cacheService.get(cacheKey);
      
      if (!banner) {
        banner = await Banner.findById(id);
        if (banner) {
          await cacheService.set(cacheKey, banner, 600); // Cache for 10 minutes
        }
      }

      if (!banner) {
        return res.status(404).json({
          success: false,
          message: 'Banner not found'
        });
      }

      // Increment clicks with caching
      const clickCacheKey = `banner:${id}:clicks`;
      const currentClicks = await cacheService.get(clickCacheKey) || 0;
      await cacheService.set(clickCacheKey, currentClicks + 1, 3600); // Cache for 1 hour

      // Update database (async, non-blocking)
      (banner as any).incrementClicks().catch((error: any) => {
        console.error('Error updating banner clicks in database:', error);
      });

      return res.status(200).json({
        success: true,
        message: 'Click tracked successfully'
      });
    } catch (error) {
      console.error('Error tracking banner click:', error);
      return res.status(500).json({
        success: false,
        message: 'Error tracking banner click',
        error: process.env.NODE_ENV === 'development' ? error : 'Internal server error'
      });
    }
  }
);

// @route   POST /api/banners/:id/impression
// @desc    Track banner impression
// @access  Public
router.post('/:id/impression', 
  bannerInteractionRateLimit,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // Check if banner exists (with caching)
      const cacheKey = `banner:${id}`;
      let banner = await cacheService.get(cacheKey);
      
      if (!banner) {
        banner = await Banner.findById(id);
        if (banner) {
          await cacheService.set(cacheKey, banner, 600); // Cache for 10 minutes
        }
      }

      if (!banner) {
        return res.status(404).json({
          success: false,
          message: 'Banner not found'
        });
      }

      // Increment impressions with caching
      const impressionCacheKey = `banner:${id}:impressions`;
      const currentImpressions = await cacheService.get(impressionCacheKey) || 0;
      await cacheService.set(impressionCacheKey, currentImpressions + 1, 3600); // Cache for 1 hour

      // Update database (async, non-blocking)
      (banner as any).incrementImpressions().catch((error: any) => {
        console.error('Error updating banner impressions in database:', error);
      });

      return res.status(200).json({
        success: true,
        message: 'Impression tracked successfully'
      });
    } catch (error) {
      console.error('Error tracking banner impression:', error);
      return res.status(500).json({
        success: false,
        message: 'Error tracking banner impression',
        error: process.env.NODE_ENV === 'development' ? error : 'Internal server error'
      });
    }
  }
);

export default router;
