import { Router, Request, Response } from 'express';
import { verifyToken, AuthRequest, requireAdmin } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import Order from '../models/Order';
import Cart from '../models/Cart';
import Product from '../models/Product';
import User from '../models/User';
import { connectDB } from '../config/database';

const router = Router();

/**
 * @route   GET /api/orders
 * @desc    Get orders (all orders for admin, user orders for regular users)
 * @access  Private
 */
router.get('/', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const userId = req.user?._id;
    const userRole = req.user?.role;
    const isAdmin = userRole === 'admin' || userRole === 'super_admin';

    // Admin query params
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string;
    const status = req.query.status as string;
    const sortBy = req.query.sortBy as string || 'createdAt';
    const sortOrder = req.query.sortOrder as string || 'desc';

    let query: any = {};

    // Regular users only see their own orders
    if (!isAdmin) {
      query.user = userId;
    } else {
      // Admin filters
      if (search) {
        query.$or = [
          { orderNumber: { $regex: search, $options: 'i' } },
          { 'shippingAddress.firstName': { $regex: search, $options: 'i' } },
          { 'shippingAddress.lastName': { $regex: search, $options: 'i' } },
        ];
      }
      if (status) {
        query.status = status;
      }
    }

    // Calculate skip for pagination
    const skip = (page - 1) * limit;

    // Build sort object
    const sort: any = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Get orders with pagination
    const orders = await Order.find(query)
      .populate('user', 'firstName lastName email')
      .populate('items.product', 'name slug images')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean();

    // Get total count for pagination
    const totalOrders = await Order.countDocuments(query);
    const totalPages = Math.ceil(totalOrders / limit);

    // Calculate total revenue for admin
    let totalRevenue = 0;
    if (isAdmin) {
      const revenueAgg = await Order.aggregate([
        { $match: query },
        { $group: { _id: null, total: { $sum: '$pricing.total' } } }
      ]);
      totalRevenue = revenueAgg[0]?.total || 0;
    }

    res.status(200).json({
      success: true,
      data: orders,
      pagination: {
        page,
        limit,
        totalPages,
        totalOrders,
        hasMore: page < totalPages
      },
      totalRevenue: isAdmin ? totalRevenue : undefined
    });
  } catch (error: any) {
    next(createError(error.message || 'Failed to fetch orders', 500));
  }
});

/**
 * @route   GET /api/orders/:id
 * @desc    Get single order (admin can view any order)
 * @access  Private
 */
router.get('/:id', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const userId = req.user?._id;
    const userRole = req.user?.role;
    const isAdmin = userRole === 'admin' || userRole === 'super_admin';
    const orderId = req.params.id;

    // Build query - admin can see any order, users only their own
    const query: any = { _id: orderId };
    if (!isAdmin) {
      query.user = userId;
    }

    const order = await Order.findOne(query)
      .populate('user', 'firstName lastName email phone')
      .populate('items.product', 'name slug images');

    if (!order) {
      return next(createError('Order not found', 404));
    }

    res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error: any) {
    next(createError(error.message || 'Failed to fetch order', 500));
  }
});

/**
 * @route   POST /api/orders
 * @desc    Create new order
 * @access  Private
 */
router.post('/', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const userId = req.user?._id;
    const { shippingAddress, billingAddress, paymentMethod } = req.body;

    // Validate required fields
    if (!shippingAddress) {
      return next(createError('Shipping address is required', 400));
    }

    if (!paymentMethod) {
      return next(createError('Payment method is required', 400));
    }

    // Get user's cart
    const cart = await Cart.findOne({ user: userId }).populate('items.product');

    if (!cart || cart.items.length === 0) {
      return next(createError('Cart is empty', 400));
    }

    // Prepare order items
    const orderItems = await Promise.all(
      cart.items.map(async (item: any) => {
        const product = await Product.findById(item.product);
        if (!product) {
          throw new Error(`Product ${item.product} not found`);
        }

        // Get product image
        const primaryImage = product.images.find((img: any) => img.isPrimary) || product.images[0];

        return {
          product: item.product,
          variant: item.variant,
          name: product.name,
          sku: product.sku,
          quantity: item.quantity,
          price: item.price,
          total: item.total,
          image: primaryImage?.url,
        };
      })
    );

    // Calculate pricing
    const subtotal = cart.subtotal || orderItems.reduce((sum, item) => sum + item.total, 0);
    const tax = cart.tax || 0;
    const shipping = cart.shipping || (subtotal > 5000 ? 0 : 99);
    const discount = 0; // Can be calculated from coupons/promotions
    const total = subtotal + tax + shipping - discount;

    // Create order
    const order = new Order({
      user: userId,
      items: orderItems,
      shippingAddress: {
        firstName: shippingAddress.firstName,
        lastName: shippingAddress.lastName,
        company: shippingAddress.company,
        addressLine1: shippingAddress.addressLine1,
        addressLine2: shippingAddress.addressLine2,
        city: shippingAddress.city,
        state: shippingAddress.state,
        postalCode: shippingAddress.postalCode,
        country: shippingAddress.country || 'India',
        phone: shippingAddress.phone,
      },
      billingAddress: billingAddress || shippingAddress,
      payment: {
        method: paymentMethod.type === 'card' ? 'card' : paymentMethod.type === 'upi' ? 'online' : 'online',
        status: 'pending',
        gateway: 'razorpay',
      },
      pricing: {
        subtotal,
        tax,
        shipping,
        discount,
        total,
        currency: 'INR',
      },
      status: 'pending',
      timeline: [
        {
          status: 'pending',
          timestamp: new Date(),
          note: 'Order created',
        },
      ],
    });

    await order.save();

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        total: order.pricing.total,
        status: order.status,
        payment: {
          method: order.payment.method,
          status: order.payment.status,
        },
      },
    });
  } catch (error: any) {
    console.error('Error creating order:', error);
    next(createError(error.message || 'Failed to create order', 500));
  }
});

/**
 * @route   PUT /api/orders/:id
 * @desc    Update order status (admin can update any order)
 * @access  Private/Admin
 */
router.put('/:id', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const orderId = req.params.id;
    const { status, note, payment, tracking } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      return next(createError('Order not found', 404));
    }

    // Check if user is admin or order owner
    const isOwner = order.user.toString() === req.user?._id.toString();
    const userRole = req.user?.role;
    const isAdmin = userRole === 'admin' || userRole === 'super_admin';

    if (!isOwner && !isAdmin) {
      return next(createError('Unauthorized', 403));
    }

    // Update order fields
    if (status) {
      order.status = status as any;
      order.timeline.push({
        status: status as any,
        timestamp: new Date(),
        note: note || `Status updated to ${status}`,
      });
    }

    // Admin can update payment status
    if (isAdmin && payment) {
      if (payment.status) order.payment.status = payment.status;
      if (payment.transactionId) order.payment.transactionId = payment.transactionId;
    }

    // Admin can update tracking info
    if (isAdmin && tracking) {
      // Initialize tracking if it doesn't exist
      if (!order.tracking) {
        order.tracking = {};
      }
      if (tracking.carrier) order.tracking.carrier = tracking.carrier;
      if (tracking.trackingNumber) order.tracking.trackingNumber = tracking.trackingNumber;
      if (tracking.trackingUrl) order.tracking.trackingUrl = tracking.trackingUrl;
    }

    await order.save();

    const updatedOrder = await Order.findById(orderId)
      .populate('user', 'firstName lastName email')
      .populate('items.product', 'name slug images');

    res.status(200).json({
      success: true,
      message: 'Order updated successfully',
      data: updatedOrder,
    });
  } catch (error: any) {
    next(createError(error.message || 'Failed to update order', 500));
  }
});

/**
 * @route   DELETE /api/orders/:id
 * @desc    Cancel order
 * @access  Private
 */
router.delete('/:id', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const userId = req.user?._id;
    const orderId = req.params.id;

    const order = await Order.findOne({
      _id: orderId,
      user: userId,
    });

    if (!order) {
      return next(createError('Order not found', 404));
    }

    // Only allow cancellation if order is pending or confirmed
    if (!['pending', 'confirmed'].includes(order.status)) {
      return next(createError('Order cannot be cancelled at this stage', 400));
    }

    order.status = 'cancelled';
    order.timeline.push({
      status: 'cancelled',
      timestamp: new Date(),
      note: 'Order cancelled by user',
    });
    await order.save();

    res.status(200).json({
      success: true,
      message: 'Order cancelled successfully',
      order,
    });
  } catch (error: any) {
    next(createError(error.message || 'Failed to cancel order', 500));
  }
});

/**
 * @route   GET /api/orders/stats/summary
 * @desc    Get order statistics for admin dashboard
 * @access  Private/Admin
 */
router.get('/stats/summary', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();

    // Get total orders
    const totalOrders = await Order.countDocuments();

    // Get total revenue
    const revenueAgg = await Order.aggregate([
      { $match: { 'payment.status': 'completed' } },
      { $group: { _id: null, total: { $sum: '$pricing.total' } } }
    ]);
    const totalRevenue = revenueAgg[0]?.total || 0;

    // Get orders by status
    const ordersByStatus = await Order.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Get recent orders (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentOrders = await Order.countDocuments({
      createdAt: { $gte: thirtyDaysAgo }
    });

    // Get previous 30 days for comparison
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    
    const previousOrders = await Order.countDocuments({
      createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo }
    });

    // Calculate percentage change
    const orderChange = previousOrders > 0 
      ? ((recentOrders - previousOrders) / previousOrders) * 100 
      : 0;

    // Get revenue for last 30 days
    const recentRevenueAgg = await Order.aggregate([
      { 
        $match: { 
          createdAt: { $gte: thirtyDaysAgo },
          'payment.status': 'completed'
        } 
      },
      { $group: { _id: null, total: { $sum: '$pricing.total' } } }
    ]);
    const recentRevenue = recentRevenueAgg[0]?.total || 0;

    // Get revenue for previous 30 days
    const previousRevenueAgg = await Order.aggregate([
      { 
        $match: { 
          createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo },
          'payment.status': 'completed'
        } 
      },
      { $group: { _id: null, total: { $sum: '$pricing.total' } } }
    ]);
    const previousRevenue = previousRevenueAgg[0]?.total || 0;

    // Calculate revenue percentage change
    const revenueChange = previousRevenue > 0 
      ? ((recentRevenue - previousRevenue) / previousRevenue) * 100 
      : 0;

    res.status(200).json({
      success: true,
      data: {
        totalOrders,
        totalRevenue,
        recentOrders,
        orderChange: Math.round(orderChange),
        revenueChange: Math.round(revenueChange),
        ordersByStatus: ordersByStatus.reduce((acc: any, curr: any) => {
          acc[curr._id] = curr.count;
          return acc;
        }, {})
      }
    });
  } catch (error: any) {
    next(createError(error.message || 'Failed to fetch order statistics', 500));
  }
});

export default router;
