import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IReview extends Document {
  user: mongoose.Types.ObjectId;
  product: mongoose.Types.ObjectId;
  order?: mongoose.Types.ObjectId;
  rating: number;
  title?: string;
  comment?: string;
  images?: string[];
  isVerified: boolean;
  isApproved: boolean;
  helpful: {
    count: number;
    users: mongoose.Types.ObjectId[];
  };
  response?: {
    comment: string;
    respondedBy: mongoose.Types.ObjectId;
    respondedAt: Date;
  };
  createdAt: Date;
  updatedAt: Date;
  
  // Instance methods
  markHelpful(userId: string): Promise<IReview>;
  unmarkHelpful(userId: string): Promise<IReview>;
  addResponse(comment: string, respondedBy: string): Promise<IReview>;
}

export interface IReviewModel extends Model<IReview> {
  getProductReviews(productId: string, page?: number, limit?: number, rating?: number): Promise<IReview[]>;
  getProductReviewStats(productId: string): Promise<any[]>;
}

const ReviewSchema = new Schema<IReview>({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  product: {
    type: Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  order: {
    type: Schema.Types.ObjectId,
    ref: 'Order',
    required: false,
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  title: {
    type: String,
    trim: true,
    maxlength: 100,
  },
  comment: {
    type: String,
    trim: true,
    maxlength: 1000,
  },
  images: [String],
  isVerified: {
    type: Boolean,
    default: false,
  },
  isApproved: {
    type: Boolean,
    default: false, // Changed to false - reviews now require admin approval
  },
  helpful: {
    count: {
      type: Number,
      default: 0,
      min: 0,
    },
    users: [{
      type: Schema.Types.ObjectId,
      ref: 'User',
    }],
  },
  response: {
    comment: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    respondedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    respondedAt: {
      type: Date,
    },
  },
}, {
  timestamps: true,
});

// Indexes
ReviewSchema.index({ product: 1, isApproved: 1 });
ReviewSchema.index({ rating: 1 });
ReviewSchema.index({ createdAt: -1 });

// Compound index to ensure one review per user per product
ReviewSchema.index({ user: 1, product: 1 }, { unique: true });

// Method to mark review as helpful
ReviewSchema.methods.markHelpful = function(userId: string) {
  if (!this.helpful.users.includes(userId)) {
    this.helpful.users.push(userId);
    this.helpful.count += 1;
    return this.save();
  }
  return Promise.resolve(this);
};

// Method to remove helpful mark
ReviewSchema.methods.unmarkHelpful = function(userId: string) {
  const index = this.helpful.users.indexOf(userId);
  if (index > -1) {
    this.helpful.users.splice(index, 1);
    this.helpful.count -= 1;
    return this.save();
  }
  return Promise.resolve(this);
};

// Method to add response
ReviewSchema.methods.addResponse = function(comment: string, respondedBy: string) {
  this.response = {
    comment,
    respondedBy,
    respondedAt: new Date(),
  };
  return this.save();
};

// Static method to get product reviews with pagination
ReviewSchema.statics.getProductReviews = function(productId: string, page = 1, limit = 10, rating?: number) {
  const query: any = { product: productId, isApproved: true };
  if (rating) {
    query.rating = rating;
  }

  return this.find(query)
    .populate('user', 'firstName lastName profileImage')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
};

// Static method to get review statistics for a product
ReviewSchema.statics.getProductReviewStats = function(productId: string) {
  return this.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(productId), isApproved: true } },
    {
      $group: {
        _id: null,
        totalReviews: { $sum: 1 },
        averageRating: { $avg: '$rating' },
        ratingDistribution: {
          $push: {
            $switch: {
              branches: [
                { case: { $eq: ['$rating', 5] }, then: 'five' },
                { case: { $eq: ['$rating', 4] }, then: 'four' },
                { case: { $eq: ['$rating', 3] }, then: 'three' },
                { case: { $eq: ['$rating', 2] }, then: 'two' },
                { case: { $eq: ['$rating', 1] }, then: 'one' },
              ],
              default: 'other'
            }
          }
        }
      }
    },
    {
      $project: {
        totalReviews: 1,
        averageRating: { $round: ['$averageRating', 1] },
        ratingDistribution: {
          five: { $size: { $filter: { input: '$ratingDistribution', cond: { $eq: ['$$this', 'five'] } } } },
          four: { $size: { $filter: { input: '$ratingDistribution', cond: { $eq: ['$$this', 'four'] } } } },
          three: { $size: { $filter: { input: '$ratingDistribution', cond: { $eq: ['$$this', 'three'] } } } },
          two: { $size: { $filter: { input: '$ratingDistribution', cond: { $eq: ['$$this', 'two'] } } } },
          one: { $size: { $filter: { input: '$ratingDistribution', cond: { $eq: ['$$this', 'one'] } } } },
        }
      }
    }
  ]);
};

export default mongoose.model<IReview, IReviewModel>('Review', ReviewSchema);
