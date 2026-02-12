import bluedartService from './bluedartService';
import delhiveryService from './delhiveryService';

export interface ServiceabilityResult {
  serviceable: boolean;
  couriers: Array<{
    id: string | number;
    name: string;
    rate?: number;
    estimatedDays?: string;
    codCharge?: number;
  }>;
  recommendedCourierId?: string | number;
  raw?: any;
}

export interface ShipmentResult {
  providerOrderId?: string | number;
  providerShipmentId?: string | number;
  awbCode?: string;
  courierName?: string;
  trackingUrl?: string;
  pickupRequested?: boolean;
  raw?: any;
}

export interface TrackingResult {
  trackingNumber?: string;
  currentStatus?: string;
  estimatedDelivery?: string;
  trackingUrl?: string;
  activities: Array<{
    date?: string;
    status?: string;
    activity?: string;
    location?: string;
  }>;
  raw?: any;
}

export interface LabelResult {
  labelUrl?: string;
  raw?: any;
}

export interface ShippingProvider {
  isConfigured(): boolean;
  checkServiceability(
    pickupPincode: string,
    deliveryPincode: string,
    weight: number,
    cod: boolean
  ): Promise<ServiceabilityResult>;
  createShipment(
    order: any,
    options?: {
      weight?: number;
      dimensions?: { length: number; breadth: number; height: number };
      courierId?: string | number;
      declaredValue?: number;
      insured?: boolean;
      serviceType?: string;
      autoPickup?: boolean;
    }
  ): Promise<ShipmentResult>;
  trackByAwb(awbCode: string): Promise<TrackingResult>;
  generateLabel(shipmentIdOrAwb: string | number): Promise<LabelResult>;
  requestPickup(shipmentIdOrAwb: string | number): Promise<any>;
  cancelShipment(shipmentIdOrAwb: string | number): Promise<any>;
  createReturnPickup(shipmentIdOrAwb: string | number, reason?: string): Promise<any>;
  getPickupLocations(): Promise<
    Array<{ id: string | number; name: string; address: string; phone?: string; isPrimary?: boolean }>
  >;
}

type ProviderKey = 'bluedart' | 'delhivery';

const providerMap: Record<ProviderKey, ShippingProvider> = {
  bluedart: bluedartService,
  delhivery: delhiveryService as unknown as ShippingProvider,
};

/**
 * Resolve the concrete shipping provider implementation for the given key.
 *
 * NOTE: 'manual' is handled at a higher level by simply not invoking any
 * provider methods. Attempting to resolve 'manual' here is considered a
 * configuration error.
 */
export const getShippingProvider = (provider: 'bluedart' | 'delhivery' | 'manual'): ShippingProvider => {
  if (provider === 'manual') {
    throw new Error('Shipping provider is set to manual; no external shipments will be created.');
  }

  const impl = providerMap[provider as ProviderKey];
  if (!impl) {
    throw new Error(`Unsupported shipping provider: ${provider}`);
  }
  return impl;
};

// Default export kept for backward compatibility; defaults to Blue Dart.
const defaultProvider: ShippingProvider = providerMap.bluedart;
export default defaultProvider;
