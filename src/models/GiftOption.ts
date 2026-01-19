import mongoose, { Document, Schema } from 'mongoose';

export interface IGiftOption extends Document {
  name: string;
  description: string;
  price: number;
  image: string;
  isActive: boolean;
  sortOrder: number;
}

const GiftOptionSchema = new Schema<IGiftOption>({
  name: { type: String, required: true },
  description: { type: String, required: true },
  price: { type: Number, required: true },
  image: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

export default mongoose.model<IGiftOption>('GiftOption', GiftOptionSchema);
