import {
  bluedartRequest,
  getBlueDartConfig,
  getBlueDartEndpoint,
  isBlueDartConfigured,
} from '../config/bluedart';

export interface BlueDartCourierOption {
  id: string | number;
  name: string;
  rate?: number;
  estimatedDays?: string;
  codCharge?: number;
}

export interface BlueDartServiceabilityResult {
  serviceable: boolean;
  couriers: BlueDartCourierOption[];
  recommendedCourierId?: string | number;
  raw?: any;
}

export interface BlueDartShipmentResult {
  providerOrderId?: string | number;
  providerShipmentId?: string | number;
  awbCode?: string;
  courierName?: string;
  trackingUrl?: string;
  pickupRequested?: boolean;
  raw?: any;
}

export interface BlueDartTrackingActivity {
  date?: string;
  status?: string;
  activity?: string;
  location?: string;
}

export interface BlueDartTrackingResult {
  trackingNumber?: string;
  currentStatus?: string;
  estimatedDelivery?: string;
  trackingUrl?: string;
  activities: BlueDartTrackingActivity[];
  raw?: any;
}

const asArray = (value: any): any[] => (Array.isArray(value) ? value : []);

const pickFirst = (source: any, keys: string[]): any => {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null && source[key] !== '') {
      return source[key];
    }
  }
  return undefined;
};

const makeTrackingUrl = (awbCode?: string): string | undefined => {
  if (!awbCode) return undefined;
  const template = getBlueDartConfig().trackingUrlTemplate;
  if (!template) return undefined;
  return template.replace('{awb}', encodeURIComponent(awbCode));
};

export const checkServiceability = async (
  pickupPincode: string,
  deliveryPincode: string,
  weight: number,
  cod: boolean
): Promise<BlueDartServiceabilityResult> => {
  if (!isBlueDartConfigured()) {
    throw new Error('Blue Dart is not configured');
  }

  const endpoint = getBlueDartEndpoint('SERVICEABILITY');
  const data = await bluedartRequest<any>(endpoint, {
    method: 'POST',
    body: {
      pickupPincode,
      deliveryPincode,
      weight,
      cod,
    },
  });

  const candidates = asArray(
    data?.couriers ||
      data?.data?.couriers ||
      data?.available_courier_companies ||
      data?.data?.available_courier_companies
  );

  const couriers: BlueDartCourierOption[] = candidates.map((item: any, index) => ({
    id: pickFirst(item, ['id', 'courier_company_id', 'code']) || `courier-${index + 1}`,
    name: pickFirst(item, ['name', 'courier_name', 'service']) || 'Blue Dart',
    rate: Number(pickFirst(item, ['rate', 'freight_charge', 'charge']) || 0),
    estimatedDays: String(
      pickFirst(item, ['estimatedDays', 'estimated_delivery_days', 'eta_days', 'transit_days']) || ''
    ).trim() || undefined,
    codCharge: Number(pickFirst(item, ['cod_charges', 'codCharge']) || 0),
  }));

  const recommendedCourierId = pickFirst(data, [
    'recommendedCourierId',
    'recommended_courier_company_id',
    'recommendedCourier',
  ]);

  return {
    serviceable:
      Boolean(data?.serviceable) ||
      Boolean(data?.data?.serviceable) ||
      couriers.length > 0,
    couriers,
    recommendedCourierId,
    raw: data,
  };
};

export const requestPickup = async (shipmentIdOrAwb: string | number): Promise<any> => {
  if (!isBlueDartConfigured()) {
    throw new Error('Blue Dart is not configured');
  }

  const endpoint = getBlueDartEndpoint('REQUEST_PICKUP');
  return bluedartRequest(endpoint, {
    method: 'POST',
    body: {
      shipmentId: shipmentIdOrAwb,
      awb: shipmentIdOrAwb,
    },
  });
};

export const createShipment = async (
  order: any,
  options: {
    weight?: number;
    dimensions?: { length: number; breadth: number; height: number };
    courierId?: string | number;
    declaredValue?: number;
    insured?: boolean;
    serviceType?: string;
    autoPickup?: boolean;
  } = {}
): Promise<BlueDartShipmentResult> => {
  if (!isBlueDartConfigured()) {
    throw new Error('Blue Dart is not configured');
  }

  const {
    weight = 0.5,
    dimensions = { length: 15, breadth: 10, height: 5 },
    courierId,
    declaredValue,
    insured = false,
    serviceType,
    autoPickup = true,
  } = options;

  const endpoint = getBlueDartEndpoint('CREATE_SHIPMENT');

  const payload = {
    orderNumber: order.orderNumber,
    orderDate: new Date(order.createdAt).toISOString(),
    paymentMethod: order.payment?.method === 'cod' ? 'COD' : 'Prepaid',
    courierId,
    parcel: {
      weight,
      length: dimensions.length,
      breadth: dimensions.breadth,
      height: dimensions.height,
      declaredValue: declaredValue ?? order.pricing?.total ?? 0,
      insured,
      serviceType: serviceType || 'surface',
      specialHandling: 'jewellery-fragile',
    },
    consignee: {
      firstName: order.shippingAddress?.firstName,
      lastName: order.shippingAddress?.lastName,
      phone: order.shippingAddress?.phone,
      email: order.user?.email || undefined,
      addressLine1: order.shippingAddress?.addressLine1,
      addressLine2: order.shippingAddress?.addressLine2,
      city: order.shippingAddress?.city,
      state: order.shippingAddress?.state,
      postalCode: order.shippingAddress?.postalCode,
      country: order.shippingAddress?.country || 'India',
    },
    items: asArray(order.items).map((item: any) => ({
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: item.price,
      total: item.total,
    })),
  };

  const response = await bluedartRequest<any>(endpoint, {
    method: 'POST',
    body: payload,
    idempotencyKey: `fefa-shipment-${order.orderNumber}`,
  });

  const providerOrderId = pickFirst(response, [
    'providerOrderId',
    'orderId',
    'order_id',
    'reference_number',
  ]);
  const providerShipmentId = pickFirst(response, [
    'providerShipmentId',
    'shipmentId',
    'shipment_id',
  ]);
  const awbCode = pickFirst(response, ['awb', 'awbCode', 'waybill', 'tracking_number']);
  const courierName = pickFirst(response, ['courierName', 'carrier', 'service']);
  let trackingUrl = pickFirst(response, ['trackingUrl', 'track_url']);
  if (!trackingUrl) {
    trackingUrl = makeTrackingUrl(awbCode);
  }

  let pickupRequested = false;
  if (autoPickup && (providerShipmentId || awbCode)) {
    try {
      await requestPickup(providerShipmentId || awbCode);
      pickupRequested = true;
    } catch (error) {
      console.warn('[Blue Dart] Pickup request failed (non-blocking):', error);
    }
  }

  return {
    providerOrderId,
    providerShipmentId,
    awbCode,
    courierName: courierName || 'Blue Dart',
    trackingUrl,
    pickupRequested,
    raw: response,
  };
};

export const generateLabel = async (
  shipmentIdOrAwb: string | number
): Promise<{ labelUrl?: string; raw?: any }> => {
  if (!isBlueDartConfigured()) {
    throw new Error('Blue Dart is not configured');
  }

  const endpoint = getBlueDartEndpoint('GENERATE_LABEL');
  const response = await bluedartRequest<any>(endpoint, {
    method: 'POST',
    body: {
      shipmentId: shipmentIdOrAwb,
      awb: shipmentIdOrAwb,
    },
  });

  return {
    labelUrl: pickFirst(response, ['labelUrl', 'label_url', 'pdfUrl', 'url']),
    raw: response,
  };
};

export const trackByAwb = async (awbCode: string): Promise<BlueDartTrackingResult> => {
  if (!isBlueDartConfigured()) {
    throw new Error('Blue Dart is not configured');
  }

  const endpoint = getBlueDartEndpoint('TRACK');
  const response = await bluedartRequest<any>(endpoint, {
    method: 'GET',
    params: { awb: awbCode },
  });

  const activityList = asArray(
    response?.activities ||
      response?.data?.activities ||
      response?.tracking_data?.shipment_track_activities
  );

  const activities: BlueDartTrackingActivity[] = activityList.map((item: any) => ({
    date: pickFirst(item, ['date', 'timestamp', 'event_time']),
    status: pickFirst(item, ['status', 'sr_status_label', 'event']),
    activity: pickFirst(item, ['activity', 'description', 'message']),
    location: pickFirst(item, ['location', 'city', 'scan_location']),
  }));

  const currentStatus =
    pickFirst(response, ['currentStatus', 'status']) ||
    pickFirst(response?.tracking_data?.shipment_track?.[0], ['current_status']);
  const estimatedDelivery =
    pickFirst(response, ['estimatedDelivery', 'etd']) ||
    pickFirst(response?.tracking_data?.shipment_track?.[0], ['edd']);
  const trackingUrl =
    pickFirst(response, ['trackingUrl', 'track_url']) || makeTrackingUrl(awbCode);

  return {
    trackingNumber: awbCode,
    currentStatus,
    estimatedDelivery,
    trackingUrl,
    activities,
    raw: response,
  };
};

export const cancelShipment = async (shipmentIdOrAwb: string | number): Promise<any> => {
  if (!isBlueDartConfigured()) {
    throw new Error('Blue Dart is not configured');
  }

  const endpoint = getBlueDartEndpoint('CANCEL_SHIPMENT');
  return bluedartRequest(endpoint, {
    method: 'POST',
    body: {
      shipmentId: shipmentIdOrAwb,
      awb: shipmentIdOrAwb,
    },
  });
};

export const createReturnPickup = async (
  shipmentIdOrAwb: string | number,
  reason?: string
): Promise<any> => {
  if (!isBlueDartConfigured()) {
    throw new Error('Blue Dart is not configured');
  }

  const endpoint = getBlueDartEndpoint('RETURN_PICKUP');
  return bluedartRequest(endpoint, {
    method: 'POST',
    body: {
      shipmentId: shipmentIdOrAwb,
      awb: shipmentIdOrAwb,
      reason: reason || 'Customer return',
    },
  });
};

export const getPickupLocations = async (): Promise<
  Array<{ id: string | number; name: string; address: string; phone?: string; isPrimary?: boolean }>
> => {
  if (!isBlueDartConfigured()) {
    throw new Error('Blue Dart is not configured');
  }

  const endpoint = getBlueDartEndpoint('PICKUP_LOCATIONS');
  const response = await bluedartRequest<any>(endpoint, {
    method: 'GET',
  });

  const rows = asArray(response?.data || response?.locations || response?.pickupLocations);
  return rows.map((item: any, index) => ({
    id: pickFirst(item, ['id', 'locationId']) || `loc-${index + 1}`,
    name: pickFirst(item, ['name', 'pickup_location', 'location']) || `Location ${index + 1}`,
    address:
      pickFirst(item, ['address', 'fullAddress']) ||
      [item.addressLine1, item.city, item.state, item.postalCode].filter(Boolean).join(', '),
    phone: pickFirst(item, ['phone', 'mobile']),
    isPrimary: Boolean(pickFirst(item, ['isPrimary', 'is_primary_location'])),
  }));
};

export default {
  isConfigured: isBlueDartConfigured,
  checkServiceability,
  createShipment,
  requestPickup,
  generateLabel,
  trackByAwb,
  cancelShipment,
  createReturnPickup,
  getPickupLocations,
};
