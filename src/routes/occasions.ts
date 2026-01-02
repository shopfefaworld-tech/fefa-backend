import { Router, Request, Response } from 'express';
import Occasion from '../models/Occasion';
import { verifyToken, requireAdmin } from '../middleware/auth';
import { uploadSingle, handleUploadError } from '../middleware/upload';
import { uploadImage, deleteImage } from '../config/cloudinary';

const router = Router();

// @route   GET /api/occasions
// @desc    Get all occasions (public - active only, admin - all)
// @access  Public/Admin
router.get('/', async (req: Request, res: Response) => {
  try {
    const { admin, search, isActive, sortBy = 'sortOrder', sortOrder = 'asc' } = req.query;
    
    // Build filter object
    const filter: any = {};
    
    // If not admin, only show active occasions
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
        { value: { $regex: searchRegex } },
        { description: { $regex: searchRegex } }
      ];
    }

    // Build sort object
    const sort: any = {};
    sort[sortBy as string] = sortOrder === 'asc' ? 1 : -1;

    const occasions = await Occasion.find(filter)
      .sort(sort)
      .select('-__v')
      .lean();

    res.status(200).json({
      success: true,
      count: occasions.length,
      data: occasions || []
    });
  } catch (error) {
    console.error('Error fetching occasions:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching occasions',
      error: process.env.NODE_ENV === 'development' ? error : 'Internal server error'
    });
  }
});

// @route   GET /api/occasions/:value
// @desc    Get single occasion by value (slug)
// @access  Public
router.get('/:value', async (req: Request, res: Response) => {
  try {
    const { value } = req.params;
    
    const occasion = await Occasion.findOne({ 
      value, 
      isActive: true 
    }).select('-__v');

    if (!occasion) {
      return res.status(404).json({
        success: false,
        message: 'Occasion not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: occasion
    });
  } catch (error) {
    console.error('Error fetching occasion:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching occasion',
      error: process.env.NODE_ENV === 'development' ? error : 'Internal server error'
    });
  }
});

// @route   GET /api/occasions/id/:id
// @desc    Get single occasion by ID
// @access  Private/Admin
router.get('/id/:id', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const occasion = await Occasion.findById(id).select('-__v');

    if (!occasion) {
      return res.status(404).json({
        success: false,
        message: 'Occasion not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: occasion
    });
  } catch (error) {
    console.error('Error fetching occasion:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching occasion',
      error: process.env.NODE_ENV === 'development' ? error : 'Internal server error'
    });
  }
});

// @route   POST /api/occasions
// @desc    Create new occasion with image upload
// @access  Private/Admin
router.post('/', 
  verifyToken, 
  requireAdmin, 
  uploadSingle, 
  handleUploadError,
  async (req: Request, res: Response) => {
    try {
      const occasionData = req.body;
      
      // Handle image upload if provided
      if (req.file) {
        try {
          const uploadResult = await uploadImage(req.file.buffer, {
            folder: 'fefa-jewelry/occasions',
            public_id: `occasion-${Date.now()}`,
          });
          
          occasionData.image = uploadResult.secure_url;
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
      if (!occasionData.name) {
        res.status(400).json({
          success: false,
          message: 'Occasion name is required'
        });
        return;
      }

      // Generate value (slug) if not provided
      if (!occasionData.value && occasionData.name) {
        occasionData.value = occasionData.name
          .toLowerCase()
          .trim()
          .replace(/[^\w\s-]/g, '')
          .replace(/[\s_-]+/g, '-')
          .replace(/^-+|-+$/g, '');
      }

      const occasion = new Occasion(occasionData);
      await occasion.save();

      res.status(201).json({
        success: true,
        data: occasion
      });
    } catch (error: any) {
      console.error('Error creating occasion:', error);
      
      // Handle duplicate key error (unique constraint)
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        res.status(400).json({
          success: false,
          message: `Occasion with this ${field} already exists`
        });
        return;
      }
      
      res.status(500).json({
        success: false,
        message: 'Error creating occasion',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

// @route   PUT /api/occasions/:id
// @desc    Update occasion with optional image upload
// @access  Private/Admin
router.put('/:id', 
  verifyToken, 
  requireAdmin, 
  uploadSingle, 
  handleUploadError,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const occasionData = req.body;
      
      // Handle image upload if provided
      if (req.file) {
        try {
          const uploadResult = await uploadImage(req.file.buffer, {
            folder: 'fefa-jewelry/occasions',
            public_id: `occasion-${id}-${Date.now()}`,
          });
          
          occasionData.image = uploadResult.secure_url;
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

      // Generate value (slug) if name changed and value not provided
      if (occasionData.name && !occasionData.value) {
        occasionData.value = occasionData.name
          .toLowerCase()
          .trim()
          .replace(/[^\w\s-]/g, '')
          .replace(/[\s_-]+/g, '-')
          .replace(/^-+|-+$/g, '');
      }
      
      const occasion = await Occasion.findByIdAndUpdate(
        id,
        occasionData,
        { new: true, runValidators: true }
      );

      if (!occasion) {
        res.status(404).json({
          success: false,
          message: 'Occasion not found'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: occasion
      });
    } catch (error: any) {
      console.error('Error updating occasion:', error);
      
      // Handle duplicate key error (unique constraint)
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        res.status(400).json({
          success: false,
          message: `Occasion with this ${field} already exists`
        });
        return;
      }
      
      res.status(500).json({
        success: false,
        message: 'Error updating occasion',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

// @route   DELETE /api/occasions/:id
// @desc    Delete occasion and its image from Cloudinary
// @access  Private/Admin
router.delete('/:id', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Find the occasion first to get image information
    const occasion = await Occasion.findById(id);

    if (!occasion) {
      res.status(404).json({
        success: false,
        message: 'Occasion not found'
      });
      return;
    }

    // Delete image from Cloudinary if it exists
    if (occasion.image) {
      try {
        // Extract publicId from Cloudinary URL
        let publicId: string | null = null;
        
        // Try to extract publicId from URL
        if (occasion.image) {
          const urlMatch = occasion.image.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
          if (urlMatch && urlMatch[1]) {
            publicId = urlMatch[1];
          }
        }
        
        // If we found a publicId, delete the image from Cloudinary
        if (publicId) {
          try {
            await deleteImage(publicId, { folder: 'fefa-jewelry/occasions' });
          } catch (cloudinaryError) {
            console.error(`Failed to delete occasion image from Cloudinary:`, cloudinaryError);
            // Continue with deletion even if Cloudinary deletion fails
          }
        } else {
          console.warn(`Could not extract publicId from occasion image URL: ${occasion.image}`);
        }
      } catch (imageError) {
        console.error('Error processing occasion image deletion:', imageError);
        // Continue with deletion even if image processing fails
      }
    }

    // Now delete the occasion from database
    await Occasion.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Occasion and associated image deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting occasion:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting occasion',
      error: process.env.NODE_ENV === 'development' ? error : 'Internal server error'
    });
  }
});

// @route   POST /api/occasions/migrate
// @desc    Migrate occasions from JSON file to database
// @access  Private/Admin
router.post('/migrate', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const fs = require('fs');
    const path = require('path');
    
    // Read occasions from JSON file
    const occasionsPath = path.join(__dirname, '../data/collections-occasions.json');
    const occasionsData = JSON.parse(fs.readFileSync(occasionsPath, 'utf-8'));
    
    // Filter out "All Occasions" option
    const occasionsToMigrate = occasionsData.filter((occ: any) => occ.value !== 'all');
    
    let created = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const occasionData of occasionsToMigrate) {
      try {
        // Check if occasion already exists
        const existing = await Occasion.findOne({ value: occasionData.value });
        
        if (existing) {
          skipped++;
          continue;
        }
        
        // Create new occasion
        const occasion = new Occasion({
          name: occasionData.name,
          value: occasionData.value,
          image: occasionData.image || undefined,
          isActive: true,
          sortOrder: 0,
        });
        
        await occasion.save();
        created++;
      } catch (error: any) {
        console.error(`Error migrating occasion ${occasionData.name}:`, error);
        errors++;
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Migration completed',
      data: {
        created,
        skipped,
        errors,
        total: occasionsToMigrate.length
      }
    });
  } catch (error) {
    console.error('Error migrating occasions:', error);
    res.status(500).json({
      success: false,
      message: 'Error migrating occasions',
      error: process.env.NODE_ENV === 'development' ? error : 'Internal server error'
    });
  }
});

export default router;
