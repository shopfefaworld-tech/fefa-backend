import bluedartService from './bluedartService';

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

const shippingProvider: ShippingProvider = {
  isConfigured: bluedartService.isConfigured,
  checkServiceability: bluedartService.checkServiceability,
  createShipment: bluedartService.createShipment,
  trackByAwb: bluedartService.trackByAwb,
  generateLabel: bluedartService.generateLabel,
  requestPickup: bluedartService.requestPickup,
  cancelShipment: bluedartService.cancelShipment,
  createReturnPickup: bluedartService.createReturnPickup,
  getPickupLocations: bluedartService.getPickupLocations,
};

export default shippingProvider;
