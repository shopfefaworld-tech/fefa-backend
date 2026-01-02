import mongoose, { Document, Schema } from 'mongoose';

export interface IOccasion extends Document {
  name: string;
  value: string; // slug-like identifier (e.g., "wedding", "anniversary")
  description?: string;
  image?: string;
  isActive: boolean;
  sortOrder: number;
  seoTitle?: string;
  seoDescription?: string;
  createdAt: Date;
  updatedAt: Date;
}

const OccasionSchema = new Schema<IOccasion>({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true,
  },
  value: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  image: {
    type: String,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
  seoTitle: {
    type: String,
    trim: true,
  },
  seoDescription: {
    type: String,
    trim: true,
  },
}, {
  timestamps: true,
});

// Indexes
OccasionSchema.index({ isActive: 1, sortOrder: 1 });
OccasionSchema.index({ value: 1 });

export default mongoose.model<IOccasion>('Occasion', OccasionSchema);
