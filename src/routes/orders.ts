import { Router, Request, Response } from 'express';
import { verifyToken, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import Order from '../models/Order';
import Cart from '../models/Cart';
import Product from '../models/Product';
import { connectDB } from '../config/database';

const router = Router();

/**
 * @route   GET /api/orders
 * @desc    Get user orders
 * @access  Private
 */
router.get('/', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const userId = req.user?._id;

    const orders = await Order.find({ user: userId })
      .populate('items.product', 'name slug images')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error: any) {
    next(createError(error.message || 'Failed to fetch orders', 500));
  }
});

/**
 * @route   GET /api/orders/:id
 * @desc    Get single order
 * @access  Private
 */
router.get('/:id', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const userId = req.user?._id;
    const orderId = req.params.id;

    const order = await Order.findOne({
      _id: orderId,
      user: userId,
    }).populate('items.product', 'name slug images');

    if (!order) {
      return next(createError('Order not found', 404));
    }

    res.status(200).json({
      success: true,
      order,
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
 * @desc    Update order status
 * @access  Private/Admin
 */
router.put('/:id', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const orderId = req.params.id;
    const { status, note } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      return next(createError('Order not found', 404));
    }

    // Check if user is admin or order owner
    const isOwner = order.user.toString() === req.user?._id.toString();
    // TODO: Add admin check when admin roles are implemented
    // const isAdmin = req.user?.role === 'admin';

    if (!isOwner) {
      return next(createError('Unauthorized', 403));
    }

    if (status) {
      order.status = status as any;
      order.timeline.push({
        status: status as any,
        timestamp: new Date(),
        note,
      });
      await order.save();
    }

    const updatedOrder = await Order.findById(orderId);

    res.status(200).json({
      success: true,
      message: 'Order updated successfully',
      order: updatedOrder,
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

export default router;
