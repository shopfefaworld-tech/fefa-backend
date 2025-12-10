import mongoose, { Document, Schema } from 'mongoose';

export interface ICart extends Document {
  user: mongoose.Types.ObjectId;
  items: ICartItem[];
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  currency: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICartItem {
  product: mongoose.Types.ObjectId;
  variant?: mongoose.Types.ObjectId;
  quantity: number;
  price: number;
  total: number;
  addedAt: Date;
}

const CartItemSchema = new Schema<ICartItem>({
  product: {
    type: Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  variant: {
    type: Schema.Types.ObjectId,
    ref: 'Product.variants',
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    max: 99,
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
  addedAt: {
    type: Date,
    default: Date.now,
  },
});

const CartSchema = new Schema<ICart>({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  items: [CartItemSchema],
  subtotal: {
    type: Number,
    default: 0,
    min: 0,
  },
  tax: {
    type: Number,
    default: 0,
    min: 0,
  },
  shipping: {
    type: Number,
    default: 0,
    min: 0,
  },
  total: {
    type: Number,
    default: 0,
    min: 0,
  },
  currency: {
    type: String,
    default: 'INR',
    uppercase: true,
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  },
}, {
  timestamps: true,
});

// Indexes
CartSchema.index({ user: 1 });
CartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Pre-save middleware to calculate totals
CartSchema.pre('save', function(next) {
  this.subtotal = this.items.reduce((sum, item) => sum + item.total, 0);
  this.total = this.subtotal + this.tax + this.shipping;
  next();
});

// Method to add item to cart
CartSchema.methods.addItem = function(productId: string, quantity: number, price: number, variantId?: string) {
  const existingItem = this.items.find((item: ICartItem) => 
    item.product.toString() === productId && 
    (!variantId || item.variant?.toString() === variantId)
  );

  if (existingItem) {
    existingItem.quantity += quantity;
    existingItem.total = existingItem.quantity * existingItem.price;
  } else {
    this.items.push({
      product: productId,
      variant: variantId,
      quantity,
      price,
      total: quantity * price,
      addedAt: new Date(),
    });
  }

  return this.save();
};

// Method to remove item from cart
CartSchema.methods.removeItem = function(productId: string, variantId?: string) {
  this.items = this.items.filter((item: ICartItem) => 
    !(item.product.toString() === productId && 
      (!variantId || item.variant?.toString() === variantId))
  );
  return this.save();
};

// Method to update item quantity
CartSchema.methods.updateItemQuantity = function(productId: string, quantity: number, variantId?: string) {
  const item = this.items.find((item: ICartItem) => 
    item.product.toString() === productId && 
    (!variantId || item.variant?.toString() === variantId)
  );

  if (item) {
    if (quantity <= 0) {
      return this.removeItem(productId, variantId);
    }
    item.quantity = quantity;
    item.total = item.quantity * item.price;
  }

  return this.save();
};

// Method to clear cart
CartSchema.methods.clear = function() {
  this.items = [];
  return this.save();
};

// Method to get cart summary
CartSchema.methods.getSummary = function() {
  return {
    itemCount: this.items.length,
    totalQuantity: this.items.reduce((sum: number, item: ICartItem) => sum + item.quantity, 0),
    subtotal: this.subtotal,
    tax: this.tax,
    shipping: this.shipping,
    total: this.total,
    currency: this.currency,
  };
};

export default mongoose.model<ICart>('Cart', CartSchema);
