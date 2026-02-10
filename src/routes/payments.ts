import { Router, Request, Response } from 'express';
import { verifyToken, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { createRazorpayOrder, verifyPaymentSignature } from '../config/razorpay';
import Order, { IOrder } from '../models/Order';
import Product from '../models/Product';
import Cart from '../models/Cart';
import User from '../models/User';
import StockMovement from '../models/StockMovement';
import Settings from '../models/Settings';
import { connectDB } from '../config/database';
import { sendOrderConfirmationEmail } from '../config/email';
import shippingProvider from '../services/shippingProvider';

const router = Router();

const AUTO_CREATE_SHIPMENT = process.env.AUTO_CREATE_SHIPMENT === 'true';

const createProviderShipmentAsync = async (
  orderId: string,
  options?: {
    defaultWeight?: number;
    defaultDimensions?: { length: number; breadth: number; height: number };
    defaultInsured?: boolean;
    defaultServiceType?: string;
  }
) => {
  try {
    if (!shippingProvider.isConfigured()) {
      console.log('[Shipping] Provider not configured, skipping auto-shipment creation');
      return;
    }

    const order = await Order.findById(orderId).populate('user', 'email firstName lastName');
    if (!order) {
      console.error('[Shipping] Order not found for shipment creation:', orderId);
      return;
    }

    // Don't create if already has tracking
    if (order.tracking?.providerOrderId || order.tracking?.shiprocketOrderId) {
      console.log('[Shipping] Shipment already exists for order:', order.orderNumber);
      return;
    }

    console.log('[Shipping] Auto-creating Blue Dart shipment for order:', order.orderNumber);

    const shipmentResult = await shippingProvider.createShipment(order, {
      autoPickup: true,
      weight: options?.defaultWeight,
      dimensions: options?.defaultDimensions,
      insured: options?.defaultInsured,
      serviceType: options?.defaultServiceType,
    });

    // Update order with tracking info
    order.tracking = {
      ...order.tracking,
      provider: 'bluedart',
      carrier: shipmentResult.courierName || 'Blue Dart',
      trackingNumber: shipmentResult.awbCode,
      trackingUrl: shipmentResult.trackingUrl,
      providerOrderId:
        shipmentResult.providerOrderId !== undefined && shipmentResult.providerOrderId !== null
          ? String(shipmentResult.providerOrderId)
          : undefined,
      providerShipmentId:
        shipmentResult.providerShipmentId !== undefined && shipmentResult.providerShipmentId !== null
          ? String(shipmentResult.providerShipmentId)
          : undefined,
      shiprocketOrderId: undefined,
      shipmentId: undefined,
    };

    // Update status to processing
    order.status = 'processing';
    order.timeline.push({
      status: 'processing',
      timestamp: new Date(),
      note: `Shipment auto-created with ${shipmentResult.courierName}`,
    });

    await order.save();
    console.log('[Shipping] Shipment created successfully:', shipmentResult.awbCode);
  } catch (error: any) {
    console.error('[Shipping] Auto-shipment creation failed (non-blocking):', error.message);
    // Don't throw - this is a non-blocking operation
  }
};

// Decrement product/variant inventory after successful payment
const decrementInventory = async (orderId: string) => {
  await connectDB();
  const order = await Order.findById(orderId);
  if (!order) return;

  for (let index = 0; index < order.items.length; index += 1) {
    const item = order.items[index];
    const product = await Product.findById(item.product);
    if (!product) continue;

    // Prevent duplicate stock deduction for the same order line (webhook retries, duplicate callbacks, etc.).
    const existingMovement = await StockMovement.findOne({
      product: product._id,
      type: 'sale',
      referenceType: 'order',
      referenceId: orderId,
      'metadata.lineIndex': index,
    }).select('_id');

    if (existingMovement) {
      continue;
    }

    let previousQuantity = product.inventory?.quantity ?? 0;
    let newQuantity = previousQuantity;
    let quantityChange = 0;

    if (item.variant) {
      const variantIndex = product.variants.findIndex(
        (v: any) => v._id.toString() === item.variant?.toString()
      );
      if (variantIndex !== -1) {
        const currentQty = product.variants[variantIndex].inventory?.quantity ?? 0;
        product.variants[variantIndex].inventory.quantity = Math.max(0, currentQty - item.quantity);
      }
    } else if (product.inventory?.trackQuantity) {
      const currentQty = product.inventory.quantity ?? 0;
      previousQuantity = currentQty;
      newQuantity = Math.max(0, currentQty - item.quantity);
      quantityChange = newQuantity - previousQuantity;
      product.inventory.quantity = newQuantity;
    }

    await product.save();

    if (quantityChange !== 0 || !item.variant) {
      await StockMovement.create({
        product: product._id,
        type: 'sale',
        quantityChange,
        previousQuantity,
        newQuantity,
        unit: 'PCS',
        note: `Inventory deducted for order ${order.orderNumber || orderId}`,
        referenceType: 'order',
        referenceId: orderId,
        movementDate: new Date(),
        metadata: {
          orderNumber: order.orderNumber,
          sku: item.sku,
          lineIndex: index,
          variantId: item.variant?.toString?.() || null,
        },
      });
    }
  }
};

/**
 * @route   POST /api/payments/create-order
 * @desc    Create Razorpay order. Request body.orderId = your DB order _id (for linking).
 *          Response order.id = Razorpay order ID (order_xxx) — use this for Razorpay checkout.
 * @access  Private
 */
router.post('/create-order', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    // Fail fast with clear message if Razorpay env is missing (e.g. on Vercel)
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return next(
        createError(
          'Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your deployment environment (e.g. Vercel Project Settings → Environment Variables).',
          503
        )
      );
    }

    const userId = req.user?._id;
    const { amount, currency = 'INR', orderId: dbOrderId } = req.body;

    if (!amount || amount <= 0) {
      return next(createError('Invalid amount', 400));
    }

    // Convert amount to paise (Razorpay expects amount in smallest currency unit; min 10 paise)
    const amountInPaise = Math.round(Number(amount) * 100);
    if (amountInPaise < 10) {
      return next(createError('Order amount is below Razorpay minimum (₹0.10)', 400));
    }

    // Receipt: max 40 chars, must be unique (Razorpay API requirement)
    const receipt = `rcpt_${Date.now()}`.slice(0, 40);

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
    const message = error?.message ?? 'Failed to create payment order';
    console.error('Error creating Razorpay order:', error);
    next(createError(String(message), 500));
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

      // Decrement inventory for purchased items
      await decrementInventory(orderId);

      // Send order confirmation email (best-effort)
      try {
        const user = await User.findById(order.user);
        if (user?.email) {
          await sendOrderConfirmationEmail(user.email, {
            orderNumber: order.orderNumber,
            items: order.items as any,
            pricing: order.pricing as any,
            shippingAddress: order.shippingAddress as any,
          });
        }
      } catch (emailError) {
        console.error('Order confirmation email failed:', emailError);
      }

      // Clear user's cart after successful payment
      await Cart.findOneAndDelete({ user: req.user?._id });

      // Auto-create shipment if enabled (non-blocking)
      const settings = await Settings.findOne().select(
        'shippingAutoCreateShipment shippingDefaultWeight shippingDefaultLength shippingDefaultBreadth shippingDefaultHeight shippingInsuredByDefault shippingDefaultServiceType'
      );
      const shouldAutoCreateShipment =
        settings?.shippingAutoCreateShipment !== undefined
          ? Boolean(settings.shippingAutoCreateShipment)
          : AUTO_CREATE_SHIPMENT;

      if (shouldAutoCreateShipment) {
        createProviderShipmentAsync(orderId, {
          defaultWeight:
            typeof settings?.shippingDefaultWeight === 'number' ? settings.shippingDefaultWeight : 0.5,
          defaultDimensions: {
            length:
              typeof settings?.shippingDefaultLength === 'number' ? settings.shippingDefaultLength : 15,
            breadth:
              typeof settings?.shippingDefaultBreadth === 'number'
                ? settings.shippingDefaultBreadth
                : 10,
            height:
              typeof settings?.shippingDefaultHeight === 'number' ? settings.shippingDefaultHeight : 5,
          },
          defaultInsured:
            settings?.shippingInsuredByDefault !== undefined
              ? Boolean(settings.shippingInsuredByDefault)
              : false,
          defaultServiceType: settings?.shippingDefaultServiceType || 'surface',
        }).catch(err => {
          console.error('[Shipping] Auto-shipment error (non-blocking):', err.message);
        });
      }
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
      await decrementInventory(order._id.toString());
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
      await decrementInventory(order._id.toString());
    }
  } catch (error) {
    console.error('Error handling order paid:', error);
  }
}

export default router;
