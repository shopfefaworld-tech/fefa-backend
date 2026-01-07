import mongoose, { Document, Schema } from 'mongoose';

export interface INewsletter extends Document {
  email: string;
  isActive: boolean;
  subscribedAt: Date;
  unsubscribedAt?: Date;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

const NewsletterSchema = new Schema<INewsletter>({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
  },
  isActive: {
    type: Boolean,
    default: true
  },
  subscribedAt: {
    type: Date,
    default: Date.now
  },
  unsubscribedAt: {
    type: Date
  },
  source: {
    type: String,
    default: 'website',
    enum: ['website', 'checkout', 'popup', 'footer', 'api']
  }
}, {
  timestamps: true
});

// Indexes
NewsletterSchema.index({ email: 1 });
NewsletterSchema.index({ isActive: 1 });
NewsletterSchema.index({ subscribedAt: -1 });

export default mongoose.model<INewsletter>('Newsletter', NewsletterSchema);
