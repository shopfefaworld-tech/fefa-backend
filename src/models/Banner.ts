import mongoose, { Document, Schema } from 'mongoose';

export interface IBanner extends Document {
  title: string;
  subtitle?: string;
  image: string;
  buttonText?: string;
  buttonLink?: string;
  isActive: boolean;
  sortOrder: number;
  startDate?: Date;
  endDate?: Date;
  targetAudience?: {
    gender?: 'male' | 'female' | 'all';
    ageRange?: {
      min: number;
      max: number;
    };
    location?: string[];
  };
  clicks: number;
  impressions: number;
  createdAt: Date;
  updatedAt: Date;
}

const BannerSchema = new Schema<IBanner>({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  subtitle: {
    type: String,
    trim: true,
  },
  image: {
    type: String,
    required: true,
  },
  buttonText: {
    type: String,
    trim: true,
  },
  buttonLink: {
    type: String,
    trim: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
  startDate: {
    type: Date,
  },
  endDate: {
    type: Date,
  },
  targetAudience: {
    gender: {
      type: String,
      enum: ['male', 'female', 'all'],
      default: 'all',
    },
    ageRange: {
      min: {
        type: Number,
        min: 0,
      },
      max: {
        type: Number,
        min: 0,
      },
    },
    location: [String],
  },
  clicks: {
    type: Number,
    default: 0,
    min: 0,
  },
  impressions: {
    type: Number,
    default: 0,
    min: 0,
  },
}, {
  timestamps: true,
});

// Indexes
BannerSchema.index({ isActive: 1, sortOrder: 1 });
BannerSchema.index({ startDate: 1, endDate: 1 });
BannerSchema.index({ createdAt: -1 });

// Virtual for click-through rate
BannerSchema.virtual('ctr').get(function() {
  if (this.impressions === 0) return 0;
  return (this.clicks / this.impressions) * 100;
});

// Method to increment clicks
BannerSchema.methods.incrementClicks = function() {
  this.clicks += 1;
  return this.save();
};

// Method to increment impressions
BannerSchema.methods.incrementImpressions = function() {
  this.impressions += 1;
  return this.save();
};

// Method to check if banner is currently active
BannerSchema.methods.isCurrentlyActive = function() {
  if (!this.isActive) return false;
  
  const now = new Date();
  if (this.startDate && now < this.startDate) return false;
  if (this.endDate && now > this.endDate) return false;
  
  return true;
};

// Static method to get active banners
BannerSchema.statics.getActiveBanners = function() {
  const now = new Date();
  return this.find({
    isActive: true,
    $and: [
      {
        $or: [
          { startDate: { $exists: false } },
          { startDate: { $lte: now } }
        ]
      },
      {
        $or: [
          { endDate: { $exists: false } },
          { endDate: { $gte: now } }
        ]
      }
    ]
  }).sort({ sortOrder: 1, createdAt: -1 });
};

// Add static method interface
export interface IBannerModel extends mongoose.Model<IBanner> {
  getActiveBanners(): Promise<IBanner[]>;
}

// Ensure virtual fields are serialized
BannerSchema.set('toJSON', {
  virtuals: true,
});

BannerSchema.set('toObject', {
  virtuals: true,
});

export default mongoose.model<IBanner, IBannerModel>('Banner', BannerSchema);
