import mongoose, { Document, Schema } from 'mongoose';

export interface IOTP extends Document {
  email?: string;
  phone?: string;
  otp: string;
  type: 'email' | 'phone';
  expiresAt: Date;
  attempts: number;
  verified: boolean;
  createdAt: Date;
}

const OTPSchema = new Schema<IOTP>({
  email: {
    type: String,
    lowercase: true,
    trim: true,
    sparse: true, // Allows null values but enforces uniqueness when present
  },
  phone: {
    type: String,
    trim: true,
    sparse: true,
  },
  otp: {
    type: String,
    required: true,
    length: 6,
  },
  type: {
    type: String,
    enum: ['email', 'phone'],
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 }, // Auto-delete expired documents
  },
  attempts: {
    type: Number,
    default: 0,
  },
  verified: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Compound index for faster lookups
OTPSchema.index({ email: 1, type: 1, verified: 1 });
OTPSchema.index({ phone: 1, type: 1, verified: 1 });
OTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OTP = mongoose.models.OTP || mongoose.model<IOTP>('OTP', OTPSchema);

