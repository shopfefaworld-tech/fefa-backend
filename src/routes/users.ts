import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import User from '../models/User';
import Order from '../models/Order';
import Wishlist from '../models/Wishlist';
import Product from '../models/Product';
import { errorHandler, createError } from '../middleware/errorHandler';
import { verifyToken, requireAdmin, AuthRequest } from '../middleware/auth';
import { getFirebaseAuth } from '../config/firebase';

const router = Router();

// Test route - no auth required
router.get('/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Users router is working!',
    url: req.url,
    originalUrl: req.originalUrl
  });
});

// @route   GET /api/users/profile
// @desc    Get user profile
// @access  Private
router.get('/profile', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    return res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: `${user.firstName} ${user.lastName}`,
          phone: user.phone,
          dateOfBirth: user.dateOfBirth,
          gender: user.gender,
          profileImage: user.profileImage,
          role: user.role,
          addresses: user.addresses,
          preferences: user.preferences,
          lastLogin: user.lastLogin,
          createdAt: user.createdAt,
        }
      }
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch profile'
    });
  }
});

// @route   PUT /api/users/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user;
    const { firstName, lastName, phone, dateOfBirth, gender, preferences } = req.body;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Update user fields
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (phone) user.phone = phone;
    if (dateOfBirth) user.dateOfBirth = dateOfBirth;
    if (gender) user.gender = gender;
    if (preferences) {
      user.preferences = {
        ...user.preferences,
        ...preferences
      };
    }

    await user.save();

    return res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: `${user.firstName} ${user.lastName}`,
          phone: user.phone,
          dateOfBirth: user.dateOfBirth,
          gender: user.gender,
          profileImage: user.profileImage,
          role: user.role,
          preferences: user.preferences,
        }
      }
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
});

// @route   DELETE /api/users/profile
// @desc    Delete user profile (self-deletion)
// @access  Private
router.delete('/profile', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Delete from Firebase if user has Firebase UID
    if (user.firebaseUid) {
      try {
        const auth = getFirebaseAuth();
        await auth.deleteUser(user.firebaseUid);
      } catch (firebaseError) {
        console.error('Error deleting Firebase user:', firebaseError);
        // Continue with deletion even if Firebase deletion fails
      }
    }

    // Delete user's wishlist
    await Wishlist.deleteMany({ user: user._id });

    // Delete user's cart (if exists)
    const Cart = (await import('../models/Cart')).default;
    await Cart.deleteMany({ user: user._id });

    // Delete profile image from Cloudinary if it exists
    if (user.profileImage) {
      try {
        const { deleteImage } = await import('../config/cloudinary');
        const urlMatch = user.profileImage.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
        if (urlMatch && urlMatch[1]) {
          await deleteImage(urlMatch[1], { folder: 'fefa-jewelry/users' });
        }
      } catch (imageError) {
        console.error('Error deleting profile image:', imageError);
      }
    }

    // Delete the user
    await User.findByIdAndDelete(user._id);

    return res.json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete account'
    });
  }
});

// @route   GET /api/users/orders
// @desc    Get user orders
// @access  Private
router.get('/orders', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const status = req.query.status as string;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Build query
    const query: any = { user: userId };
    if (status) {
      query.status = status;
    }

    // Get orders with pagination
    const skip = (page - 1) * limit;
    const orders = await Order.find(query)
      .populate('items.product', 'name slug images')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const totalOrders = await Order.countDocuments(query);
    const totalPages = Math.ceil(totalOrders / limit);

    return res.json({
      success: true,
      data: orders,
      pagination: {
        page,
        limit,
        totalPages,
        totalOrders,
        hasMore: page < totalPages
      }
    });
  } catch (error) {
    console.error('Error fetching user orders:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch orders'
    });
  }
});

// Helper function to resolve variant data
const resolveVariantData = (wishlist: any) => {
  if (!wishlist || !wishlist.items) return wishlist;
  
  wishlist.items = wishlist.items.map((item: any) => {
    if (item.variant && item.product && item.product.variants) {
      const variant = item.product.variants.find((v: any) => 
        v._id.toString() === item.variant.toString()
      );
      if (variant) {
        item.variant = {
          _id: variant._id,
          name: variant.name,
          price: variant.price,
          sku: variant.sku
        };
      }
    }
    return item;
  });
  
  return wishlist;
};

// @route   GET /api/users/wishlist
// @desc    Get user wishlist
// @access  Private
router.get('/wishlist', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    let wishlist = await Wishlist.findOne({ user: userId })
      .populate('items.product', 'name price images slug variants ratings isActive')
      .lean();

    if (!wishlist) {
      // Create empty wishlist for user
      const newWishlist = await Wishlist.create({
        user: userId,
        items: []
      });
      wishlist = newWishlist.toObject() as any;
    }

    // Filter out inactive products
    if (wishlist && wishlist.items) {
      wishlist.items = wishlist.items.filter((item: any) => 
        item.product && item.product.isActive !== false
      );
    }

    return res.json({
      success: true,
      data: resolveVariantData(wishlist)
    });
  } catch (error) {
    console.error('Error fetching wishlist:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch wishlist'
    });
  }
});

// @route   POST /api/users/wishlist/:productId
// @desc    Add product to wishlist
// @access  Private
router.post('/wishlist/:productId', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const { productId } = req.params;
    const { variantId, notes } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID format'
      });
    }

    // Verify product exists and is active
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    if (!product.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Product is not available'
      });
    }

    // Get or create wishlist
    let wishlist = await Wishlist.findOne({ user: userId });
    if (!wishlist) {
      wishlist = await Wishlist.create({
        user: userId,
        items: []
      });
    }

    // Check if item already exists
    const existingItem = wishlist.items.find((item: any) => 
      item.product.toString() === productId && 
      (!variantId || item.variant?.toString() === variantId)
    );

    if (existingItem) {
      return res.status(400).json({
        success: false,
        message: 'Item already in wishlist'
      });
    }

    // Add item to wishlist
    wishlist.items.push({
      product: productId as any,
      variant: variantId as any,
      addedAt: new Date(),
      notes: notes || undefined,
    });

    await wishlist.save();

    // Fetch updated wishlist
    const updatedWishlist = await Wishlist.findOne({ user: userId })
      .populate('items.product', 'name price images slug variants ratings isActive')
      .lean();

    return res.json({
      success: true,
      message: 'Item added to wishlist',
      data: resolveVariantData(updatedWishlist)
    });
  } catch (error) {
    console.error('Error adding to wishlist:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to add item to wishlist'
    });
  }
});

// @route   DELETE /api/users/wishlist/:productId
// @desc    Remove product from wishlist
// @access  Private
router.delete('/wishlist/:productId', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const { productId } = req.params;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const wishlist = await Wishlist.findOne({ user: userId });
    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: 'Wishlist not found'
      });
    }

    // Remove item
    const initialLength = wishlist.items.length;
    wishlist.items = wishlist.items.filter((item: any) => 
      item.product.toString() !== productId
    );

    if (wishlist.items.length === initialLength) {
      return res.status(404).json({
        success: false,
        message: 'Item not found in wishlist'
      });
    }

    await wishlist.save();

    // Fetch updated wishlist
    const updatedWishlist = await Wishlist.findOne({ user: userId })
      .populate('items.product', 'name price images slug variants ratings isActive')
      .lean();

    return res.json({
      success: true,
      message: 'Item removed from wishlist',
      data: resolveVariantData(updatedWishlist)
    });
  } catch (error) {
    console.error('Error removing from wishlist:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to remove item from wishlist'
    });
  }
});

// ==================== ADMIN ROUTES ====================

// @route   POST /api/users
// @desc    Create new user (admin only)
// @access  Private (Admin)
router.post('/', verifyToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { firstName, lastName, email, phone, password, role = 'customer', profileImage } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'First name, last name, email, and password are required'
      });
    }

    // Validate email format
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }

    // Create user in Firebase
    let firebaseUid: string | undefined;
    try {
      const auth = getFirebaseAuth();
      const firebaseUser = await auth.createUser({
        email: email.toLowerCase(),
        password,
        displayName: `${firstName} ${lastName}`,
      });
      firebaseUid = firebaseUser.uid;
    } catch (firebaseError: any) {
      console.error('Firebase user creation error:', firebaseError);
      
      if (firebaseError.code === 'auth/email-already-exists') {
        return res.status(400).json({
          success: false,
          message: 'User with this email already exists in Firebase'
        });
      }
      
      // Continue without Firebase if it fails (for testing)
      console.log('Creating user without Firebase authentication');
    }

    // Create user in MongoDB
    const user = new User({
      firebaseUid,
      email: email.toLowerCase(),
      firstName,
      lastName,
      phone,
      role,
      profileImage,
      isActive: true,
      isEmailVerified: true, // Admin-created users are pre-verified
    });

    await user.save();

    return res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        profileImage: user.profileImage,
        isActive: user.isActive,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Error creating user:', error);
    return res.status(500).json({
      success: false,
      message: 'Error creating user',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// @route   GET /api/users
// @desc    Get all users (admin only)
// @access  Private (Admin)
router.get('/', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      role,
      isActive,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter object
    const filter: any = {};
    
    if (search) {
      const searchRegex = new RegExp(search as string, 'i');
      filter.$or = [
        { firstName: { $regex: searchRegex } },
        { lastName: { $regex: searchRegex } },
        { email: { $regex: searchRegex } },
        { phone: { $regex: searchRegex } }
      ];
    }
    
    if (role) {
      filter.role = role;
    }
    
    if (isActive !== undefined) {
      filter.isActive = isActive === 'true';
    }

    // Build sort object
    const sort: any = {};
    sort[sortBy as string] = sortOrder === 'asc' ? 1 : -1;

    // Calculate pagination
    const skip = (Number(page) - 1) * Number(limit);

    // Execute query
    const users = await User.find(filter)
      .select('-firebaseUid -addresses -preferences')
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const total = await User.countDocuments(filter);

    return res.json({
      success: true,
      data: users,
      pagination: {
        currentPage: Number(page),
        totalPages: Math.ceil(total / Number(limit)),
        totalUsers: total,
        hasNextPage: skip + Number(limit) < total,
        hasPrevPage: Number(page) > 1
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching users',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// @route   GET /api/users/:id
// @desc    Get single user by ID (admin only)
// @access  Private (Admin)
router.get('/:id', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-firebaseUid -addresses -preferences')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching user',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// @route   PUT /api/users/:id
// @desc    Update user (admin only)
// @access  Private (Admin)
router.put('/:id', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, email, phone, role, isActive } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update fields
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (email) user.email = email;
    if (phone) user.phone = phone;
    if (role) user.role = role;
    if (isActive !== undefined) user.isActive = isActive;

    await user.save();

    return res.json({
      success: true,
      message: 'User updated successfully',
      data: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Error updating user:', error);
    return res.status(500).json({
      success: false,
      message: 'Error updating user',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// @route   DELETE /api/users/:id
// @desc    Delete user (admin only)
// @access  Private (Admin)
router.delete('/:id', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    // Delete profile image from Cloudinary if it exists
    if (user.profileImage) {
      try {
        const { deleteImage } = await import('../config/cloudinary');
        // Extract publicId from Cloudinary URL
        const urlMatch = user.profileImage.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
        if (urlMatch && urlMatch[1]) {
          const publicId = urlMatch[1];
          try {
            await deleteImage(publicId, { folder: 'fefa-jewelry/users' });
          } catch (cloudinaryError) {
            console.error(`Failed to delete user profile image from Cloudinary:`, cloudinaryError);
            // Continue with deletion even if Cloudinary deletion fails
          }
        }
      } catch (imageError) {
        console.error('Error processing user profile image deletion:', imageError);
        // Continue with deletion even if image processing fails
      }
    }

    await User.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'User and associated profile image deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting user',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
