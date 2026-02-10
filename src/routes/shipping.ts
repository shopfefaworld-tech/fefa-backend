import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { verifyToken, AuthRequest, requireAdmin } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { connectDB } from '../config/database';
import Order from '../models/Order';
import Settings from '../models/Settings';
import shippingProvider from '../services/shippingProvider';
import { sendOrderShippedEmail, sendOrderDeliveredEmail } from '../config/email';
import { mapProviderStatusToOrderStatus } from '../utils/shippingStatusMap';

const router = Router();

const SHIPPING_CONFIG = {
  freeShippingThreshold: 1000,
  baseRate: 99,
  expressRate: 199,
  defaultPickupPincode: process.env.SHIPPING_PICKUP_PINCODE || '110001',
};

interface ShippingRuntimeConfig {
  provider: 'bluedart' | 'manual';
  autoCreateShipment: boolean;
  pickupPincode: string;
  defaultWeight: number;
  defaultDimensions: { length: number; breadth: number; height: number };
  defaultInsured: boolean;
  defaultServiceType: string;
}

const getShippingRuntimeConfig = async (): Promise<ShippingRuntimeConfig> => {
  const settings = await Settings.findOne().select(
    'shippingProvider shippingAutoCreateShipment shippingPickupPincode shippingDefaultWeight shippingDefaultLength shippingDefaultBreadth shippingDefaultHeight shippingInsuredByDefault shippingDefaultServiceType'
  );

  return {
    provider: (settings?.shippingProvider as 'bluedart' | 'manual') || 'bluedart',
    autoCreateShipment:
      settings?.shippingAutoCreateShipment !== undefined
        ? Boolean(settings.shippingAutoCreateShipment)
        : process.env.AUTO_CREATE_SHIPMENT === 'true',
    pickupPincode:
      settings?.shippingPickupPincode ||
      process.env.SHIPPING_PICKUP_PINCODE ||
      SHIPPING_CONFIG.defaultPickupPincode,
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
  };
};

const normalizeTrackingUrl = (tracking: any): string | undefined =>
  tracking?.trackingUrl || tracking?.url;

const normalizeProviderId = (value: unknown): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value);
};

router.post('/calculate', async (req: Request, res: Response) => {
  try {
    const { subtotal } = req.body;
    const useFreeShipping = typeof subtotal === 'number' && subtotal >= SHIPPING_CONFIG.freeShippingThreshold;

    return res.json({
      success: true,
      data: {
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
      },
    });
  } catch (error: any) {
    console.error('Shipping calculation error:', error);
    return res.status(500).json({ success: false, message: 'Failed to calculate shipping' });
  }
});

router.post('/check-serviceability', async (req: Request, res: Response) => {
  try {
    await connectDB();
    const { deliveryPincode, weight = 0.5, cod = false } = req.body;
    const runtimeConfig = await getShippingRuntimeConfig();

    if (!deliveryPincode) {
      return res.status(400).json({ success: false, message: 'Delivery pincode is required' });
    }

    if (!shippingProvider.isConfigured()) {
      return res.json({
        success: true,
        data: {
          serviceable: true,
          couriers: [],
          message: 'Shipping available (provider not configured for detailed check)',
        },
      });
    }

    const result = await shippingProvider.checkServiceability(
      runtimeConfig.pickupPincode,
      String(deliveryPincode),
      Number(weight) || 0.5,
      Boolean(cod)
    );

    return res.json({
      success: true,
      data: {
        serviceable: result.serviceable,
        couriers: result.couriers.map((courier) => ({
          id: courier.id,
          name: courier.name,
          rate: courier.rate,
          estimatedDays: courier.estimatedDays,
          cod: courier.codCharge,
        })),
        recommendedCourierId: result.recommendedCourierId,
      },
    });
  } catch (error: any) {
    console.error('Serviceability check error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to check serviceability',
    });
  }
});

router.post('/create-shipment/:orderId', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const { orderId } = req.params;
    const { weight, dimensions, courierId, declaredValue, insured, serviceType, autoPickup = true } = req.body;
    const runtimeConfig = await getShippingRuntimeConfig();

    if (!shippingProvider.isConfigured()) {
      return next(createError('Blue Dart is not configured', 400));
    }

    const order = await Order.findById(orderId).populate('user', 'email firstName lastName');
    if (!order) {
      return next(createError('Order not found', 404));
    }

    if (order.tracking?.providerOrderId || order.tracking?.shiprocketOrderId) {
      return next(createError('Shipment already created for this order', 400));
    }

    const shipmentResult = await shippingProvider.createShipment(order, {
      weight: typeof weight === 'number' ? weight : runtimeConfig.defaultWeight,
      dimensions: dimensions || runtimeConfig.defaultDimensions,
      courierId,
      declaredValue,
      insured: insured !== undefined ? Boolean(insured) : runtimeConfig.defaultInsured,
      serviceType: serviceType || runtimeConfig.defaultServiceType,
      autoPickup,
    });

    order.tracking = {
      ...order.tracking,
      provider: 'bluedart',
      carrier: shipmentResult.courierName || 'Blue Dart',
      trackingNumber: shipmentResult.awbCode,
      trackingUrl: shipmentResult.trackingUrl,
      providerOrderId: normalizeProviderId(shipmentResult.providerOrderId),
      providerShipmentId: normalizeProviderId(shipmentResult.providerShipmentId),
      shiprocketOrderId: undefined,
      shipmentId: undefined,
    } as any;

    if (order.status === 'confirmed') {
      order.status = 'processing';
      order.timeline.push({
        status: 'processing',
        timestamp: new Date(),
        note: `Shipment created with ${shipmentResult.courierName || 'Blue Dart'}`,
      });
    }

    await order.save();

    return res.status(200).json({
      success: true,
      message: 'Shipment created successfully',
      data: {
        providerOrderId: shipmentResult.providerOrderId,
        providerShipmentId: shipmentResult.providerShipmentId,
        awbCode: shipmentResult.awbCode,
        courierName: shipmentResult.courierName || 'Blue Dart',
        trackingUrl: shipmentResult.trackingUrl,
      },
    });
  } catch (error: any) {
    console.error('Create shipment error:', error);
    return next(createError(error.message || 'Failed to create shipment', 500));
  }
});

router.get('/track/:orderId', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const { orderId } = req.params;
    const userId = req.user?._id;
    const userRole = req.user?.role;
    const isAdmin = userRole === 'admin' || userRole === 'super_admin';

    const query: any = { _id: orderId };
    if (!isAdmin) query.user = userId;

    const order = await Order.findOne(query);
    if (!order) {
      return next(createError('Order not found', 404));
    }

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

    if (!shippingProvider.isConfigured()) {
      return res.json({
        success: true,
        data: {
          status: order.status,
          trackingNumber: order.tracking.trackingNumber,
          carrier: order.tracking.carrier,
          trackingUrl: normalizeTrackingUrl(order.tracking),
          message: 'Real-time tracking not available (provider not configured)',
        },
      });
    }

    try {
      const tracking = await shippingProvider.trackByAwb(order.tracking.trackingNumber);

      return res.json({
        success: true,
        data: {
          status: order.status,
          trackingNumber: order.tracking.trackingNumber,
          carrier: order.tracking.carrier,
          trackingUrl: tracking.trackingUrl || normalizeTrackingUrl(order.tracking),
          currentStatus: tracking.currentStatus,
          estimatedDelivery: tracking.estimatedDelivery,
          activities: tracking.activities.map((activity) => ({
            date: activity.date,
            status: activity.status,
            activity: activity.activity,
            location: activity.location,
          })),
        },
      });
    } catch (trackError: any) {
      console.error('Blue Dart tracking error:', trackError);
      return res.json({
        success: true,
        data: {
          status: order.status,
          trackingNumber: order.tracking.trackingNumber,
          carrier: order.tracking.carrier,
          trackingUrl: normalizeTrackingUrl(order.tracking),
          message: 'Could not fetch real-time tracking',
        },
      });
    }
  } catch (error: any) {
    console.error('Track shipment error:', error);
    return next(createError(error.message || 'Failed to track shipment', 500));
  }
});

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

    if (shippingProvider.isConfigured()) {
      try {
        const shipmentReference =
          order.tracking.providerShipmentId ||
          order.tracking.shipmentId ||
          order.tracking.trackingNumber;
        await shippingProvider.cancelShipment(String(shipmentReference));
      } catch (cancelError: any) {
        console.error('Blue Dart cancel error:', cancelError);
      }
    }

    order.tracking = undefined;
    order.timeline.push({
      status: order.status,
      timestamp: new Date(),
      note: 'Shipment cancelled',
    });

    await order.save();

    return res.status(200).json({
      success: true,
      message: 'Shipment cancelled successfully',
    });
  } catch (error: any) {
    console.error('Cancel shipment error:', error);
    return next(createError(error.message || 'Failed to cancel shipment', 500));
  }
});

router.get(
  '/pickup-locations',
  verifyToken,
  requireAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!shippingProvider.isConfigured()) {
        res.json({
          success: true,
          data: [],
          message: 'Blue Dart not configured',
        });
        return;
      }

      const locations = await shippingProvider.getPickupLocations();
      res.json({
        success: true,
        data: locations,
      });
    } catch (error: any) {
      console.error('Get pickup locations error:', error);
      next(createError(error.message || 'Failed to fetch pickup locations', 500));
    }
  }
);

router.post('/generate-label/:orderId', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const { orderId } = req.params;

    if (!shippingProvider.isConfigured()) {
      return next(createError('Blue Dart not configured', 400));
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return next(createError('Order not found', 404));
    }

    const shipmentReference =
      order.tracking?.providerShipmentId ||
      (order.tracking as any)?.shipmentId ||
      order.tracking?.trackingNumber;

    if (!shipmentReference) {
      return next(createError('No shipment found for this order', 400));
    }

    const result = await shippingProvider.generateLabel(String(shipmentReference));

    return res.json({
      success: true,
      data: {
        labelUrl: result.labelUrl,
      },
    });
  } catch (error: any) {
    console.error('Generate label error:', error);
    return next(createError(error.message || 'Failed to generate label', 500));
  }
});

router.get('/admin/status', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const runtimeConfig = await getShippingRuntimeConfig();

    return res.json({
      success: true,
      data: {
        provider: runtimeConfig.provider,
        configured: shippingProvider.isConfigured(),
        autoCreateShipment: runtimeConfig.autoCreateShipment,
        pickupPincode: runtimeConfig.pickupPincode,
        defaults: {
          weight: runtimeConfig.defaultWeight,
          dimensions: runtimeConfig.defaultDimensions,
          insured: runtimeConfig.defaultInsured,
          serviceType: runtimeConfig.defaultServiceType,
        },
      },
    });
  } catch (error: any) {
    return next(createError(error.message || 'Failed to fetch shipping status', 500));
  }
});

router.get('/admin/config', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const runtimeConfig = await getShippingRuntimeConfig();
    return res.json({
      success: true,
      data: runtimeConfig,
    });
  } catch (error: any) {
    return next(createError(error.message || 'Failed to fetch shipping config', 500));
  }
});

router.put('/admin/config', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({
        storeName: 'FEFA Jewelry',
        storeEmail: process.env.SMTP_USER || 'contact@fefajewelry.com',
        emailFrom: process.env.SMTP_USER || 'contact@fefajewelry.com',
      });
    }

    const body = req.body || {};
    if (body.provider) settings.shippingProvider = body.provider;
    if (body.autoCreateShipment !== undefined) {
      settings.shippingAutoCreateShipment = Boolean(body.autoCreateShipment);
    }
    if (body.pickupPincode) settings.shippingPickupPincode = String(body.pickupPincode);
    if (body.defaultWeight !== undefined) settings.shippingDefaultWeight = Number(body.defaultWeight);
    if (body.defaultDimensions?.length !== undefined) {
      settings.shippingDefaultLength = Number(body.defaultDimensions.length);
    }
    if (body.defaultDimensions?.breadth !== undefined) {
      settings.shippingDefaultBreadth = Number(body.defaultDimensions.breadth);
    }
    if (body.defaultDimensions?.height !== undefined) {
      settings.shippingDefaultHeight = Number(body.defaultDimensions.height);
    }
    if (body.defaultInsured !== undefined) {
      settings.shippingInsuredByDefault = Boolean(body.defaultInsured);
    }
    if (body.defaultServiceType) settings.shippingDefaultServiceType = String(body.defaultServiceType);

    await settings.save();

    const runtimeConfig = await getShippingRuntimeConfig();
    return res.json({
      success: true,
      message: 'Shipping config updated successfully',
      data: runtimeConfig,
    });
  } catch (error: any) {
    return next(createError(error.message || 'Failed to update shipping config', 500));
  }
});

router.post('/admin/test-connection', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    if (!shippingProvider.isConfigured()) {
      return res.status(400).json({
        success: false,
        message: 'Blue Dart is not configured',
      });
    }

    let check: any = null;
    try {
      const runtimeConfig = await getShippingRuntimeConfig();
      check = await shippingProvider.checkServiceability(
        runtimeConfig.pickupPincode,
        runtimeConfig.pickupPincode,
        runtimeConfig.defaultWeight,
        false
      );
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: error.message || 'Connection test failed',
      });
    }

    return res.json({
      success: true,
      message: 'Blue Dart connection is working',
      data: {
        configured: true,
        serviceableSelfCheck: check?.serviceable ?? null,
      },
    });
  } catch (error: any) {
    return next(createError(error.message || 'Failed to test shipping connection', 500));
  }
});

router.post('/admin/request-pickup/:orderId', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const order = await Order.findById(req.params.orderId);
    if (!order) {
      return next(createError('Order not found', 404));
    }

    const shipmentReference =
      order.tracking?.providerShipmentId ||
      (order.tracking as any)?.shipmentId ||
      order.tracking?.trackingNumber;

    if (!shipmentReference) {
      return next(createError('No shipment found for this order', 400));
    }

    await shippingProvider.requestPickup(String(shipmentReference));
    order.timeline.push({
      status: order.status,
      timestamp: new Date(),
      note: 'Pickup requested from Blue Dart',
    } as any);
    await order.save();

    return res.json({
      success: true,
      message: 'Pickup requested successfully',
    });
  } catch (error: any) {
    return next(createError(error.message || 'Failed to request pickup', 500));
  }
});

router.post('/admin/refresh-tracking/:orderId', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const order = await Order.findById(req.params.orderId);
    if (!order) {
      return next(createError('Order not found', 404));
    }
    if (!order.tracking?.trackingNumber) {
      return next(createError('Tracking number not found for this order', 400));
    }

    const tracking = await shippingProvider.trackByAwb(order.tracking.trackingNumber);
    if (tracking.trackingUrl) {
      order.tracking.trackingUrl = tracking.trackingUrl;
    }
    if (tracking.estimatedDelivery) {
      order.tracking.estimatedDelivery = new Date(tracking.estimatedDelivery);
    }

    const mappedStatus = mapProviderStatusToOrderStatus(undefined, tracking.currentStatus);
    if (mappedStatus && mappedStatus !== order.status) {
      order.status = mappedStatus as any;
      order.timeline.push({
        status: mappedStatus,
        timestamp: new Date(),
        note: `Blue Dart tracking refresh: ${tracking.currentStatus || 'Status updated'}`,
      } as any);
    }

    await order.save();
    return res.json({
      success: true,
      message: 'Tracking refreshed successfully',
      data: tracking,
    });
  } catch (error: any) {
    return next(createError(error.message || 'Failed to refresh tracking', 500));
  }
});

router.post('/webhook', async (req: Request, res: Response) => {
  try {
    await connectDB();

    const webhookSecret = process.env.SHIPPING_WEBHOOK_SECRET;
    if (webhookSecret) {
      const signature = (req.headers['x-shipping-signature'] as string) || '';
      if (signature) {
        const digest = crypto
          .createHmac('sha256', webhookSecret)
          .update(JSON.stringify(req.body))
          .digest('hex');
        if (digest !== signature) {
          return res.status(401).json({ received: false, message: 'Invalid webhook signature' });
        }
      }
    }

    const awb =
      req.body?.awb ||
      req.body?.awbCode ||
      req.body?.waybill ||
      req.body?.tracking_number;
    const currentStatus =
      req.body?.current_status ||
      req.body?.status ||
      req.body?.statusText ||
      req.body?.event;
    const currentStatusId =
      req.body?.current_status_id ||
      req.body?.status_id ||
      req.body?.statusCode;
    const providerOrderId =
      req.body?.order_id ||
      req.body?.orderId ||
      req.body?.providerOrderId ||
      req.body?.reference_number;
    const etd = req.body?.etd || req.body?.estimated_delivery || req.body?.edd;

    console.log('[Blue Dart Webhook] Received:', { awb, currentStatus, providerOrderId });

    if (!awb && !providerOrderId) {
      return res.status(400).json({ error: 'Missing awb or provider order id' });
    }

    const query: any = {};
    if (awb) {
      query['tracking.trackingNumber'] = awb;
    } else if (providerOrderId) {
      query.$or = [
        { 'tracking.providerOrderId': String(providerOrderId) },
        { 'tracking.shiprocketOrderId': Number(providerOrderId) },
      ];
    }

    const order = await Order.findOne(query).populate('user', 'email firstName lastName');
    if (!order) {
      console.log('[Blue Dart Webhook] Order not found for:', query);
      return res.status(200).json({ received: true, message: 'Order not found' });
    }

    const newStatus = mapProviderStatusToOrderStatus(currentStatusId, currentStatus);
    const previousStatus = order.status;

    if (newStatus && newStatus !== order.status) {
      order.status = newStatus as any;
      order.timeline.push({
        status: newStatus,
        timestamp: new Date(),
        note: `Blue Dart: ${currentStatus || 'Status update'}`,
      } as any);

      if (etd && order.tracking) {
        order.tracking.estimatedDelivery = new Date(etd);
      }

      await order.save();

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
                trackingUrl: normalizeTrackingUrl(order.tracking),
                estimatedDelivery: etd,
              }
            );
          } else if (newStatus === 'delivered' && previousStatus !== 'delivered') {
            await sendOrderDeliveredEmail(userEmail, {
              orderNumber: order.orderNumber,
              items: order.items.map((item: any) => ({
                name: item.name,
                quantity: item.quantity,
              })),
            });
          }
        }
      } catch (emailError) {
        console.error('[Blue Dart Webhook] Email send failed:', emailError);
      }
    }

    return res.status(200).json({ received: true, status: 'processed' });
  } catch (error: any) {
    console.error('[Blue Dart Webhook] Error:', error);
    return res.status(200).json({ received: true, error: error.message });
  }
});

export default router;
