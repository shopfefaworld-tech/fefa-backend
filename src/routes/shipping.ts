import { Router, Request, Response, NextFunction } from 'express';
import { verifyToken, AuthRequest, requireAdmin } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { connectDB } from '../config/database';
import Order from '../models/Order';
import User from '../models/User';
import shiprocketService from '../services/shiprocketService';
import { sendOrderShippedEmail, sendOrderDeliveredEmail } from '../config/email';

const router = Router();

// Simple configurable shipping calculation
const SHIPPING_CONFIG = {
  freeShippingThreshold: 1000,
  baseRate: 99,
  expressRate: 199,
  defaultPickupPincode: process.env.SHIPROCKET_PICKUP_PINCODE || '110001', // Delhi default
};

/**
 * @route   POST /api/shipping/calculate
 * @desc    Calculate shipping cost (simple calculation)
 * @access  Public
 */
router.post('/calculate', async (req: Request, res: Response) => {
  try {
    const { subtotal } = req.body;

    const useFreeShipping = typeof subtotal === 'number' && subtotal >= SHIPPING_CONFIG.freeShippingThreshold;

    const data = {
      standard: {
        cost: useFreeShipping ? 0 : SHIPPING_CONFIG.baseRate,
        days: '5-7 business days',
        label: useFreeShipping ? 'Free Shipping' : 'Standard Shipping',
      },
      express: {
        cost: SHIPPING_CONFIG.expressRate,
        days: '1-2 business days',
        label: 'Express Delivery',
      },
    };

    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('Shipping calculation error:', error);
    return res.status(500).json({ success: false, message: 'Failed to calculate shipping' });
  }
});

/**
 * @route   POST /api/shipping/check-serviceability
 * @desc    Check if shipping is available to a pincode via Shiprocket
 * @access  Public
 */
router.post('/check-serviceability', async (req: Request, res: Response) => {
  try {
    const { deliveryPincode, weight = 0.5, cod = false } = req.body;

    if (!deliveryPincode) {
      return res.status(400).json({ success: false, message: 'Delivery pincode is required' });
    }

    // Check if Shiprocket is configured
    if (!shiprocketService.isConfigured()) {
      // Return basic availability if Shiprocket not configured
      return res.json({
        success: true,
        data: {
          serviceable: true,
          couriers: [],
          message: 'Shipping available (Shiprocket not configured for detailed check)',
        },
      });
    }

    const result = await shiprocketService.checkServiceability(
      SHIPPING_CONFIG.defaultPickupPincode,
      deliveryPincode,
      weight,
      cod
    );

    const couriers = result.data?.available_courier_companies || [];

    return res.json({
      success: true,
      data: {
        serviceable: couriers.length > 0,
        couriers: couriers.map((c) => ({
          id: c.courier_company_id,
          name: c.courier_name,
          rate: c.rate,
          estimatedDays: c.estimated_delivery_days,
          cod: c.cod_charges,
        })),
        recommendedCourierId: result.data?.recommended_courier_company_id,
      },
    });
  } catch (error: any) {
    console.error('Serviceability check error:', error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to check serviceability' 
    });
  }
});

/**
 * @route   POST /api/shipping/create-shipment/:orderId
 * @desc    Create a shipment in Shiprocket for an order
 * @access  Private/Admin
 */
router.post('/create-shipment/:orderId', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const { orderId } = req.params;
    const { weight, dimensions, courierId, autoPickup = true } = req.body;

    // Check if Shiprocket is configured
    if (!shiprocketService.isConfigured()) {
      return next(createError('Shiprocket is not configured', 400));
    }

    // Get the order
    const order = await Order.findById(orderId).populate('user', 'email firstName lastName');
    if (!order) {
      return next(createError('Order not found', 404));
    }

    // Check if shipment already exists
    if (order.tracking?.shiprocketOrderId) {
      return next(createError('Shipment already created for this order', 400));
    }

    // Create full shipment (order + AWB + pickup)
    const shipmentResult = await shiprocketService.createFullShipment(order, {
      weight,
      dimensions,
      courierId,
      autoPickup,
    });

    // Update order with tracking information
    order.tracking = {
      carrier: shipmentResult.courierName,
      trackingNumber: shipmentResult.awbCode,
      trackingUrl: shipmentResult.trackingUrl,
      shiprocketOrderId: shipmentResult.shiprocketOrderId,
      shipmentId: shipmentResult.shipmentId,
    };

    // Update status to processing if still confirmed
    if (order.status === 'confirmed') {
      order.status = 'processing';
      order.timeline.push({
        status: 'processing',
        timestamp: new Date(),
        note: `Shipment created with ${shipmentResult.courierName}`,
      });
    }

    await order.save();

    res.status(200).json({
      success: true,
      message: 'Shipment created successfully',
      data: {
        shiprocketOrderId: shipmentResult.shiprocketOrderId,
        shipmentId: shipmentResult.shipmentId,
        awbCode: shipmentResult.awbCode,
        courierName: shipmentResult.courierName,
        trackingUrl: shipmentResult.trackingUrl,
      },
    });
  } catch (error: any) {
    console.error('Create shipment error:', error);
    next(createError(error.message || 'Failed to create shipment', 500));
  }
});

/**
 * @route   GET /api/shipping/track/:orderId
 * @desc    Track shipment for an order
 * @access  Private
 */
router.get('/track/:orderId', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const { orderId } = req.params;
    const userId = req.user?._id;
    const userRole = req.user?.role;
    const isAdmin = userRole === 'admin' || userRole === 'super_admin';

    // Get the order
    const query: any = { _id: orderId };
    if (!isAdmin) {
      query.user = userId;
    }

    const order = await Order.findOne(query);
    if (!order) {
      return next(createError('Order not found', 404));
    }

    // Check if we have tracking info
    if (!order.tracking?.trackingNumber) {
      return res.json({
        success: true,
        data: {
          status: order.status,
          message: 'Tracking information not yet available',
          tracking: null,
        },
      });
    }

    // Check if Shiprocket is configured
    if (!shiprocketService.isConfigured()) {
      return res.json({
        success: true,
        data: {
          status: order.status,
          trackingNumber: order.tracking.trackingNumber,
          carrier: order.tracking.carrier,
          trackingUrl: order.tracking.trackingUrl,
          message: 'Real-time tracking not available (Shiprocket not configured)',
        },
      });
    }

    // Get real-time tracking from Shiprocket
    try {
      const trackingData = await shiprocketService.trackByAWB(order.tracking.trackingNumber);
      
      const shipmentTrack = trackingData.tracking_data?.shipment_track?.[0];
      const activities = trackingData.tracking_data?.shipment_track_activities || [];

      return res.json({
        success: true,
        data: {
          status: order.status,
          trackingNumber: order.tracking.trackingNumber,
          carrier: order.tracking.carrier,
          trackingUrl: trackingData.tracking_data?.track_url || order.tracking.trackingUrl,
          currentStatus: shipmentTrack?.current_status,
          estimatedDelivery: shipmentTrack?.edd || trackingData.tracking_data?.etd,
          activities: activities.map((a) => ({
            date: a.date,
            status: a.status,
            activity: a.activity,
            location: a.location,
          })),
        },
      });
    } catch (trackError: any) {
      console.error('Shiprocket tracking error:', trackError);
      // Return basic info if tracking fails
      return res.json({
        success: true,
        data: {
          status: order.status,
          trackingNumber: order.tracking.trackingNumber,
          carrier: order.tracking.carrier,
          trackingUrl: order.tracking.trackingUrl,
          message: 'Could not fetch real-time tracking',
        },
      });
    }
  } catch (error: any) {
    console.error('Track shipment error:', error);
    next(createError(error.message || 'Failed to track shipment', 500));
  }
});

/**
 * @route   POST /api/shipping/cancel/:orderId
 * @desc    Cancel shipment for an order
 * @access  Private/Admin
 */
router.post('/cancel/:orderId', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const { orderId } = req.params;

    const order = await Order.findById(orderId);
    if (!order) {
      return next(createError('Order not found', 404));
    }

    if (!order.tracking?.trackingNumber) {
      return next(createError('No shipment to cancel', 400));
    }

    // Check if Shiprocket is configured
    if (shiprocketService.isConfigured()) {
      try {
        await shiprocketService.cancelShipment([order.tracking.trackingNumber]);
      } catch (cancelError: any) {
        console.error('Shiprocket cancel error:', cancelError);
        // Continue even if Shiprocket cancel fails
      }
    }

    // Clear tracking info
    order.tracking = undefined;
    order.timeline.push({
      status: order.status,
      timestamp: new Date(),
      note: 'Shipment cancelled',
    });

    await order.save();

    res.status(200).json({
      success: true,
      message: 'Shipment cancelled successfully',
    });
  } catch (error: any) {
    console.error('Cancel shipment error:', error);
    next(createError(error.message || 'Failed to cancel shipment', 500));
  }
});

/**
 * @route   GET /api/shipping/pickup-locations
 * @desc    Get available pickup locations from Shiprocket
 * @access  Private/Admin
 */
router.get(
  '/pickup-locations',
  verifyToken,
  requireAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!shiprocketService.isConfigured()) {
        res.json({
          success: true,
          data: [],
          message: 'Shiprocket not configured',
        });
        return;
      }

      const result = await shiprocketService.getPickupLocations();
      const locations = result.data?.shipping_address || [];

      res.json({
        success: true,
        data: locations.map((loc) => ({
          id: loc.id,
          name: loc.pickup_location,
          address: `${loc.address}, ${loc.city}, ${loc.state} ${loc.pin_code}`,
          phone: loc.phone,
          isPrimary: loc.is_primary_location === 1,
        })),
      });
    } catch (error: any) {
      console.error('Get pickup locations error:', error);
      next(createError(error.message || 'Failed to fetch pickup locations', 500));
    }
  }
);

/**
 * @route   POST /api/shipping/generate-label/:orderId
 * @desc    Generate shipping label for an order
 * @access  Private/Admin
 */
router.post('/generate-label/:orderId', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const { orderId } = req.params;

    if (!shiprocketService.isConfigured()) {
      return next(createError('Shiprocket not configured', 400));
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return next(createError('Order not found', 404));
    }

    if (!order.tracking?.shipmentId) {
      return next(createError('No shipment found for this order', 400));
    }

    const result = await shiprocketService.generateLabel(order.tracking.shipmentId);

    res.json({
      success: true,
      data: {
        labelUrl: result.label_url,
      },
    });
  } catch (error: any) {
    console.error('Generate label error:', error);
    next(createError(error.message || 'Failed to generate label', 500));
  }
});

/**
 * @route   POST /api/shipping/webhook
 * @desc    Webhook endpoint for Shiprocket status updates
 * @access  Public (verified by Shiprocket)
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    await connectDB();
    
    const { 
      awb, 
      current_status, 
      current_status_id,
      order_id,
      etd,
      scans,
    } = req.body;

    console.log('[Shiprocket Webhook] Received:', { awb, current_status, order_id });

    if (!awb && !order_id) {
      return res.status(400).json({ error: 'Missing awb or order_id' });
    }

    // Find order by AWB or Shiprocket order ID
    const query: any = {};
    if (awb) {
      query['tracking.trackingNumber'] = awb;
    } else if (order_id) {
      query['tracking.shiprocketOrderId'] = order_id;
    }

    const order = await Order.findOne(query).populate('user', 'email firstName lastName');

    if (!order) {
      console.log('[Shiprocket Webhook] Order not found for:', query);
      return res.status(200).json({ received: true, message: 'Order not found' });
    }

    // Map Shiprocket status to our order status
    const statusMap: Record<number, string> = {
      1: 'processing',   // AWB Assigned
      2: 'processing',   // Label Generated
      3: 'processing',   // Pickup Scheduled
      4: 'processing',   // Pickup Queued
      5: 'processing',   // Manifest Generated
      6: 'shipped',      // Shipped
      7: 'shipped',      // Delivered
      8: 'shipped',      // In Transit
      9: 'shipped',      // Out for Delivery
      17: 'delivered',   // Delivered
      18: 'cancelled',   // Cancelled
      19: 'returned',    // RTO Initiated
      20: 'returned',    // RTO Delivered
    };

    const newStatus = statusMap[current_status_id];
    const previousStatus = order.status;

    // Update order status if changed
    if (newStatus && newStatus !== order.status) {
      order.status = newStatus as any;
      order.timeline.push({
        status: newStatus as any,
        timestamp: new Date(),
        note: `Shiprocket: ${current_status}`,
      });

      // Update estimated delivery if available
      if (etd && order.tracking) {
        order.tracking.estimatedDelivery = new Date(etd);
      }

      await order.save();

      // Send appropriate email based on new status
      try {
        let userEmail: string | null = null;
        if (typeof order.user === 'object' && (order.user as any)?.email) {
          userEmail = (order.user as any).email;
        }

        if (userEmail) {
          if (newStatus === 'shipped' && previousStatus !== 'shipped') {
            await sendOrderShippedEmail(
              userEmail,
              {
                orderNumber: order.orderNumber,
                items: order.items.map((item: any) => ({
                  name: item.name,
                  quantity: item.quantity,
                  price: item.price,
                  total: item.total,
                })),
                shippingAddress: order.shippingAddress,
              },
              {
                carrier: order.tracking?.carrier,
                trackingNumber: order.tracking?.trackingNumber || awb,
                trackingUrl: order.tracking?.trackingUrl,
                estimatedDelivery: etd,
              }
            );
            console.log(`[Shiprocket Webhook] Shipped email sent for order ${order.orderNumber}`);
          } else if (newStatus === 'delivered' && previousStatus !== 'delivered') {
            await sendOrderDeliveredEmail(userEmail, {
              orderNumber: order.orderNumber,
              items: order.items.map((item: any) => ({
                name: item.name,
                quantity: item.quantity,
              })),
            });
            console.log(`[Shiprocket Webhook] Delivered email sent for order ${order.orderNumber}`);
          }
        }
      } catch (emailError) {
        console.error('[Shiprocket Webhook] Email send failed:', emailError);
      }
    }

    return res.status(200).json({ received: true, status: 'processed' });
  } catch (error: any) {
    console.error('[Shiprocket Webhook] Error:', error);
    // Always return 200 to acknowledge receipt
    return res.status(200).json({ received: true, error: error.message });
  }
});

export default router;
