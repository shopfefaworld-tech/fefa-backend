import { Router, Request, Response } from 'express';
import Collection from '../models/Collection';
import { verifyToken, requireAdmin } from '../middleware/auth';
import { uploadSingle, handleUploadError } from '../middleware/upload';
import { uploadImage, deleteImage } from '../config/cloudinary';

const router = Router();

// @route   GET /api/collections
// @desc    Get all collections (public - active only, admin - all)
// @access  Public/Admin
router.get('/', async (req: Request, res: Response) => {
  try {
    const { admin, search, isActive, sortBy = 'sortOrder', sortOrder = 'asc' } = req.query;
    
    // Build filter object
    const filter: any = {};
    
    // If not admin, only show active collections
    if (admin !== 'true') {
      filter.isActive = true;
    }
    
    // If admin and isActive filter is provided
    if (admin === 'true' && isActive !== undefined) {
      filter.isActive = isActive === 'true';
    }
    
    // Search filter
    if (search) {
      const searchRegex = new RegExp(search as string, 'i');
      filter.$or = [
        { name: { $regex: searchRegex } },
        { description: { $regex: searchRegex } }
      ];
    }

    // Build sort object
    const sort: any = {};
    sort[sortBy as string] = sortOrder === 'asc' ? 1 : -1;

    const collections = await Collection.find(filter)
      .sort(sort)
      .select('-__v');

    res.status(200).json({
      success: true,
      count: collections.length,
      data: collections
    });
  } catch (error) {
    console.error('Error fetching collections:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching collections',
      error: process.env.NODE_ENV === 'development' ? error : 'Internal server error'
    });
  }
});

// @route   GET /api/collections/:slug
// @desc    Get single collection by slug
// @access  Public
router.get('/:slug', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    
    const collection = await Collection.findOne({ 
      slug, 
      isActive: true 
    }).select('-__v');

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: collection
    });
  } catch (error) {
    console.error('Error fetching collection:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching collection',
      error: process.env.NODE_ENV === 'development' ? error : 'Internal server error'
    });
  }
});

// @route   GET /api/collections/id/:id
// @desc    Get single collection by ID
// @access  Private/Admin
router.get('/id/:id', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const collection = await Collection.findById(id).select('-__v');

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: collection
    });
  } catch (error) {
    console.error('Error fetching collection:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching collection',
      error: process.env.NODE_ENV === 'development' ? error : 'Internal server error'
    });
  }
});

// @route   POST /api/collections
// @desc    Create new collection with image upload
// @access  Private/Admin
router.post('/', 
  verifyToken, 
  requireAdmin, 
  uploadSingle, 
  handleUploadError,
  async (req: Request, res: Response) => {
    try {
      const collectionData = req.body;
      
      // Handle image upload if provided
      if (req.file) {
        try {
          const uploadResult = await uploadImage(req.file.buffer, {
            folder: 'fefa-jewelry/collections',
            public_id: `collection-${Date.now()}`,
          });
          
          collectionData.image = uploadResult.secure_url;
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

      // Validate required fields
      if (!collectionData.name) {
        res.status(400).json({
          success: false,
          message: 'Collection name is required'
        });
        return;
      }

      // Generate slug if not provided
      if (!collectionData.slug && collectionData.name) {
        collectionData.slug = collectionData.name
          .toLowerCase()
          .trim()
          .replace(/[^\w\s-]/g, '')
          .replace(/[\s_-]+/g, '-')
          .replace(/^-+|-+$/g, '');
      }

      const collection = new Collection(collectionData);
      await collection.save();

      res.status(201).json({
        success: true,
        data: collection
      });
    } catch (error: any) {
      console.error('Error creating collection:', error);
      
      // Handle duplicate key error (unique constraint)
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        res.status(400).json({
          success: false,
          message: `Collection with this ${field} already exists`
        });
        return;
      }
      
      res.status(500).json({
        success: false,
        message: 'Error creating collection',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

// @route   PUT /api/collections/:id
// @desc    Update collection with optional image upload
// @access  Private/Admin
router.put('/:id', 
  verifyToken, 
  requireAdmin, 
  uploadSingle, 
  handleUploadError,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const collectionData = req.body;
      
      // Handle image upload if provided
      if (req.file) {
        try {
          const uploadResult = await uploadImage(req.file.buffer, {
            folder: 'fefa-jewelry/collections',
            public_id: `collection-${id}-${Date.now()}`,
          });
          
          collectionData.image = uploadResult.secure_url;
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

      // Generate slug if name changed and slug not provided
      if (collectionData.name && !collectionData.slug) {
        collectionData.slug = collectionData.name
          .toLowerCase()
          .trim()
          .replace(/[^\w\s-]/g, '')
          .replace(/[\s_-]+/g, '-')
          .replace(/^-+|-+$/g, '');
      }
      
      const collection = await Collection.findByIdAndUpdate(
        id,
        collectionData,
        { new: true, runValidators: true }
      );

      if (!collection) {
        res.status(404).json({
          success: false,
          message: 'Collection not found'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: collection
      });
    } catch (error: any) {
      console.error('Error updating collection:', error);
      
      // Handle duplicate key error (unique constraint)
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        res.status(400).json({
          success: false,
          message: `Collection with this ${field} already exists`
        });
        return;
      }
      
      res.status(500).json({
        success: false,
        message: 'Error updating collection',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

// @route   DELETE /api/collections/:id
// @desc    Delete collection and its image from Cloudinary
// @access  Private/Admin
router.delete('/:id', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Find the collection first to get image information
    const collection = await Collection.findById(id);

    if (!collection) {
      res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
      return;
    }

    // Delete image from Cloudinary if it exists
    if (collection.image) {
      try {
        // Extract publicId from Cloudinary URL
        let publicId: string | null = null;
        
        // Try to extract publicId from URL
        if (collection.image) {
          const urlMatch = collection.image.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
          if (urlMatch && urlMatch[1]) {
            publicId = urlMatch[1];
          }
        }
        
        // If we found a publicId, delete the image from Cloudinary
        if (publicId) {
          try {
            await deleteImage(publicId, { folder: 'fefa-jewelry/collections' });
          } catch (cloudinaryError) {
            console.error(`Failed to delete collection image from Cloudinary:`, cloudinaryError);
            // Continue with deletion even if Cloudinary deletion fails
          }
        } else {
          console.warn(`Could not extract publicId from collection image URL: ${collection.image}`);
        }
      } catch (imageError) {
        console.error('Error processing collection image deletion:', imageError);
        // Continue with deletion even if image processing fails
      }
    }

    // Now delete the collection from database
    await Collection.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Collection and associated image deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting collection:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting collection',
      error: process.env.NODE_ENV === 'development' ? error : 'Internal server error'
    });
  }
});

export default router;

