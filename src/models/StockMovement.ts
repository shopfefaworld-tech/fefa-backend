import mongoose, { Document, Schema } from 'mongoose';

export type StockMovementType =
  | 'opening_stock'
  | 'adjustment'
  | 'sale'
  | 'return'
  | 'bulk_update';

export type StockReferenceType = 'order' | 'product' | 'manual' | 'bulk' | 'system';

export interface IStockMovement extends Document {
  product: mongoose.Types.ObjectId;
  type: StockMovementType;
  quantityChange: number;
  previousQuantity: number;
  newQuantity: number;
  unit: string;
  note?: string;
  referenceType?: StockReferenceType;
  referenceId?: string;
  movementDate: Date;
  createdBy?: mongoose.Types.ObjectId;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const StockMovementSchema = new Schema<IStockMovement>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['opening_stock', 'adjustment', 'sale', 'return', 'bulk_update'],
      required: true,
      index: true,
    },
    quantityChange: {
      type: Number,
      required: true,
    },
    previousQuantity: {
      type: Number,
      required: true,
      min: 0,
    },
    newQuantity: {
      type: Number,
      required: true,
      min: 0,
    },
    unit: {
      type: String,
      default: 'PCS',
      trim: true,
    },
    note: {
      type: String,
      trim: true,
    },
    referenceType: {
      type: String,
      enum: ['order', 'product', 'manual', 'bulk', 'system'],
      default: 'manual',
    },
    referenceId: {
      type: String,
      trim: true,
      index: true,
    },
    movementDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

StockMovementSchema.index({ product: 1, movementDate: -1 });

export default mongoose.model<IStockMovement>('StockMovement', StockMovementSchema);

