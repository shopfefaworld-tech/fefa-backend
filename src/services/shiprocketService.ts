/**
 * Shiprocket Service
 * 
 * Provides functions for creating shipments, generating AWBs, tracking orders,
 * and managing shipping through the Shiprocket API.
 */

import { shiprocketRequest, isShiprocketConfigured, SHIPROCKET_ENDPOINTS } from '../config/shiprocket';

// Types
export interface ShiprocketOrderItem {
  name: string;
  sku: string;
  units: number;
  selling_price: number;
  discount?: number;
  tax?: number;
  hsn?: string;
}

export interface ShiprocketAddress {
  billing_customer_name: string;
  billing_last_name?: string;
  billing_address: string;
  billing_address_2?: string;
  billing_city: string;
  billing_pincode: string;
  billing_state: string;
  billing_country: string;
  billing_email: string;
  billing_phone: string;
  shipping_is_billing?: boolean;
  shipping_customer_name?: string;
  shipping_last_name?: string;
  shipping_address?: string;
  shipping_address_2?: string;
  shipping_city?: string;
  shipping_pincode?: string;
  shipping_state?: string;
  shipping_country?: string;
  shipping_email?: string;
  shipping_phone?: string;
}

export interface CreateOrderPayload {
  order_id: string;
  order_date: string;
  pickup_location?: string;
  channel_id?: string;
  comment?: string;
  billing_customer_name: string;
  billing_last_name?: string;
  billing_address: string;
  billing_address_2?: string;
  billing_city: string;
  billing_pincode: string;
  billing_state: string;
  billing_country: string;
  billing_email: string;
  billing_phone: string;
  shipping_is_billing: boolean;
  shipping_customer_name?: string;
  shipping_last_name?: string;
  shipping_address?: string;
  shipping_address_2?: string;
  shipping_city?: string;
  shipping_pincode?: string;
  shipping_state?: string;
  shipping_country?: string;
  shipping_phone?: string;
  order_items: ShiprocketOrderItem[];
  payment_method: 'Prepaid' | 'COD';
  sub_total: number;
  length: number;
  breadth: number;
  height: number;
  weight: number;
}

export interface ShiprocketOrderResponse {
  order_id: number;
  shipment_id: number;
  status: string;
  status_code: number;
  onboarding_completed_now: number;
  awb_code: string;
  courier_company_id: number;
  courier_name: string;
}

export interface CourierServiceability {
  courier_company_id: number;
  courier_name: string;
  freight_charge: number;
  cod_charges: number;
  estimated_delivery_days: string;
  rate: number;
  city: string;
  min_weight: number;
  is_custom_rate: number;
  etd: string;
}

export interface TrackingData {
  tracking_data: {
    track_status: number;
    shipment_status: number;
    shipment_track: Array<{
      id: number;
      awb_code: string;
      courier_company_id: number;
      shipment_id: number;
      order_id: number;
      pickup_date: string;
      delivered_date: string;
      weight: string;
      packages: number;
      current_status: string;
      delivered_to: string;
      destination: string;
      consignee_name: string;
      origin: string;
      courier_agent_details: any;
      edd: string;
    }>;
    shipment_track_activities: Array<{
      date: string;
      status: string;
      activity: string;
      location: string;
      sr_status: string;
      sr_status_label: string;
    }>;
    track_url: string;
    etd: string;
  };
}

/**
 * Create an order in Shiprocket
 * This creates the order but doesn't assign a courier yet
 */
export const createShiprocketOrder = async (
  orderData: CreateOrderPayload
): Promise<ShiprocketOrderResponse> => {
  if (!isShiprocketConfigured()) {
    throw new Error('Shiprocket is not configured');
  }

  const response = await shiprocketRequest<ShiprocketOrderResponse>(
    SHIPROCKET_ENDPOINTS.CREATE_ORDER,
    {
      method: 'POST',
      body: orderData,
    }
  );

  console.log('[Shiprocket Service] Order created:', response.order_id);
  return response;
};

/**
 * Create order from internal order data
 * Transforms our Order model to Shiprocket format
 */
export const createShipmentFromOrder = async (
  order: any,
  options: {
    pickupLocation?: string;
    weight?: number; // in kg
    dimensions?: { length: number; breadth: number; height: number }; // in cm
  } = {}
): Promise<ShiprocketOrderResponse> => {
  if (!isShiprocketConfigured()) {
    throw new Error('Shiprocket is not configured');
  }

  const {
    pickupLocation = 'Primary',
    weight = 0.5, // Default 500g
    dimensions = { length: 15, breadth: 10, height: 5 }, // Default box size
  } = options;

  // Get user email
  let userEmail = '';
  if (typeof order.user === 'object' && order.user?.email) {
    userEmail = order.user.email;
  }

  // Format order date
  const orderDate = new Date(order.createdAt).toISOString().split('T')[0];

  // Prepare order items
  const orderItems: ShiprocketOrderItem[] = order.items.map((item: any) => ({
    name: item.name,
    sku: item.sku || `SKU-${item.product}`,
    units: item.quantity,
    selling_price: item.price,
    discount: 0,
    tax: 0,
  }));

  // Prepare shipping address
  const addr = order.shippingAddress;

  const payload: CreateOrderPayload = {
    order_id: order.orderNumber,
    order_date: orderDate,
    pickup_location: pickupLocation,
    billing_customer_name: addr.firstName,
    billing_last_name: addr.lastName || '',
    billing_address: addr.addressLine1,
    billing_address_2: addr.addressLine2 || '',
    billing_city: addr.city,
    billing_pincode: addr.postalCode,
    billing_state: addr.state,
    billing_country: addr.country || 'India',
    billing_email: userEmail || 'customer@fefajewelry.com',
    billing_phone: addr.phone,
    shipping_is_billing: true,
    order_items: orderItems,
    payment_method: order.payment?.method === 'cod' ? 'COD' : 'Prepaid',
    sub_total: order.pricing.total,
    length: dimensions.length,
    breadth: dimensions.breadth,
    height: dimensions.height,
    weight: weight,
  };

  return createShiprocketOrder(payload);
};

/**
 * Generate AWB (Airway Bill) for a shipment
 * This assigns a courier to the shipment
 */
export const generateAWB = async (
  shipmentId: number,
  courierId?: number
): Promise<{
  awb_assign_status: number;
  response: {
    data: {
      awb_code: string;
      courier_company_id: number;
      courier_name: string;
      child_courier_name: string;
      freight_charges: number;
      cod_charges: number;
      applied_weight: number;
      routing_code: string;
    };
  };
}> => {
  if (!isShiprocketConfigured()) {
    throw new Error('Shiprocket is not configured');
  }

  const body: any = { shipment_id: shipmentId };
  if (courierId) {
    body.courier_id = courierId;
  }

  const response = await shiprocketRequest(SHIPROCKET_ENDPOINTS.GENERATE_AWB, {
    method: 'POST',
    body,
  });

  console.log('[Shiprocket Service] AWB generated for shipment:', shipmentId);
  return response;
};

/**
 * Request pickup for a shipment
 */
export const requestPickup = async (
  shipmentId: number | number[]
): Promise<any> => {
  if (!isShiprocketConfigured()) {
    throw new Error('Shiprocket is not configured');
  }

  const shipmentIds = Array.isArray(shipmentId) ? shipmentId : [shipmentId];

  const response = await shiprocketRequest(SHIPROCKET_ENDPOINTS.REQUEST_PICKUP, {
    method: 'POST',
    body: { shipment_id: shipmentIds },
  });

  console.log('[Shiprocket Service] Pickup requested for shipments:', shipmentIds);
  return response;
};

/**
 * Track shipment by AWB number
 */
export const trackShipmentByAWB = async (awbCode: string): Promise<TrackingData> => {
  if (!isShiprocketConfigured()) {
    throw new Error('Shiprocket is not configured');
  }

  const response = await shiprocketRequest<TrackingData>(
    `${SHIPROCKET_ENDPOINTS.TRACK_AWB}/${awbCode}`,
    { method: 'GET' }
  );

  return response;
};

/**
 * Track shipment by shipment ID
 */
export const trackShipmentById = async (shipmentId: number): Promise<TrackingData> => {
  if (!isShiprocketConfigured()) {
    throw new Error('Shiprocket is not configured');
  }

  const response = await shiprocketRequest<TrackingData>(
    `${SHIPROCKET_ENDPOINTS.TRACK_SHIPMENT}/${shipmentId}`,
    { method: 'GET' }
  );

  return response;
};

/**
 * Cancel shipment by AWB codes
 */
export const cancelShipment = async (awbCodes: string[]): Promise<any> => {
  if (!isShiprocketConfigured()) {
    throw new Error('Shiprocket is not configured');
  }

  const response = await shiprocketRequest(SHIPROCKET_ENDPOINTS.CANCEL_SHIPMENT, {
    method: 'POST',
    body: { awbs: awbCodes },
  });

  console.log('[Shiprocket Service] Shipment cancelled for AWBs:', awbCodes);
  return response;
};

/**
 * Cancel order in Shiprocket
 */
export const cancelShiprocketOrder = async (orderIds: number[]): Promise<any> => {
  if (!isShiprocketConfigured()) {
    throw new Error('Shiprocket is not configured');
  }

  const response = await shiprocketRequest(SHIPROCKET_ENDPOINTS.CANCEL_ORDER, {
    method: 'POST',
    body: { ids: orderIds },
  });

  console.log('[Shiprocket Service] Orders cancelled:', orderIds);
  return response;
};

/**
 * Check courier serviceability for a pincode
 */
export const checkServiceability = async (
  pickupPincode: string,
  deliveryPincode: string,
  weight: number, // in kg
  cod: boolean = false
): Promise<{
  data: {
    available_courier_companies: CourierServiceability[];
    child_courier_id: number;
    is_recommendation_enabled: number;
    recommended_courier_company_id: number;
    shiprocket_recommended_courier_id: number;
  };
}> => {
  if (!isShiprocketConfigured()) {
    throw new Error('Shiprocket is not configured');
  }

  const response = await shiprocketRequest(SHIPROCKET_ENDPOINTS.CHECK_SERVICEABILITY, {
    method: 'GET',
    params: {
      pickup_postcode: pickupPincode,
      delivery_postcode: deliveryPincode,
      weight: weight,
      cod: cod ? 1 : 0,
    },
  });

  return response;
};

/**
 * Get all pickup locations
 */
export const getPickupLocations = async (): Promise<{
  data: {
    shipping_address: Array<{
      id: number;
      pickup_location: string;
      name: string;
      email: string;
      phone: string;
      address: string;
      address_2: string;
      city: string;
      state: string;
      country: string;
      pin_code: string;
      is_primary_location: number;
      status: number;
    }>;
  };
}> => {
  if (!isShiprocketConfigured()) {
    throw new Error('Shiprocket is not configured');
  }

  const response = await shiprocketRequest(SHIPROCKET_ENDPOINTS.GET_PICKUP_LOCATIONS, {
    method: 'GET',
  });

  return response;
};

/**
 * Generate shipping label
 */
export const generateLabel = async (
  shipmentId: number | number[]
): Promise<{ label_url: string; response: any }> => {
  if (!isShiprocketConfigured()) {
    throw new Error('Shiprocket is not configured');
  }

  const shipmentIds = Array.isArray(shipmentId) ? shipmentId : [shipmentId];

  const response = await shiprocketRequest(SHIPROCKET_ENDPOINTS.GENERATE_LABEL, {
    method: 'POST',
    body: { shipment_id: shipmentIds },
  });

  console.log('[Shiprocket Service] Label generated for shipments:', shipmentIds);
  return response;
};

/**
 * Generate manifest
 */
export const generateManifest = async (
  shipmentIds: number[]
): Promise<{ manifest_url: string; response: any }> => {
  if (!isShiprocketConfigured()) {
    throw new Error('Shiprocket is not configured');
  }

  const response = await shiprocketRequest(SHIPROCKET_ENDPOINTS.GENERATE_MANIFEST, {
    method: 'POST',
    body: { shipment_id: shipmentIds },
  });

  console.log('[Shiprocket Service] Manifest generated for shipments:', shipmentIds);
  return response;
};

/**
 * Full shipment creation flow
 * 1. Create order in Shiprocket
 * 2. Generate AWB (assign courier)
 * 3. Request pickup
 */
export const createFullShipment = async (
  order: any,
  options: {
    pickupLocation?: string;
    weight?: number;
    dimensions?: { length: number; breadth: number; height: number };
    courierId?: number;
    autoPickup?: boolean;
  } = {}
): Promise<{
  shiprocketOrderId: number;
  shipmentId: number;
  awbCode: string;
  courierName: string;
  trackingUrl?: string;
}> => {
  const { autoPickup = true, courierId, ...createOptions } = options;

  // Step 1: Create order
  const orderResponse = await createShipmentFromOrder(order, createOptions);

  if (!orderResponse.shipment_id) {
    throw new Error('Failed to create shipment - no shipment ID returned');
  }

  // Step 2: Generate AWB
  const awbResponse = await generateAWB(orderResponse.shipment_id, courierId);

  if (!awbResponse.response?.data?.awb_code) {
    throw new Error('Failed to generate AWB');
  }

  const awbData = awbResponse.response.data;

  // Step 3: Request pickup (optional)
  if (autoPickup) {
    try {
      await requestPickup(orderResponse.shipment_id);
    } catch (pickupError) {
      console.warn('[Shiprocket Service] Pickup request failed (non-critical):', pickupError);
    }
  }

  // Get tracking URL
  let trackingUrl: string | undefined;
  try {
    const trackingData = await trackShipmentByAWB(awbData.awb_code);
    trackingUrl = trackingData.tracking_data?.track_url;
  } catch (trackError) {
    console.warn('[Shiprocket Service] Could not get tracking URL:', trackError);
  }

  return {
    shiprocketOrderId: orderResponse.order_id,
    shipmentId: orderResponse.shipment_id,
    awbCode: awbData.awb_code,
    courierName: awbData.courier_name,
    trackingUrl,
  };
};

export default {
  createOrder: createShiprocketOrder,
  createShipmentFromOrder,
  createFullShipment,
  generateAWB,
  requestPickup,
  trackByAWB: trackShipmentByAWB,
  trackById: trackShipmentById,
  cancelShipment,
  cancelOrder: cancelShiprocketOrder,
  checkServiceability,
  getPickupLocations,
  generateLabel,
  generateManifest,
  isConfigured: isShiprocketConfigured,
};
