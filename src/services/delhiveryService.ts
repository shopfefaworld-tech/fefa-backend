import {
  delhiveryRequest,
  getDelhiveryConfig,
  getDelhiveryEndpoint,
  isDelhiveryConfigured,
} from '../config/delhivery';

export interface DelhiveryCourierOption {
  id: string | number;
  name: string;
  rate?: number;
  estimatedDays?: string;
  codCharge?: number;
}

export interface DelhiveryServiceabilityResult {
  serviceable: boolean;
  couriers: DelhiveryCourierOption[];
  recommendedCourierId?: string | number;
  raw?: any;
}

export interface DelhiveryShipmentResult {
  providerOrderId?: string | number;
  providerShipmentId?: string | number;
  awbCode?: string;
  courierName?: string;
  trackingUrl?: string;
  pickupRequested?: boolean;
  raw?: any;
}

export interface DelhiveryTrackingActivity {
  date?: string;
  status?: string;
  activity?: string;
  location?: string;
}

export interface DelhiveryTrackingResult {
  trackingNumber?: string;
  currentStatus?: string;
  estimatedDelivery?: string;
  trackingUrl?: string;
  activities: DelhiveryTrackingActivity[];
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
  const template = getDelhiveryConfig().trackingUrlTemplate;
  if (!template) return undefined;
  return template.replace('{awb}', encodeURIComponent(awbCode));
};

export const checkServiceability = async (
  pickupPincode: string,
  deliveryPincode: string,
  weight: number,
  cod: boolean
): Promise<DelhiveryServiceabilityResult> => {
  if (!isDelhiveryConfigured()) {
    throw new Error('Delhivery is not configured');
  }

  const endpoint = getDelhiveryEndpoint('SERVICEABILITY');
  const data = await delhiveryRequest<any>(endpoint, {
    method: 'GET',
    params: {
      pickup_pincode: pickupPincode,
      delivery_pincode: deliveryPincode,
      weight,
      cod,
    },
  });

  const candidates = asArray(
    data?.couriers ||
      data?.data?.couriers ||
      data?.delivery_codes ||
      data?.data?.delivery_codes ||
      data?.options
  );

  const couriers: DelhiveryCourierOption[] = candidates.map((item: any, index: number) => ({
    id: pickFirst(item, ['id', 'courier_company_id', 'code']) || `courier-${index + 1}`,
    name: pickFirst(item, ['name', 'courier_name', 'service']) || 'Delhivery',
    rate: Number(pickFirst(item, ['rate', 'freight_charge', 'charge']) || 0),
    estimatedDays: String(
      pickFirst(item, ['estimatedDays', 'estimated_delivery_days', 'eta_days', 'transit_days']) ||
        ''
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
): Promise<DelhiveryShipmentResult> => {
  if (!isDelhiveryConfigured()) {
    throw new Error('Delhivery is not configured');
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

  const endpoint = getDelhiveryEndpoint('CREATE_SHIPMENT');

  const config = getDelhiveryConfig();
  const pickupLocationName = config.pickupLocationName;
  if (!pickupLocationName) {
    throw new Error(
      'Delhivery pickup location name is not configured. Set DELHIVERY_PICKUP_LOCATION_NAME in your backend environment.'
    );
  }

  const shippingAddress = order.shippingAddress || {};
  const fullAddress =
    shippingAddress.addressLine1 ||
    [shippingAddress.addressLine1, shippingAddress.addressLine2]
      .filter(Boolean)
      .join(', ');

  const totalAmount: number = Number(
    declaredValue ?? order.pricing?.total ?? 0
  );

  const isCod = order.payment?.method === 'cod';

  const weightInGrams = Math.max(1, Math.round((weight || 0.5) * 1000));

  const payload = {
    shipments: [
      {
        name: `${shippingAddress.firstName || ''} ${shippingAddress.lastName || ''}`.trim(),
        add: fullAddress,
        pin: String(shippingAddress.postalCode || ''),
        city: shippingAddress.city || '',
        state: shippingAddress.state || '',
        country: shippingAddress.country || 'India',
        phone: shippingAddress.phone || '',
        order: order.orderNumber,
        payment_mode: isCod ? 'COD' : 'Prepaid',
        return_pin: '',
        return_city: '',
        return_phone: '',
        return_add: '',
        return_state: '',
        return_country: '',
        products_desc:
          asArray(order.items)
            .map((item: any) => item.name)
            .filter(Boolean)
            .join(', ')
            .slice(0, 250) || '',
        hsn_code: '',
        cod_amount: isCod ? totalAmount : 0,
        order_date: null,
        total_amount: totalAmount,
        seller_add: '',
        seller_name: '',
        seller_inv: '',
        quantity: String(
          asArray(order.items).reduce(
            (sum: number, item: any) => sum + (Number(item.quantity) || 0),
            0
          )
        ),
        waybill: '',
        shipment_width: String(dimensions.breadth),
        shipment_height: String(dimensions.height),
        shipment_length: String(dimensions.length),
        weight: weightInGrams,
        shipping_mode:
          serviceType && serviceType.toLowerCase() === 'express' ? 'Express' : 'Surface',
        address_type: '',
      },
    ],
    pickup_location: {
      name: pickupLocationName,
    },
  };

  const formBody = `format=json&data=${encodeURIComponent(JSON.stringify(payload))}`;

  const response = await delhiveryRequest<any>(endpoint, {
    method: 'POST',
    rawBody: formBody,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    idempotencyKey: `fefa-shipment-${order.orderNumber}`,
  });

  const providerOrderId = pickFirst(response, [
    'providerOrderId',
    'orderId',
    'order_id',
    'reference_number',
    'consignment_id',
  ]);
  const providerShipmentId = pickFirst(response, [
    'providerShipmentId',
    'shipmentId',
    'shipment_id',
  ]);
  const awbCode = pickFirst(response, ['awb', 'awbCode', 'waybill', 'tracking_number']);
  const courierName = pickFirst(response, ['courierName', 'carrier', 'service']) || 'Delhivery';
  let trackingUrl = pickFirst(response, ['trackingUrl', 'track_url']);
  if (!trackingUrl) {
    trackingUrl = makeTrackingUrl(awbCode);
  }

  // Some Delhivery flows auto-schedule pickup on shipment creation; we assume true on success.
  const pickupRequested = Boolean(autoPickup && (providerShipmentId || awbCode));

  return {
    providerOrderId,
    providerShipmentId,
    awbCode,
    courierName,
    trackingUrl,
    pickupRequested,
    raw: response,
  };
};

export const generateLabel = async (
  shipmentIdOrAwb: string | number
): Promise<{ labelUrl?: string; raw?: any }> => {
  if (!isDelhiveryConfigured()) {
    throw new Error('Delhivery is not configured');
  }

  const endpoint = getDelhiveryEndpoint('GENERATE_LABEL');
  const response = await delhiveryRequest<any>(endpoint, {
    method: 'GET',
    params: {
      awb: shipmentIdOrAwb,
    },
  });

  return {
    labelUrl: pickFirst(response, ['labelUrl', 'label_url', 'pdfUrl', 'url']),
    raw: response,
  };
};

export const trackByAwb = async (awbCode: string): Promise<DelhiveryTrackingResult> => {
  if (!isDelhiveryConfigured()) {
    throw new Error('Delhivery is not configured');
  }

  const endpoint = getDelhiveryEndpoint('TRACK');
  const response = await delhiveryRequest<any>(endpoint, {
    method: 'GET',
    params: { awb: awbCode },
  });

  const activityList = asArray(
    response?.activities ||
      response?.data?.activities ||
      response?.tracking || // generic \"tracking\" array
      response?.scan || // some APIs expose scans
      []
  );

  const activities: DelhiveryTrackingActivity[] = activityList.map((item: any) => ({
    date: pickFirst(item, ['date', 'timestamp', 'event_time', 'scandate']),
    status: pickFirst(item, ['status', 'status_code', 'event']),
    activity: pickFirst(item, ['activity', 'description', 'remarks', 'message']),
    location: pickFirst(item, ['location', 'city', 'scan_location']),
  }));

  const currentStatus =
    pickFirst(response, ['currentStatus', 'status']) ||
    pickFirst(response?.shipment, ['status']);
  const estimatedDelivery =
    pickFirst(response, ['estimatedDelivery', 'etd']) ||
    pickFirst(response?.shipment, ['edd']);
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

export const requestPickup = async (shipmentIdOrAwb: string | number): Promise<any> => {
  if (!isDelhiveryConfigured()) {
    throw new Error('Delhivery is not configured');
  }

  const endpoint = getDelhiveryEndpoint('REQUEST_PICKUP');
  return delhiveryRequest(endpoint, {
    method: 'POST',
    body: {
      awb: shipmentIdOrAwb,
    },
  });
};

export const cancelShipment = async (shipmentIdOrAwb: string | number): Promise<any> => {
  if (!isDelhiveryConfigured()) {
    throw new Error('Delhivery is not configured');
  }

  const endpoint = getDelhiveryEndpoint('CANCEL_SHIPMENT');
  return delhiveryRequest(endpoint, {
    method: 'POST',
    body: {
      awb: shipmentIdOrAwb,
    },
  });
};

export const createReturnPickup = async (
  shipmentIdOrAwb: string | number,
  reason?: string
): Promise<any> => {
  if (!isDelhiveryConfigured()) {
    throw new Error('Delhivery is not configured');
  }

  const endpoint = getDelhiveryEndpoint('RETURN_PICKUP');
  return delhiveryRequest(endpoint, {
    method: 'POST',
    body: {
      awb: shipmentIdOrAwb,
      reason: reason || 'Customer return',
    },
  });
};

export const getPickupLocations = async (): Promise<
  Array<{ id: string | number; name: string; address: string; phone?: string; isPrimary?: boolean }>
> => {
  if (!isDelhiveryConfigured()) {
    throw new Error('Delhivery is not configured');
  }

  const endpoint = getDelhiveryEndpoint('PICKUP_LOCATIONS');
  const response = await delhiveryRequest<any>(endpoint, {
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
  isConfigured: isDelhiveryConfigured,
  checkServiceability,
  createShipment,
  requestPickup,
  generateLabel,
  trackByAwb,
  cancelShipment,
  createReturnPickup,
  getPickupLocations,
};

