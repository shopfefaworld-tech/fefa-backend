import { Router, Request, Response } from 'express';
import User from '../models/User';
import { errorHandler } from '../middleware/errorHandler';
import { verifyToken, requireAdmin } from '../middleware/auth';

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
router.get('/profile', (req, res) => {
  res.json({ message: 'Get user profile endpoint - Coming soon' });
});

// @route   PUT /api/users/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', (req, res) => {
  res.json({ message: 'Update user profile endpoint - Coming soon' });
});

// @route   DELETE /api/users/profile
// @desc    Delete user profile
// @access  Private
router.delete('/profile', (req, res) => {
  res.json({ message: 'Delete user profile endpoint - Coming soon' });
});

// @route   GET /api/users/orders
// @desc    Get user orders
// @access  Private
router.get('/orders', (req, res) => {
  res.json({ message: 'Get user orders endpoint - Coming soon' });
});

// @route   GET /api/users/wishlist
// @desc    Get user wishlist
// @access  Private
router.get('/wishlist', (req, res) => {
  res.json({ message: 'Get user wishlist endpoint - Coming soon' });
});

// @route   POST /api/users/wishlist/:productId
// @desc    Add product to wishlist
// @access  Private
router.post('/wishlist/:productId', (req, res) => {
  res.json({ message: 'Add to wishlist endpoint - Coming soon' });
});

// @route   DELETE /api/users/wishlist/:productId
// @desc    Remove product from wishlist
// @access  Private
router.delete('/wishlist/:productId', (req, res) => {
  res.json({ message: 'Remove from wishlist endpoint - Coming soon' });
});

// ==================== ADMIN ROUTES ====================

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
