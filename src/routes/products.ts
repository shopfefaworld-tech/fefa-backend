import { Router, Request, Response } from 'express';
import Product, { IProduct } from '../models/Product';
import Category from '../models/Category';
import { errorHandler } from '../middleware/errorHandler';
import { verifyToken, requireAdmin } from '../middleware/auth';
import { uploadMultiple, handleUploadError } from '../middleware/upload';
import { uploadImage, deleteImage } from '../config/cloudinary';

const router = Router();

// Test endpoint for products - GET and POST (no auth required)
// IMPORTANT: Must come BEFORE GET /:id to avoid route conflicts
router.get('/test', async (req: Request, res: Response) => {
  try {
    res.status(200).json({
      success: true,
      message: '✅ Test is successful! Products GET test endpoint is working correctly.',
      test: 'products-get',
      method: req.method,
      origin: req.headers.origin,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '❌ Test failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/test', async (req: Request, res: Response) => {
  try {
    res.status(200).json({
      success: true,
      message: '✅ Test is successful! Products POST endpoint is working correctly.',
      test: 'products-post',
      method: req.method,
      origin: req.headers.origin,
      contentType: req.headers['content-type'],
      hasBody: !!req.body,
      hasFiles: !!(req as any).files,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '❌ Test failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.options('/test', (req: Request, res: Response) => {
  res.status(204).end();
});

// @route   POST /api/products
// @desc    Create product with image uploads
// @access  Private/Admin
// IMPORTANT: This must come BEFORE GET /:id to avoid route conflicts
router.post('/', 
  verifyToken, 
  requireAdmin, 
  uploadMultiple, 
  handleUploadError,
  async (req: Request, res: Response) => {
    try {
      const productData = req.body;
      
      // Validate required fields
      const requiredFields = ['name', 'slug', 'description', 'sku', 'price', 'category'];
      for (const field of requiredFields) {
        if (!productData[field]) {
          return res.status(400).json({
            success: false,
            message: `${field} is required`
          });
        }
      }

      // Check if product with same slug or SKU already exists
      const existingProduct = await Product.findOne({
        $or: [
          { slug: productData.slug },
          { sku: productData.sku }
        ]
      });

      if (existingProduct) {
        return res.status(400).json({
          success: false,
          message: 'Product with this slug or SKU already exists'
        });
      }

      // Validate category exists
      const category = await Category.findById(productData.category);
      if (!category) {
        return res.status(400).json({
          success: false,
          message: 'Category not found'
        });
      }

      // Handle image uploads
      let uploadedImages: any[] = [];
      if (req.files && Array.isArray(req.files) && req.files.length > 0) {
        try {
          // Upload each image to Cloudinary
          for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            const uploadResult = await uploadImage(file.buffer, {
              folder: 'fefa-jewelry/products',
              public_id: `${productData.slug}-${i + 1}`,
            });
            
            uploadedImages.push({
              url: uploadResult.secure_url,
              publicId: uploadResult.public_id,
              alt: productData.name || `Product image ${i + 1}`,
              isPrimary: i === 0, // First image is primary
              sortOrder: i + 1
            });
          }
        } catch (uploadError) {
          console.error('Image upload error:', uploadError);
          return res.status(500).json({
            success: false,
            message: 'Failed to upload images',
            error: uploadError instanceof Error ? uploadError.message : 'Unknown error'
          });
        }
      }

      // Add images to product data
      if (uploadedImages.length > 0) {
        productData.images = uploadedImages;
      }

      // Parse JSON fields if they're strings
      if (typeof productData.variants === 'string') {
        try {
          productData.variants = JSON.parse(productData.variants);
        } catch (e) {
          productData.variants = [];
        }
      }
      
      if (typeof productData.specifications === 'string') {
        try {
          productData.specifications = JSON.parse(productData.specifications);
        } catch (e) {
          productData.specifications = [];
        }
      }

      // Handle tags - can be string (comma-separated), JSON string (array), or already an array
      if (typeof productData.tags === 'string') {
        try {
          // Try to parse as JSON first (in case it's a stringified array from frontend)
          const parsed = JSON.parse(productData.tags);
          if (Array.isArray(parsed)) {
            productData.tags = parsed.filter(Boolean);
          } else {
            // If not an array, treat as comma-separated string
            productData.tags = productData.tags.split(',').map((tag: string) => tag.trim()).filter(Boolean);
          }
        } catch (e) {
          // If JSON parse fails, treat as comma-separated string
          productData.tags = productData.tags.split(',').map((tag: string) => tag.trim()).filter(Boolean);
        }
      } else if (Array.isArray(productData.tags)) {
        // Already an array, just filter
        productData.tags = productData.tags.filter(Boolean);
      } else {
        productData.tags = [];
      }

      // Parse inventory if it's a string
      if (typeof productData.inventory === 'string') {
        try {
          productData.inventory = JSON.parse(productData.inventory);
        } catch (e) {
          productData.inventory = {
            trackQuantity: true,
            quantity: parseInt(productData.quantity) || 0,
            lowStockThreshold: 5,
            allowBackorder: false
          };
        }
      }

      // Handle nested inventory fields from FormData (e.g., 'inventory.quantity')
      if (productData['inventory.quantity'] !== undefined) {
        productData.inventory = {
          trackQuantity: true,
          quantity: parseInt(productData['inventory.quantity']) || 0,
          lowStockThreshold: 5,
          allowBackorder: false
        };
        delete productData['inventory.quantity'];
      }

      // Parse numeric fields from FormData (they come as strings)
      if (productData.price !== undefined) {
        productData.price = parseFloat(productData.price) || 0;
      }
      if (productData.comparePrice !== undefined && productData.comparePrice !== '') {
        productData.comparePrice = parseFloat(productData.comparePrice) || 0;
      }
      if (productData.costPrice !== undefined && productData.costPrice !== '') {
        productData.costPrice = parseFloat(productData.costPrice) || 0;
      }
      if (productData.weight !== undefined && productData.weight !== '') {
        productData.weight = parseFloat(productData.weight) || 0;
      }

      // Parse dimensions if it's a string (JSON) or if individual fields exist
      if (typeof productData.dimensions === 'string') {
        try {
          productData.dimensions = JSON.parse(productData.dimensions);
        } catch (e) {
          productData.dimensions = undefined;
        }
      } else if (productData.length !== undefined || productData.width !== undefined || productData.height !== undefined) {
        productData.dimensions = {
          length: productData.length ? parseFloat(productData.length) || 0 : 0,
          width: productData.width ? parseFloat(productData.width) || 0 : 0,
          height: productData.height ? parseFloat(productData.height) || 0 : 0,
          unit: productData.dimensionUnit || 'cm'
        };
        delete productData.length;
        delete productData.width;
        delete productData.height;
        delete productData.dimensionUnit;
      }

      // Parse boolean fields from FormData (they come as strings)
      if (productData.isActive !== undefined) {
        productData.isActive = productData.isActive === 'true' || productData.isActive === true;
      } else {
        productData.isActive = true; // Default to true if not provided
      }
      
      if (productData.isFeatured !== undefined) {
        productData.isFeatured = productData.isFeatured === 'true' || productData.isFeatured === true;
      } else {
        productData.isFeatured = false;
      }
      
      if (productData.isDigital !== undefined) {
        productData.isDigital = productData.isDigital === 'true' || productData.isDigital === true;
      } else {
        productData.isDigital = false;
      }

      // Create the product
      const product = new Product(productData);
      await product.save();

      // Populate category and subcategory for response
      await product.populate('category', 'name slug');
      await product.populate('subcategory', 'name slug');

      return res.status(201).json({
        success: true,
        data: product,
        message: 'Product created successfully'
      });
    } catch (error) {
      console.error('Error creating product:', error);
      return res.status(500).json({
        success: false,
        message: 'Error creating product',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

// @route   GET /api/products
// @desc    Get all products with filtering, sorting, and pagination
// @access  Public/Admin
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      minPrice,
      maxPrice,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      search,
      isActive = 'true',
      isFeatured,
      admin
    } = req.query;

    // Build filter object
    const filter: any = {};
    const andConditions: any[] = [];
    
    // If not admin, only show active products
    // Handle both boolean true and string 'true' for backward compatibility
    if (admin !== 'true') {
      filter.$or = [
        { isActive: true },
        { isActive: 'true' }
      ];
    } else if (isActive !== undefined) {
      if (isActive === 'true') {
        filter.$or = [
          { isActive: true },
          { isActive: 'true' }
        ];
      } else {
        filter.$or = [
          { isActive: false },
          { isActive: 'false' }
        ];
      }
    }
    
    
    if (isFeatured === 'true') {
      filter.isFeatured = true;
    }
    
    if (category) {
      // Find category by slug or name
      const categoryDoc = await Category.findOne({
        $or: [
          { slug: category },
          { name: { $regex: category, $options: 'i' } }
        ]
      });
      
      
      if (categoryDoc) {
        filter.category = categoryDoc._id;
      }
    }
    
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
      
    }
    
    if (search) {
      const searchRegex = new RegExp(search as string, 'i');
      // If we already have $or for isActive, we need to use $and
      if (filter.$or) {
        andConditions.push({ $or: filter.$or });
        delete filter.$or;
        andConditions.push({
          $or: [
            { name: { $regex: searchRegex } },
            { description: { $regex: searchRegex } },
            { tags: { $in: [searchRegex] } }
          ]
        });
        filter.$and = andConditions;
      } else {
        filter.$or = [
          { name: { $regex: searchRegex } },
          { description: { $regex: searchRegex } },
          { tags: { $in: [searchRegex] } }
        ];
      }
    }

    // Build sort object
    const sort: any = {};
    sort[sortBy as string] = sortOrder === 'desc' ? -1 : 1;

    // Calculate pagination
    const skip = (Number(page) - 1) * Number(limit);

    // Execute query
    const products = await Product.find(filter)
      .populate('category', 'name slug')
      .populate('subcategory', 'name slug')
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const total = await Product.countDocuments(filter);

    return res.json({
      success: true,
      data: products,
      pagination: {
        currentPage: Number(page),
        totalPages: Math.ceil(total / Number(limit)),
        totalProducts: total,
        hasNextPage: skip + Number(limit) < total,
        hasPrevPage: Number(page) > 1
      }
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching products',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// @route   GET /api/products/:id
// @desc    Get single product by ID or slug
// @access  Public
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    let product = null;
    
    // Try to find by ID first (only if it's a valid ObjectId)
    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      product = await Product.findById(id)
        .populate('category', 'name slug')
        .populate('subcategory', 'name slug')
        .lean();
    }

    // If not found by ID or ID is not valid ObjectId, try by slug
    if (!product) {
      product = await Product.findOne({ slug: id })
        .populate('category', 'name slug')
        .populate('subcategory', 'name slug')
        .lean();
    }

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    return res.json({
      success: true,
      data: product
    });
  } catch (error) {
    console.error('Error fetching product:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching product',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// @route   GET /api/products/category/:category
// @desc    Get products by category
// @access  Public
router.get('/category/:category', async (req: Request, res: Response) => {
  try {
    const { category } = req.params;
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Find category by slug or name
    const categoryDoc = await Category.findOne({
      $or: [
        { slug: category },
        { name: { $regex: category, $options: 'i' } }
      ]
    });

    if (!categoryDoc) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Build sort object
    const sort: any = {};
    sort[sortBy as string] = sortOrder === 'desc' ? -1 : 1;

    // Calculate pagination
    const skip = (Number(page) - 1) * Number(limit);

    // Execute query
    const products = await Product.find({
      category: categoryDoc._id,
      isActive: true
    })
      .populate('category', 'name slug')
      .populate('subcategory', 'name slug')
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const total = await Product.countDocuments({
      category: categoryDoc._id,
      isActive: true
    });

    return res.json({
      success: true,
      data: products,
      category: categoryDoc,
      pagination: {
        currentPage: Number(page),
        totalPages: Math.ceil(total / Number(limit)),
        totalProducts: total,
        hasNextPage: skip + Number(limit) < total,
        hasPrevPage: Number(page) > 1
      }
    });
  } catch (error) {
    console.error('Error fetching products by category:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching products by category',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// @route   GET /api/products/search
// @desc    Search products
// @access  Public
router.get('/search', async (req: Request, res: Response) => {
  try {
    const {
      q: query,
      page = 1,
      limit = 20,
      category,
      minPrice,
      maxPrice,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    if (!query) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    // Build filter object
    const queryRegex = new RegExp(query as string, 'i');
    const filter: any = {
      isActive: true,
      $or: [
        { name: { $regex: queryRegex } },
        { description: { $regex: queryRegex } },
        { tags: { $in: [queryRegex] } }
      ]
    };
    
    if (category) {
      const categoryDoc = await Category.findOne({
        $or: [
          { slug: category },
          { name: { $regex: category, $options: 'i' } }
        ]
      });
      
      if (categoryDoc) {
        filter.category = categoryDoc._id;
      }
    }
    
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }

    // Build sort object
    const sort: any = {};
    sort[sortBy as string] = sortOrder === 'desc' ? -1 : 1;

    // Calculate pagination
    const skip = (Number(page) - 1) * Number(limit);

    // Execute query
    const products = await Product.find(filter)
      .populate('category', 'name slug')
      .populate('subcategory', 'name slug')
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const total = await Product.countDocuments(filter);

    return res.json({
      success: true,
      data: products,
      query,
      pagination: {
        currentPage: Number(page),
        totalPages: Math.ceil(total / Number(limit)),
        totalProducts: total,
        hasNextPage: skip + Number(limit) < total,
        hasPrevPage: Number(page) > 1
      }
    });
  } catch (error) {
    console.error('Error searching products:', error);
    return res.status(500).json({
      success: false,
      message: 'Error searching products',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// @route   POST /api/products/:id/images
// @desc    Add images to existing product
// @access  Private/Admin
router.post('/:id/images', 
  verifyToken, 
  requireAdmin, 
  uploadMultiple, 
  handleUploadError,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const product = await Product.findById(id);
      
      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product not found'
        });
      }

      if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No images provided'
        });
      }

      const uploadedImages: any[] = [];
      
      try {
        // Upload each image to Cloudinary
        for (let i = 0; i < req.files.length; i++) {
          const file = req.files[i];
          const uploadResult = await uploadImage(file.buffer, {
            folder: 'fefa-jewelry/products',
            public_id: `${product.slug}-${Date.now()}-${i + 1}`,
          });
          
          uploadedImages.push({
            url: uploadResult.secure_url,
            publicId: uploadResult.public_id,
            alt: product.name || `Product image ${i + 1}`,
            isPrimary: false, // New images are not primary by default
            sortOrder: product.images.length + i + 1
          });
        }
      } catch (uploadError) {
        console.error('Image upload error:', uploadError);
        return res.status(500).json({
          success: false,
          message: 'Failed to upload images',
          error: uploadError instanceof Error ? uploadError.message : 'Unknown error'
        });
      }

      // Add new images to existing images
      product.images.push(...uploadedImages);
      await product.save();

      return res.status(200).json({
        success: true,
        data: product,
        message: 'Images added successfully'
      });
    } catch (error) {
      console.error('Error adding images:', error);
      return res.status(500).json({
        success: false,
        message: 'Error adding images',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

// @route   DELETE /api/products/:id/images/:imageIndex
// @desc    Delete specific image from product by index
// @access  Private/Admin
router.delete('/:id/images/:imageIndex', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id, imageIndex } = req.params;
    const product = await Product.findById(id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const index = parseInt(imageIndex);
    if (isNaN(index) || index < 0 || index >= product.images.length) {
      return res.status(404).json({
        success: false,
        message: 'Image not found'
      });
    }

    const imageToDelete = product.images[index];
    
    // Delete from Cloudinary
    try {
      await deleteImage(imageToDelete.publicId);
    } catch (cloudinaryError) {
      console.error('Cloudinary delete error:', cloudinaryError);
      // Continue with database deletion even if Cloudinary fails
    }

    // Remove from database
    product.images.splice(index, 1);
    
    // If we deleted the primary image, make the first remaining image primary
    if (imageToDelete.isPrimary && product.images.length > 0) {
      product.images[0].isPrimary = true;
    }
    
    await product.save();

    return res.status(200).json({
      success: true,
      data: product,
      message: 'Image deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting image:', error);
    return res.status(500).json({
      success: false,
      message: 'Error deleting image',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// @route   PUT /api/products/:id
// @desc    Update product
// @access  Private/Admin
router.put('/:id', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Find the product first
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Handle category name to ObjectId conversion if needed
    if (updateData.category && typeof updateData.category === 'string') {
      const category = await Category.findOne({ name: updateData.category });
      if (category) {
        updateData.category = category._id;
      } else {
        // Try to find by ID if name lookup fails
        const categoryById = await Category.findById(updateData.category);
        if (categoryById) {
          updateData.category = categoryById._id;
        }
      }
    }

    // Handle inventory.quantity mapping - convert to nested object
    if (updateData['inventory.quantity'] !== undefined) {
      if (!product.inventory) {
        product.inventory = {
          trackQuantity: true,
          quantity: 0,
          lowStockThreshold: 10,
          allowBackorder: false
        };
      }
      product.inventory.quantity = parseInt(updateData['inventory.quantity']) || 0;
      delete updateData['inventory.quantity'];
    }

    // Handle dimensions - ensure it's a proper object
    if (updateData.dimensions) {
      product.dimensions = {
        length: updateData.dimensions.length || 0,
        width: updateData.dimensions.width || 0,
        height: updateData.dimensions.height || 0,
        unit: updateData.dimensions.unit || 'cm'
      };
      delete updateData.dimensions;
    }

    // Handle images array - ensure proper structure
    if (updateData.images !== undefined) {
      // Validate images array structure
      if (Array.isArray(updateData.images)) {
        product.images = updateData.images.map((img: any) => {
          // Ensure each image has required fields
          return {
            url: img.url || img,
            publicId: img.publicId || '',
            alt: img.alt || product.name || 'Product image',
            isPrimary: img.isPrimary || false,
            sortOrder: img.sortOrder || 0
          };
        });
      }
      delete updateData.images;
    }

    // Update other fields
    Object.keys(updateData).forEach(key => {
      if (key !== 'inventory' && key !== 'dimensions' && key !== 'images' && key !== 'inventory.quantity') {
        (product as any)[key] = updateData[key];
      }
    });

    // Save the product
    await product.save();

    // Populate and return
    await product.populate('category', 'name slug');
    await product.populate('subcategory', 'name slug');

    return res.json({
      success: true,
      data: product,
      message: 'Product updated successfully'
    });
  } catch (error) {
    console.error('Error updating product:', error);
    return res.status(500).json({
      success: false,
      message: 'Error updating product',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// @route   DELETE /api/products/:id
// @desc    Delete product and all its images from Cloudinary
// @access  Private/Admin
router.delete('/:id', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Find the product first to get image information
    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Delete all images from Cloudinary before deleting the product
    if (product.images && product.images.length > 0) {
      const deletePromises = product.images.map(async (img: any) => {
        // Try different field names for publicId
        let publicId = img.publicId || img.public_id;
        
        // Always extract publicId from URL to get the exact path Cloudinary uses
        if (img.url) {
          try {
            // Extract public_id from Cloudinary URL
            const urlMatch = img.url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
            if (urlMatch && urlMatch[1]) {
              const extractedPublicId = urlMatch[1];
              // Use extracted publicId if it's more complete than stored one
              if (!publicId || extractedPublicId.includes('/') && !publicId.includes('/')) {
                publicId = extractedPublicId;
              }
            }
          } catch (extractError) {
            console.error(`Failed to extract publicId from URL:`, extractError);
          }
        }
        
        if (publicId) {
          try {
            await deleteImage(publicId, { folder: 'fefa-jewelry/products' });
            return { success: true, publicId };
          } catch (cloudinaryError) {
            console.error(`Failed to delete image from Cloudinary:`, cloudinaryError);
            return { success: false, publicId, error: cloudinaryError };
          }
        } else {
          return { success: false, publicId: null, error: 'No publicId found' };
        }
      });

      await Promise.allSettled(deletePromises);
    }

    // Now delete the product from database
    await Product.findByIdAndDelete(id);

    return res.json({
      success: true,
      message: 'Product and all associated images deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    return res.status(500).json({
      success: false,
      message: 'Error deleting product',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
