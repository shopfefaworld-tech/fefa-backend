import { Router, Request, Response } from 'express';
import { verifyToken, AuthRequest, requireAdmin } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import Order from '../models/Order';
import User from '../models/User';
import Product from '../models/Product';
import { connectDB } from '../config/database';

const router = Router();

/**
 * @route   GET /api/analytics/overview
 * @desc    Get overview analytics (totals + changes)
 * @access  Private/Admin
 */
router.get('/overview', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    // Get current period stats
    const [totalOrders, totalRevenue, recentOrders, recentRevenue, totalUsers, recentUsers] = await Promise.all([
      Order.countDocuments(),
      Order.aggregate([
        { $match: { 'payment.status': 'completed' } },
        { $group: { _id: null, total: { $sum: '$pricing.total' } } }
      ]),
      Order.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      Order.aggregate([
        { 
          $match: { 
            createdAt: { $gte: thirtyDaysAgo },
            'payment.status': 'completed'
          } 
        },
        { $group: { _id: null, total: { $sum: '$pricing.total' } } }
      ]),
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } })
    ]);

    // Get previous period stats for comparison
    const [previousOrders, previousRevenue, previousUsers] = await Promise.all([
      Order.countDocuments({ 
        createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } 
      }),
      Order.aggregate([
        { 
          $match: { 
            createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo },
            'payment.status': 'completed'
          } 
        },
        { $group: { _id: null, total: { $sum: '$pricing.total' } } }
      ]),
      User.countDocuments({ 
        createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } 
      })
    ]);

    // Calculate percentage changes
    const ordersChange = previousOrders > 0 
      ? Math.round(((recentOrders - previousOrders) / previousOrders) * 100)
      : 0;

    const revenueValue = recentRevenue[0]?.total || 0;
    const previousRevenueValue = previousRevenue[0]?.total || 0;
    const revenueChange = previousRevenueValue > 0
      ? Math.round(((revenueValue - previousRevenueValue) / previousRevenueValue) * 100)
      : 0;

    const usersChange = previousUsers > 0
      ? Math.round(((recentUsers - previousUsers) / previousUsers) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        totalOrders,
        totalRevenue: totalRevenue[0]?.total || 0,
        totalUsers,
        recentOrders,
        recentRevenue: revenueValue,
        recentUsers,
        ordersChange,
        revenueChange,
        usersChange
      }
    });
  } catch (error: any) {
    next(createError(error.message || 'Failed to fetch overview analytics', 500));
  }
});

/**
 * @route   GET /api/analytics/revenue
 * @desc    Get revenue time-series data
 * @access  Private/Admin
 */
router.get('/revenue', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();

    const { period = 'month' } = req.query;
    
    let groupFormat: any;
    let dateRange = new Date();
    
    if (period === 'week') {
      dateRange.setDate(dateRange.getDate() - 7);
      groupFormat = {
        year: { $year: '$createdAt' },
        month: { $month: '$createdAt' },
        day: { $dayOfMonth: '$createdAt' }
      };
    } else if (period === 'year') {
      dateRange.setFullYear(dateRange.getFullYear() - 1);
      groupFormat = {
        year: { $year: '$createdAt' },
        month: { $month: '$createdAt' }
      };
    } else { // month
      dateRange.setDate(dateRange.getDate() - 30);
      groupFormat = {
        year: { $year: '$createdAt' },
        month: { $month: '$createdAt' },
        day: { $dayOfMonth: '$createdAt' }
      };
    }

    const revenueData = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: dateRange },
          'payment.status': 'completed'
        }
      },
      {
        $group: {
          _id: groupFormat,
          revenue: { $sum: '$pricing.total' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    res.json({
      success: true,
      data: revenueData
    });
  } catch (error: any) {
    next(createError(error.message || 'Failed to fetch revenue analytics', 500));
  }
});

/**
 * @route   GET /api/analytics/top-products
 * @desc    Get top selling products
 * @access  Private/Admin
 */
router.get('/top-products', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();

    const { limit = 10 } = req.query;

    const topProducts = await Order.aggregate([
      { $match: { 'payment.status': 'completed' } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          totalSales: { $sum: '$items.total' },
          totalQuantity: { $sum: '$items.quantity' },
          orderCount: { $sum: 1 }
        }
      },
      { $sort: { totalSales: -1 } },
      { $limit: parseInt(limit as string) }
    ]);

    // Populate product details
    const populatedProducts = await Product.populate(topProducts, {
      path: '_id',
      select: 'name slug images sku'
    });

    res.json({
      success: true,
      data: populatedProducts
    });
  } catch (error: any) {
    next(createError(error.message || 'Failed to fetch top products', 500));
  }
});

/**
 * @route   GET /api/analytics/customers
 * @desc    Get customer segmentation data
 * @access  Private/Admin
 */
router.get('/customers', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();

    // Get customer segments by order count
    const customerSegments = await Order.aggregate([
      { $match: { 'payment.status': 'completed' } },
      {
        $group: {
          _id: '$user',
          orderCount: { $sum: 1 },
          totalSpent: { $sum: '$pricing.total' }
        }
      },
      {
        $bucket: {
          groupBy: '$orderCount',
          boundaries: [1, 2, 5, 10, 20],
          default: '20+',
          output: {
            count: { $sum: 1 },
            avgSpent: { $avg: '$totalSpent' }
          }
        }
      }
    ]);

    // Get new vs returning customers (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentCustomers = await Order.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: '$user' } }
    ]);

    const allCustomersBeforeThirtyDays = await Order.aggregate([
      { $match: { createdAt: { $lt: thirtyDaysAgo } } },
      { $group: { _id: '$user' } }
    ]);

    const existingCustomerIds = new Set(allCustomersBeforeThirtyDays.map(c => c._id.toString()));
    const newCustomers = recentCustomers.filter(c => !existingCustomerIds.has(c._id.toString()));
    const returningCustomers = recentCustomers.filter(c => existingCustomerIds.has(c._id.toString()));

    res.json({
      success: true,
      data: {
        segments: customerSegments,
        newCustomers: newCustomers.length,
        returningCustomers: returningCustomers.length
      }
    });
  } catch (error: any) {
    next(createError(error.message || 'Failed to fetch customer analytics', 500));
  }
});

/**
 * @route   GET /api/analytics/conversion
 * @desc    Get conversion funnel data
 * @access  Private/Admin
 */
router.get('/conversion', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get order status distribution
    const orderStats = await Order.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const totalOrders = orderStats.reduce((sum, stat) => sum + stat.count, 0);
    const completedOrders = orderStats.find(s => s._id === 'delivered')?.count || 0;
    const conversionRate = totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0;

    res.json({
      success: true,
      data: {
        orderStats,
        totalOrders,
        completedOrders,
        conversionRate
      }
    });
  } catch (error: any) {
    next(createError(error.message || 'Failed to fetch conversion analytics', 500));
  }
});

export default router;
