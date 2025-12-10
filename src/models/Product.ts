import mongoose, { Document, Schema } from 'mongoose';

export interface IProduct extends Document {
  name: string;
  slug: string;
  description: string;
  shortDescription?: string;
  sku: string;
  price: number;
  comparePrice?: number;
  costPrice?: number;
  images: IProductImage[];
  category: mongoose.Types.ObjectId;
  subcategory?: mongoose.Types.ObjectId;
  tags: string[];
  variants: IProductVariant[];
  specifications: IProductSpecification[];
  isActive: boolean;
  isFeatured: boolean;
  isDigital: boolean;
  weight?: number;
  dimensions?: {
    length: number;
    width: number;
    height: number;
    unit: 'cm' | 'inch';
  };
  inventory: {
    trackQuantity: boolean;
    quantity: number;
    lowStockThreshold: number;
    allowBackorder: boolean;
  };
  seo: {
    title?: string;
    description?: string;
    keywords?: string[];
  };
  ratings: {
    average: number;
    count: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface IProductImage {
  _id?: mongoose.Types.ObjectId;
  url: string;
  publicId: string;
  alt: string;
  isPrimary: boolean;
  sortOrder: number;
}

export interface IProductVariant {
  name: string;
  sku: string;
  price: number;
  comparePrice?: number;
  costPrice?: number;
  images: string[];
  attributes: {
    [key: string]: string;
  };
  inventory: {
    quantity: number;
    lowStockThreshold: number;
  };
  isActive: boolean;
}

export interface IProductSpecification {
  name: string;
  value: string;
  group?: string;
}

const ProductImageSchema = new Schema<IProductImage>({
  url: {
    type: String,
    required: true,
  },
  publicId: {
    type: String,
    required: true,
  },
  alt: {
    type: String,
    required: true,
  },
  isPrimary: {
    type: Boolean,
    default: false,
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
});

const ProductVariantSchema = new Schema<IProductVariant>({
  name: {
    type: String,
    required: true,
  },
  sku: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  comparePrice: {
    type: Number,
    min: 0,
  },
  costPrice: {
    type: Number,
    min: 0,
  },
  images: [String],
  attributes: {
    type: Map,
    of: String,
  },
  inventory: {
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    lowStockThreshold: {
      type: Number,
      default: 5,
      min: 0,
    },
  },
  isActive: {
    type: Boolean,
    default: true,
  },
});

const ProductSpecificationSchema = new Schema<IProductSpecification>({
  name: {
    type: String,
    required: true,
  },
  value: {
    type: String,
    required: true,
  },
  group: {
    type: String,
  },
});

const ProductSchema = new Schema<IProduct>({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  description: {
    type: String,
    required: true,
  },
  shortDescription: {
    type: String,
    trim: true,
  },
  sku: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  comparePrice: {
    type: Number,
    min: 0,
  },
  costPrice: {
    type: Number,
    min: 0,
  },
  images: [ProductImageSchema],
  category: {
    type: Schema.Types.ObjectId,
    ref: 'Category',
    required: true,
  },
  subcategory: {
    type: Schema.Types.ObjectId,
    ref: 'Category',
  },
  tags: [String],
  variants: [ProductVariantSchema],
  specifications: [ProductSpecificationSchema],
  isActive: {
    type: Boolean,
    default: true,
  },
  isFeatured: {
    type: Boolean,
    default: false,
  },
  isDigital: {
    type: Boolean,
    default: false,
  },
  weight: {
    type: Number,
    min: 0,
  },
  dimensions: {
    length: {
      type: Number,
      min: 0,
    },
    width: {
      type: Number,
      min: 0,
    },
    height: {
      type: Number,
      min: 0,
    },
    unit: {
      type: String,
      enum: ['cm', 'inch'],
      default: 'cm',
    },
  },
  inventory: {
    trackQuantity: {
      type: Boolean,
      default: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    lowStockThreshold: {
      type: Number,
      default: 5,
      min: 0,
    },
    allowBackorder: {
      type: Boolean,
      default: false,
    },
  },
  seo: {
    title: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    keywords: [String],
  },
  ratings: {
    average: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    count: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
}, {
  timestamps: true,
});

// Indexes
ProductSchema.index({ category: 1 });
ProductSchema.index({ isActive: 1, isFeatured: 1 });
ProductSchema.index({ price: 1 });
ProductSchema.index({ 'ratings.average': -1 });
ProductSchema.index({ createdAt: -1 });
ProductSchema.index({ name: 'text', description: 'text', tags: 'text' });

// Virtual for primary image
ProductSchema.virtual('primaryImage').get(function() {
  const primaryImage = this.images.find(img => img.isPrimary);
  return primaryImage || this.images[0] || null;
});

// Virtual for discount percentage
ProductSchema.virtual('discountPercentage').get(function() {
  if (this.comparePrice && this.comparePrice > this.price) {
    return Math.round(((this.comparePrice - this.price) / this.comparePrice) * 100);
  }
  return 0;
});

// Virtual for stock status
ProductSchema.virtual('stockStatus').get(function() {
  if (!this.inventory.trackQuantity) return 'in-stock';
  if (this.inventory.quantity === 0) return 'out-of-stock';
  if (this.inventory.quantity <= this.inventory.lowStockThreshold) return 'low-stock';
  return 'in-stock';
});

// Ensure virtual fields are serialized
ProductSchema.set('toJSON', {
  virtuals: true,
});

ProductSchema.set('toObject', {
  virtuals: true,
});

export default mongoose.model<IProduct>('Product', ProductSchema);
