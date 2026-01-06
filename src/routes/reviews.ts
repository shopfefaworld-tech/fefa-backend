import { Router, Request, Response } from 'express';
import Review, { IReview, IReviewModel } from '../models/Review';
import Product from '../models/Product';
import Order from '../models/Order';
import { verifyToken, AuthRequest, requireAdmin } from '../middleware/auth';

const router = Router();

// @route   GET /api/reviews
// @desc    Get all reviews (admin only)
// @access  Private/Admin
router.get('/', verifyToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 10, status, rating, search } = req.query;
    
    const query: any = {};
    
    // Filter by approval status
    if (status === 'pending') {
      query.isApproved = false;
    } else if (status === 'approved') {
      query.isApproved = true;
    }
    
    // Filter by rating
    if (rating) {
      query.rating = parseInt(rating as string);
    }
    
    // Search by title or comment
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { comment: { $regex: search, $options: 'i' } }
      ];
    }
    
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    
    const reviews = await Review.find(query)
      .populate('user', 'firstName lastName email profileImage')
      .populate('product', 'name slug images')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit as string))
      .lean();
    
    const totalReviews = await Review.countDocuments(query);
    const totalPages = Math.ceil(totalReviews / parseInt(limit as string));
    
    // Get pending reviews count
    const pendingCount = await Review.countDocuments({ isApproved: false });
    
    res.json({
      success: true,
      data: reviews,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        totalPages,
        totalReviews,
        hasMore: parseInt(page as string) < totalPages
      },
      pendingCount
    });
  } catch (error) {
    console.error('Error fetching all reviews:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reviews'
    });
  }
});

// @route   GET /api/reviews/pending/count
// @desc    Get count of pending reviews
// @access  Private/Admin
router.get('/pending/count', verifyToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const count = await Review.countDocuments({ isApproved: false });
    
    res.json({
      success: true,
      data: { count }
    });
  } catch (error) {
    console.error('Error fetching pending reviews count:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending reviews count'
    });
  }
});

// @route   GET /api/reviews/product/:productId
// @desc    Get reviews for a specific product
// @access  Public
router.get('/product/:productId', async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const { page = 1, limit = 10, rating } = req.query;

    const reviews = await (Review as IReviewModel).getProductReviews(
      productId,
      parseInt(page as string),
      parseInt(limit as string),
      rating ? parseInt(rating as string) : undefined
    );

    const stats = await (Review as IReviewModel).getProductReviewStats(productId);

    res.json({
      success: true,
      data: {
        reviews,
        stats: stats[0] || {
          totalReviews: 0,
          averageRating: 0,
          ratingDistribution: { one: 0, two: 0, three: 0, four: 0, five: 0 }
        }
      }
    });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reviews'
    });
  }
});

// @route   POST /api/reviews
// @desc    Create a new review
// @access  Private
router.post('/', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const { productId, orderId, rating, title, comment, images } = req.body;

    if (!productId || !rating) {
      res.status(400).json({
        success: false,
        message: 'Product ID and rating are required'
      });
      return;
    }

    // Verify product exists and is active
    const product = await Product.findById(productId);
    if (!product) {
      res.status(404).json({
        success: false,
        message: 'Product not found'
      });
      return;
    }

    if (!product.isActive) {
      res.status(400).json({
        success: false,
        message: 'Product is not available for review'
      });
      return;
    }

    // Verify order exists and belongs to user (if orderId provided)
    if (orderId) {
      const order = await Order.findOne({ _id: orderId, user: userId });
      if (!order) {
        res.status(404).json({
          success: false,
          message: 'Order not found or does not belong to user'
        });
        return;
      }
    }

    // Check if user already reviewed this product
    const existingReview = await Review.findOne({ user: userId, product: productId });
    if (existingReview) {
      res.status(400).json({
        success: false,
        message: 'You have already reviewed this product'
      });
      return;
    }

    // Create review
    const reviewData: any = {
      user: userId,
      product: productId,
      rating,
      title,
      comment,
      images,
      isVerified: !!orderId, // Verified if order exists
      isApproved: false // Reviews need admin approval
    };

    // Only include order if orderId is provided
    if (orderId) {
      reviewData.order = orderId;
    }

    const review = await Review.create(reviewData);

    // Populate user data
    await review.populate('user', 'firstName lastName profileImage');

    res.status(201).json({
      success: true,
      data: review
    });
    return;
  } catch (error) {
    console.error('Error creating review:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create review'
    });
    return;
  }
});

// @route   PUT /api/reviews/:reviewId
// @desc    Update a review
// @access  Private
router.put('/:reviewId', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const { reviewId } = req.params;
    const { rating, title, comment, images } = req.body;

    const review = await Review.findOne({ _id: reviewId, user: userId });
    if (!review) {
      res.status(404).json({
        success: false,
        message: 'Review not found or does not belong to user'
      });
      return;
    }

    // Update review
    if (rating !== undefined) review!.rating = rating;
    if (title !== undefined) review!.title = title;
    if (comment !== undefined) review!.comment = comment;
    if (images !== undefined) review!.images = images;

    await review!.save();
    await review!.populate('user', 'firstName lastName profileImage');

    res.json({
      success: true,
      data: review!
    });
    return;
  } catch (error) {
    console.error('Error updating review:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update review'
    });
    return;
  }
});

// @route   PATCH /api/reviews/:reviewId/approve
// @desc    Approve a review (admin only)
// @access  Private/Admin
router.patch('/:reviewId/approve', verifyToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { reviewId } = req.params;

    const review = await Review.findById(reviewId);
    if (!review) {
      res.status(404).json({
        success: false,
        message: 'Review not found'
      });
      return;
    }

    review.isApproved = true;
    await review.save();
    await review.populate('user', 'firstName lastName email profileImage');
    await review.populate('product', 'name slug images');

    res.json({
      success: true,
      data: review,
      message: 'Review approved successfully'
    });
    return;
  } catch (error) {
    console.error('Error approving review:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve review'
    });
    return;
  }
});

// @route   PATCH /api/reviews/:reviewId/reject
// @desc    Reject a review (admin only)
// @access  Private/Admin
router.patch('/:reviewId/reject', verifyToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { reviewId } = req.params;

    const review = await Review.findById(reviewId);
    if (!review) {
      res.status(404).json({
        success: false,
        message: 'Review not found'
      });
      return;
    }

    review.isApproved = false;
    await review.save();
    await review.populate('user', 'firstName lastName email profileImage');
    await review.populate('product', 'name slug images');

    res.json({
      success: true,
      data: review,
      message: 'Review rejected successfully'
    });
    return;
  } catch (error) {
    console.error('Error rejecting review:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject review'
    });
    return;
  }
});

// @route   DELETE /api/reviews/:reviewId
// @desc    Delete a review (user or admin)
// @access  Private
router.delete('/:reviewId', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const userRole = req.user?.role;
    const isAdmin = userRole === 'admin' || userRole === 'super_admin';
    const { reviewId } = req.params;

    // Admin can delete any review, users can only delete their own
    const query: any = { _id: reviewId };
    if (!isAdmin) {
      query.user = userId;
    }

    const review = await Review.findOne(query);
    if (!review) {
      res.status(404).json({
        success: false,
        message: 'Review not found or does not belong to user'
      });
      return;
    }

    // Delete images from Cloudinary if they exist
    if (review.images && review.images.length > 0) {
      const { deleteImage } = await import('../config/cloudinary');
      const deletePromises = review.images.map(async (imageUrl: string) => {
        try {
          // Extract publicId from Cloudinary URL
          const urlMatch = imageUrl.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
          if (urlMatch && urlMatch[1]) {
            const publicId = urlMatch[1];
            await deleteImage(publicId, { folder: 'fefa-jewelry/reviews' });
          }
        } catch (cloudinaryError) {
          console.error(`Failed to delete review image from Cloudinary:`, cloudinaryError);
          // Continue with deletion even if Cloudinary deletion fails
        }
      });
      await Promise.allSettled(deletePromises);
    }

    await Review.findByIdAndDelete(reviewId);

    res.json({
      success: true,
      message: 'Review deleted successfully'
    });
    return;
  } catch (error) {
    console.error('Error deleting review:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete review'
    });
    return;
  }
});

// @route   POST /api/reviews/:reviewId/helpful
// @desc    Mark review as helpful
// @access  Private
router.post('/:reviewId/helpful', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const { reviewId } = req.params;

    const review = await Review.findById(reviewId);
    if (!review) {
      res.status(404).json({
        success: false,
        message: 'Review not found'
      });
      return;
    }

    await review!.markHelpful(userId);

    res.json({
      success: true,
      data: {
        helpfulCount: review!.helpful.count
      }
    });
    return;
  } catch (error) {
    console.error('Error marking review as helpful:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark review as helpful'
    });
    return;
  }
});

// @route   DELETE /api/reviews/:reviewId/helpful
// @desc    Remove helpful mark from review
// @access  Private
router.delete('/:reviewId/helpful', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const { reviewId } = req.params;

    const review = await Review.findById(reviewId);
    if (!review) {
      res.status(404).json({
        success: false,
        message: 'Review not found'
      });
      return;
    }

    await review!.unmarkHelpful(userId);

    res.json({
      success: true,
      data: {
        helpfulCount: review!.helpful.count
      }
    });
    return;
  } catch (error) {
    console.error('Error removing helpful mark:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove helpful mark'
    });
    return;
  }
});

export default router;
