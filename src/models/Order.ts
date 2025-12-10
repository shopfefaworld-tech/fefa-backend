import mongoose, { Document, Schema } from 'mongoose';

export interface IOrder extends Document {
  orderNumber: string;
  user: mongoose.Types.ObjectId;
  items: IOrderItem[];
  shippingAddress: IOrderAddress;
  billingAddress: IOrderAddress;
  payment: IOrderPayment;
  pricing: IOrderPricing;
  status: OrderStatus;
  notes?: string;
  tracking?: IOrderTracking;
  timeline: IOrderTimeline[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IOrderItem {
  product: mongoose.Types.ObjectId;
  variant?: mongoose.Types.ObjectId;
  name: string;
  sku: string;
  quantity: number;
  price: number;
  total: number;
  image?: string;
}

export interface IOrderAddress {
  firstName: string;
  lastName: string;
  company?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
}

export interface IOrderPayment {
  method: 'cod' | 'online' | 'wallet' | 'card';
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded';
  transactionId?: string;
  gateway?: string;
  paidAt?: Date;
  refundedAt?: Date;
  refundAmount?: number;
}

export interface IOrderPricing {
  subtotal: number;
  tax: number;
  shipping: number;
  discount: number;
  total: number;
  currency: string;
}

export interface IOrderTracking {
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  estimatedDelivery?: Date;
  deliveredAt?: Date;
}

export interface IOrderTimeline {
  status: OrderStatus;
  timestamp: Date;
  note?: string;
  updatedBy?: string;
}

export type OrderStatus = 
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'returned'
  | 'refunded';

const OrderItemSchema = new Schema<IOrderItem>({
  product: {
    type: Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  variant: {
    type: Schema.Types.ObjectId,
  },
  name: {
    type: String,
    required: true,
  },
  sku: {
    type: String,
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  total: {
    type: Number,
    required: true,
    min: 0,
  },
  image: {
    type: String,
  },
});

const OrderAddressSchema = new Schema<IOrderAddress>({
  firstName: {
    type: String,
    required: true,
  },
  lastName: {
    type: String,
    required: true,
  },
  company: {
    type: String,
  },
  addressLine1: {
    type: String,
    required: true,
  },
  addressLine2: {
    type: String,
  },
  city: {
    type: String,
    required: true,
  },
  state: {
    type: String,
    required: true,
  },
  postalCode: {
    type: String,
    required: true,
  },
  country: {
    type: String,
    required: true,
    default: 'India',
  },
  phone: {
    type: String,
    required: true,
  },
});

const OrderPaymentSchema = new Schema<IOrderPayment>({
  method: {
    type: String,
    enum: ['cod', 'online', 'wallet', 'card'],
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'],
    default: 'pending',
  },
  transactionId: {
    type: String,
  },
  gateway: {
    type: String,
  },
  paidAt: {
    type: Date,
  },
  refundedAt: {
    type: Date,
  },
  refundAmount: {
    type: Number,
    min: 0,
  },
});

const OrderPricingSchema = new Schema<IOrderPricing>({
  subtotal: {
    type: Number,
    required: true,
    min: 0,
  },
  tax: {
    type: Number,
    required: true,
    min: 0,
  },
  shipping: {
    type: Number,
    required: true,
    min: 0,
  },
  discount: {
    type: Number,
    default: 0,
    min: 0,
  },
  total: {
    type: Number,
    required: true,
    min: 0,
  },
  currency: {
    type: String,
    default: 'INR',
    uppercase: true,
  },
});

const OrderTrackingSchema = new Schema<IOrderTracking>({
  carrier: {
    type: String,
  },
  trackingNumber: {
    type: String,
  },
  trackingUrl: {
    type: String,
  },
  estimatedDelivery: {
    type: Date,
  },
  deliveredAt: {
    type: Date,
  },
});

const OrderTimelineSchema = new Schema<IOrderTimeline>({
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned', 'refunded'],
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  note: {
    type: String,
  },
  updatedBy: {
    type: String,
  },
});

const OrderSchema = new Schema<IOrder>({
  orderNumber: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  items: [OrderItemSchema],
  shippingAddress: {
    type: OrderAddressSchema,
    required: true,
  },
  billingAddress: {
    type: OrderAddressSchema,
    required: true,
  },
  payment: {
    type: OrderPaymentSchema,
    required: true,
  },
  pricing: {
    type: OrderPricingSchema,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned', 'refunded'],
    default: 'pending',
  },
  notes: {
    type: String,
  },
  tracking: {
    type: OrderTrackingSchema,
  },
  timeline: [OrderTimelineSchema],
}, {
  timestamps: true,
});

// Indexes
OrderSchema.index({ user: 1 });
OrderSchema.index({ status: 1 });
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ 'payment.transactionId': 1 });

// Pre-save middleware to generate order number
OrderSchema.pre('save', async function(next) {
  if (!this.orderNumber) {
    const count = await mongoose.model('Order').countDocuments();
    this.orderNumber = `FEFA${String(count + 1).padStart(6, '0')}`;
  }
  next();
});

// Method to update order status
OrderSchema.methods.updateStatus = function(status: OrderStatus, note?: string, updatedBy?: string) {
  this.status = status;
  this.timeline.push({
    status,
    timestamp: new Date(),
    note,
    updatedBy,
  });
  return this.save();
};

// Method to add tracking information
OrderSchema.methods.addTracking = function(trackingData: Partial<IOrderTracking>) {
  this.tracking = { ...this.tracking, ...trackingData };
  return this.save();
};

// Method to calculate order summary
OrderSchema.methods.getSummary = function() {
  return {
    orderNumber: this.orderNumber,
    status: this.status,
    itemCount: this.items.length,
    totalQuantity: this.items.reduce((sum: number, item: IOrderItem) => sum + item.quantity, 0),
    subtotal: this.pricing.subtotal,
    tax: this.pricing.tax,
    shipping: this.pricing.shipping,
    discount: this.pricing.discount,
    total: this.pricing.total,
    currency: this.pricing.currency,
    createdAt: this.createdAt,
  };
};

export default mongoose.model<IOrder>('Order', OrderSchema);
