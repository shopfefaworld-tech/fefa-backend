import { Router, Request, Response } from 'express';
import Newsletter from '../models/Newsletter';
import { verifyToken, requireAdmin, AuthRequest } from '../middleware/auth';
import { connectDB } from '../config/database';

const router = Router();

/**
 * @route   POST /api/newsletter/subscribe
 * @desc    Subscribe to newsletter
 * @access  Public
 */
router.post('/subscribe', async (req: Request, res: Response) => {
  try {
    await connectDB();
    const { email, source = 'website' } = req.body;

    // Validate email
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
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

    // Check if email already exists
    const existingSubscription = await Newsletter.findOne({ email: email.toLowerCase() });

    if (existingSubscription) {
      // If already subscribed and active
      if (existingSubscription.isActive) {
        return res.status(400).json({
          success: false,
          message: 'This email is already subscribed to our newsletter'
        });
      }

      // Reactivate subscription
      existingSubscription.isActive = true;
      existingSubscription.subscribedAt = new Date();
      existingSubscription.unsubscribedAt = undefined;
      await existingSubscription.save();

      return res.json({
        success: true,
        message: 'Welcome back! Your subscription has been reactivated'
      });
    }

    // Create new subscription
    const subscription = new Newsletter({
      email: email.toLowerCase(),
      source,
      subscribedAt: new Date(),
      isActive: true
    });

    await subscription.save();

    return res.status(201).json({
      success: true,
      message: 'Thank you for subscribing to our newsletter!'
    });
  } catch (error: any) {
    console.error('Newsletter subscription error:', error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'This email is already subscribed'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to subscribe. Please try again later.'
    });
  }
});

/**
 * @route   POST /api/newsletter/unsubscribe
 * @desc    Unsubscribe from newsletter
 * @access  Public
 */
router.post('/unsubscribe', async (req: Request, res: Response) => {
  try {
    await connectDB();
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    const subscription = await Newsletter.findOne({ email: email.toLowerCase() });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Email not found in our mailing list'
      });
    }

    if (!subscription.isActive) {
      return res.status(400).json({
        success: false,
        message: 'This email is already unsubscribed'
      });
    }

    subscription.isActive = false;
    subscription.unsubscribedAt = new Date();
    await subscription.save();

    return res.json({
      success: true,
      message: 'You have been successfully unsubscribed from our newsletter'
    });
  } catch (error) {
    console.error('Newsletter unsubscribe error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to unsubscribe. Please try again later.'
    });
  }
});

/**
 * @route   GET /api/newsletter/status/:email
 * @desc    Check subscription status
 * @access  Public
 */
router.get('/status/:email', async (req: Request, res: Response) => {
  try {
    await connectDB();
    const { email } = req.params;

    const subscription = await Newsletter.findOne({ email: email.toLowerCase() });

    if (!subscription) {
      return res.json({
        success: true,
        subscribed: false,
        message: 'Email not found in our mailing list'
      });
    }

    return res.json({
      success: true,
      subscribed: subscription.isActive,
      subscribedAt: subscription.subscribedAt,
      message: subscription.isActive ? 'Email is subscribed' : 'Email is unsubscribed'
    });
  } catch (error) {
    console.error('Newsletter status check error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to check subscription status'
    });
  }
});

// ==================== ADMIN ROUTES ====================

/**
 * @route   GET /api/newsletter
 * @desc    Get all subscribers (admin only)
 * @access  Private/Admin
 */
router.get('/', verifyToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    await connectDB();
    
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const isActive = req.query.isActive;
    const search = req.query.search as string;

    // Build query
    const query: any = {};
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }
    if (search) {
      query.email = { $regex: search, $options: 'i' };
    }

    const skip = (page - 1) * limit;

    const subscribers = await Newsletter.find(query)
      .sort({ subscribedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Newsletter.countDocuments(query);
    const activeCount = await Newsletter.countDocuments({ isActive: true });

    return res.json({
      success: true,
      data: subscribers,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        total,
        activeCount
      }
    });
  } catch (error) {
    console.error('Error fetching subscribers:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch subscribers'
    });
  }
});

/**
 * @route   DELETE /api/newsletter/:id
 * @desc    Delete subscriber (admin only)
 * @access  Private/Admin
 */
router.delete('/:id', verifyToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    await connectDB();
    
    const subscription = await Newsletter.findByIdAndDelete(req.params.id);

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscriber not found'
      });
    }

    return res.json({
      success: true,
      message: 'Subscriber deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting subscriber:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete subscriber'
    });
  }
});

/**
 * @route   GET /api/newsletter/stats
 * @desc    Get newsletter statistics (admin only)
 * @access  Private/Admin
 */
router.get('/stats', verifyToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    await connectDB();

    const totalSubscribers = await Newsletter.countDocuments();
    const activeSubscribers = await Newsletter.countDocuments({ isActive: true });
    const inactiveSubscribers = await Newsletter.countDocuments({ isActive: false });

    // Get subscribers by source
    const bySource = await Newsletter.aggregate([
      { $group: { _id: '$source', count: { $sum: 1 } } }
    ]);

    // Get recent subscribers (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentSubscribers = await Newsletter.countDocuments({
      subscribedAt: { $gte: thirtyDaysAgo }
    });

    return res.json({
      success: true,
      data: {
        total: totalSubscribers,
        active: activeSubscribers,
        inactive: inactiveSubscribers,
        recentSubscribers,
        bySource: bySource.reduce((acc: any, curr: any) => {
          acc[curr._id] = curr.count;
          return acc;
        }, {})
      }
    });
  } catch (error) {
    console.error('Error fetching newsletter stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch newsletter statistics'
    });
  }
});

export default router;
