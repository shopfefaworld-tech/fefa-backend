import mongoose, { Document, Schema } from 'mongoose';

export interface IWishlist extends Document {
  user: mongoose.Types.ObjectId;
  items: IWishlistItem[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IWishlistItem {
  _id?: string;
  product: mongoose.Types.ObjectId;
  variant?: mongoose.Types.ObjectId;
  addedAt: Date;
  notes?: string;
}

const WishlistItemSchema = new Schema<IWishlistItem>({
  product: {
    type: Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  variant: {
    type: Schema.Types.ObjectId,
    ref: 'Product.variants',
  },
  addedAt: {
    type: Date,
    default: Date.now,
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 500,
  },
});

const WishlistSchema = new Schema<IWishlist>({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  items: [WishlistItemSchema],
}, {
  timestamps: true,
});

// Indexes
// Note: user field already has unique: true which creates an index, so we don't need to create it again
WishlistSchema.index({ 'items.product': 1 });
WishlistSchema.index({ 'items.addedAt': -1 });

// Virtual for item count
WishlistSchema.virtual('itemCount').get(function() {
  return this.items.length;
});

// Ensure virtual fields are serialized
WishlistSchema.set('toJSON', {
  virtuals: true,
});

WishlistSchema.set('toObject', {
  virtuals: true,
});

// Pre-save middleware to ensure unique products
WishlistSchema.pre('save', function(next) {
  // Remove duplicate products (same product and variant combination)
  const seen = new Set();
  this.items = this.items.filter(item => {
    const key = `${item.product.toString()}-${item.variant?.toString() || 'default'}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  next();
});

export default mongoose.model<IWishlist>('Wishlist', WishlistSchema);
