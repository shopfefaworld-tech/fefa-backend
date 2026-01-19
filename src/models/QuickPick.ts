import mongoose, { Document, Schema } from 'mongoose';

export interface IQuickPick extends Document {
  name: string;
  price: number;
  comparePrice: number;
  image: string;
  productId?: mongoose.Types.ObjectId;
  isActive: boolean;
  sortOrder: number;
}

const QuickPickSchema = new Schema<IQuickPick>({
  name: { type: String, required: true },
  price: { type: Number, required: true, max: 200 },
  comparePrice: { type: Number, required: true },
  image: { type: String, required: true },
  productId: { type: Schema.Types.ObjectId, ref: 'Product' },
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

export default mongoose.model<IQuickPick>('QuickPick', QuickPickSchema);
