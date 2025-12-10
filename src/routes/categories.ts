import { Router, Request, Response } from 'express';
import Category from '../models/Category';
import { verifyToken, requireAdmin } from '../middleware/auth';
import { uploadSingle, handleUploadError } from '../middleware/upload';
import { uploadImage, deleteImage } from '../config/cloudinary';

const router = Router();

// @route   GET /api/categories
// @desc    Get all categories (public - active only, admin - all)
// @access  Public/Admin
router.get('/', async (req: Request, res: Response) => {
  try {
    const { admin, search, isActive, sortBy = 'sortOrder', sortOrder = 'asc' } = req.query;
    
    // Build filter object
    const filter: any = {};
    
    // If not admin, only show active categories
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

    const categories = await Category.find(filter)
      .sort(sort)
      .select('-__v');

    res.status(200).json({
      success: true,
      count: categories.length,
      data: categories
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching categories',
      error: process.env.NODE_ENV === 'development' ? error : 'Internal server error'
    });
  }
});

// @route   GET /api/categories/:slug
// @desc    Get single category by slug
// @access  Public
router.get('/:slug', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    
    const category = await Category.findOne({ 
      slug, 
      isActive: true 
    }).select('-__v');

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: category
    });
  } catch (error) {
    console.error('Error fetching category:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching category',
      error: process.env.NODE_ENV === 'development' ? error : 'Internal server error'
    });
  }
});

// @route   POST /api/categories
// @desc    Create new category with image upload
// @access  Private/Admin
router.post('/', 
  verifyToken, 
  requireAdmin, 
  uploadSingle, 
  handleUploadError,
  async (req: Request, res: Response) => {
    try {
      const categoryData = req.body;
      
      // Handle image upload if provided
      if (req.file) {
        try {
          const uploadResult = await uploadImage(req.file.buffer, {
            folder: 'fefa-jewelry/categories',
            public_id: `category-${Date.now()}`,
          });
          
          categoryData.image = uploadResult.secure_url;
        } catch (uploadError) {
          console.error('Image upload error:', uploadError);
          res.status(500).json({
            success: false,
            message: 'Failed to upload image',
            error: uploadError instanceof Error ? uploadError.message : 'Unknown error'
          });
          return;
        }
      } else {
        // If no image file, keep existing image or set to empty
        // This allows updating category without changing image
      }

      // Validate required fields
      if (!categoryData.name) {
        res.status(400).json({
          success: false,
          message: 'Category name is required'
        });
        return;
      }

      // Generate slug if not provided
      if (!categoryData.slug && categoryData.name) {
        categoryData.slug = categoryData.name
          .toLowerCase()
          .trim()
          .replace(/[^\w\s-]/g, '')
          .replace(/[\s_-]+/g, '-')
          .replace(/^-+|-+$/g, '');
      }

      const category = new Category(categoryData);
      await category.save();

      res.status(201).json({
        success: true,
        data: category
      });
    } catch (error: any) {
      console.error('Error creating category:', error);
      
      // Handle duplicate key error (unique constraint)
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        res.status(400).json({
          success: false,
          message: `Category with this ${field} already exists`
        });
        return;
      }
      
      res.status(500).json({
        success: false,
        message: 'Error creating category',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

// @route   PUT /api/categories/:id
// @desc    Update category with optional image upload
// @access  Private/Admin
router.put('/:id', 
  verifyToken, 
  requireAdmin, 
  uploadSingle, 
  handleUploadError,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const categoryData = req.body;
      
      // Handle image upload if provided
      if (req.file) {
        try {
          const uploadResult = await uploadImage(req.file.buffer, {
            folder: 'fefa-jewelry/categories',
            public_id: `category-${id}-${Date.now()}`,
          });
          
          categoryData.image = uploadResult.secure_url;
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
      if (categoryData.name && !categoryData.slug) {
        categoryData.slug = categoryData.name
          .toLowerCase()
          .trim()
          .replace(/[^\w\s-]/g, '')
          .replace(/[\s_-]+/g, '-')
          .replace(/^-+|-+$/g, '');
      }
      
      const category = await Category.findByIdAndUpdate(
        id,
        categoryData,
        { new: true, runValidators: true }
      );

      if (!category) {
        res.status(404).json({
          success: false,
          message: 'Category not found'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: category
      });
    } catch (error: any) {
      console.error('Error updating category:', error);
      
      // Handle duplicate key error (unique constraint)
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        res.status(400).json({
          success: false,
          message: `Category with this ${field} already exists`
        });
        return;
      }
      
      res.status(500).json({
        success: false,
        message: 'Error updating category',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

// @route   DELETE /api/categories/:id
// @desc    Delete category and its image from Cloudinary
// @access  Private/Admin
router.delete('/:id', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Find the category first to get image information
    const category = await Category.findById(id);

    if (!category) {
      res.status(404).json({
        success: false,
        message: 'Category not found'
      });
      return;
    }

    // Delete image from Cloudinary if it exists
    if (category.image) {
      try {
        // Extract publicId from Cloudinary URL
        let publicId: string | null = null;
        
        // Try to extract publicId from URL
        if (category.image) {
          const urlMatch = category.image.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
          if (urlMatch && urlMatch[1]) {
            publicId = urlMatch[1];
          }
        }
        
        // If we found a publicId, delete the image from Cloudinary
        if (publicId) {
          try {
            await deleteImage(publicId, { folder: 'fefa-jewelry/categories' });
          } catch (cloudinaryError) {
            console.error(`Failed to delete category image from Cloudinary:`, cloudinaryError);
            // Continue with deletion even if Cloudinary deletion fails
          }
        } else {
          console.warn(`Could not extract publicId from category image URL: ${category.image}`);
        }
      } catch (imageError) {
        console.error('Error processing category image deletion:', imageError);
        // Continue with deletion even if image processing fails
      }
    }

    // Now delete the category from database
    await Category.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Category and associated image deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting category',
      error: process.env.NODE_ENV === 'development' ? error : 'Internal server error'
    });
  }
});

export default router;
