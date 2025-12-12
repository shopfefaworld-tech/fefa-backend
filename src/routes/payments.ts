import { Router, Request, Response } from 'express';
import { verifyToken, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { createRazorpayOrder, verifyPaymentSignature } from '../config/razorpay';
import Order, { IOrder } from '../models/Order';
import Cart from '../models/Cart';
import { connectDB } from '../config/database';

const router = Router();

/**
 * @route   POST /api/payments/create-order
 * @desc    Create Razorpay order
 * @access  Private
 */
router.post('/create-order', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    const userId = req.user?._id;
    const { amount, currency = 'INR', orderId: dbOrderId } = req.body;

    if (!amount || amount <= 0) {
      return next(createError('Invalid amount', 400));
    }

    // Convert amount to paise (Razorpay expects amount in smallest currency unit)
    const amountInPaise = Math.round(amount * 100);

    // Generate receipt ID
    const receipt = `receipt_${Date.now()}_${userId}`;

    // Create Razorpay order
    const razorpayOrder = await createRazorpayOrder(
      amountInPaise,
      receipt,
      {
        userId: userId.toString(),
        orderId: dbOrderId || 'pending',
      },
      currency
    );

    res.status(200).json({
      success: true,
      order: {
        id: razorpayOrder.id,
        amount: razorpayOrder.amount,
        amount_due: razorpayOrder.amount_due,
        amount_paid: razorpayOrder.amount_paid,
        currency: razorpayOrder.currency,
        receipt: razorpayOrder.receipt,
        status: razorpayOrder.status,
        created_at: razorpayOrder.created_at,
      },
    });
  } catch (error: any) {
    console.error('Error creating Razorpay order:', error);
    next(createError(error.message || 'Failed to create payment order', 500));
  }
});

/**
 * @route   POST /api/payments/verify
 * @desc    Verify Razorpay payment
 * @access  Private
 */
router.post('/verify', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return next(createError('Missing payment verification data', 400));
    }

    // Verify payment signature
    const isValid = verifyPaymentSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isValid) {
      return next(createError('Invalid payment signature', 400));
    }

    // Update order payment status if orderId is provided
    if (orderId) {
      await connectDB(); // Ensure DB connection
      const order = await Order.findById(orderId);

      if (!order) {
        return next(createError('Order not found', 404));
      }

      // Verify order belongs to user
      if (order.user.toString() !== req.user?._id.toString()) {
        return next(createError('Unauthorized', 403));
      }

      // Update payment information
      order.payment.status = 'paid';
      order.payment.transactionId = razorpay_payment_id;
      order.payment.gateway = 'razorpay';
      order.payment.paidAt = new Date();
      order.status = 'confirmed';

      // Add timeline entry
      order.timeline.push({
        status: 'confirmed',
        timestamp: new Date(),
        note: 'Payment verified successfully',
      });

      await order.save();

      // Clear user's cart after successful payment
      await Cart.findOneAndDelete({ user: req.user?._id });
    }

    res.status(200).json({
      success: true,
      message: 'Payment verified successfully',
      payment: {
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        verified: true,
      },
    });
  } catch (error: any) {
    console.error('Error verifying payment:', error);
    next(createError(error.message || 'Failed to verify payment', 500));
  }
});

/**
 * @route   POST /api/payments/webhook
 * @desc    Razorpay webhook handler
 * @access  Public (verified by Razorpay signature)
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    
    if (!webhookSecret) {
      console.error('RAZORPAY_WEBHOOK_SECRET not configured');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    const razorpaySignature = req.headers['x-razorpay-signature'] as string;
    
    if (!razorpaySignature) {
      return res.status(400).json({ error: 'Missing signature' });
    }

    const crypto = require('crypto');
    const shasum = crypto.createHmac('sha256', webhookSecret);
    shasum.update(JSON.stringify(req.body));
    const digest = shasum.digest('hex');

    if (digest !== razorpaySignature) {
      console.error('Invalid webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = req.body;

    // Handle different webhook events
    switch (event.event) {
      case 'payment.captured':
        await handlePaymentCaptured(event.payload);
        break;
      case 'payment.failed':
        await handlePaymentFailed(event.payload);
        break;
      case 'order.paid':
        await handleOrderPaid(event.payload);
        break;
      default:
        console.log(`Unhandled webhook event: ${event.event}`);
    }

    return res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Webhook event handlers
async function handlePaymentCaptured(payload: any) {
  try {
    await connectDB();
    const payment = payload.payment.entity;
    const orderId = payment.order_id;

    // Find order by Razorpay order ID (stored in notes or transactionId)
    const order = await Order.findOne({
      'payment.transactionId': orderId,
    });

    if (order) {
      order.payment.status = 'paid';
      order.payment.transactionId = payment.id;
      order.payment.paidAt = new Date();
      order.status = 'confirmed';

      order.timeline.push({
        status: 'confirmed',
        timestamp: new Date(),
        note: 'Payment captured via webhook',
      });

      await order.save();
    }
  } catch (error) {
    console.error('Error handling payment captured:', error);
  }
}

async function handlePaymentFailed(payload: any) {
  try {
    await connectDB();
    const payment = payload.payment.entity;
    const orderId = payment.order_id;

    const order = await Order.findOne({
      'payment.transactionId': orderId,
    });

    if (order) {
      order.payment.status = 'failed';
      order.status = 'cancelled';

      order.timeline.push({
        status: 'cancelled',
        timestamp: new Date(),
        note: 'Payment failed',
      });

      await order.save();
    }
  } catch (error) {
    console.error('Error handling payment failed:', error);
  }
}

async function handleOrderPaid(payload: any) {
  try {
    await connectDB();
    const razorpayOrder = payload.order.entity;
    const orderId = razorpayOrder.id;

    const order = await Order.findOne({
      'payment.transactionId': orderId,
    });

    if (order && order.payment.status !== 'paid') {
      order.payment.status = 'paid';
      order.payment.paidAt = new Date();
      order.status = 'confirmed';

      order.timeline.push({
        status: 'confirmed',
        timestamp: new Date(),
        note: 'Order paid via webhook',
      });

      await order.save();
    }
  } catch (error) {
    console.error('Error handling order paid:', error);
  }
}

export default router;

