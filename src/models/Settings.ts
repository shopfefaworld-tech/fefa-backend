import mongoose, { Schema, Document } from 'mongoose';

export interface ISettings extends Document {
  // General Settings
  storeName: string;
  storeDescription: string;
  storeEmail: string;
  storePhone: string;
  storeAddress: string;
  
  // Appearance Settings
  primaryColor: string;
  secondaryColor: string;
  logo?: string;
  favicon?: string;
  
  // Email Settings
  emailProvider: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  emailFrom: string;
  emailReplyTo?: string;
  
  // Payment Settings
  enableCOD: boolean;
  enableRazorpay: boolean;
  razorpayKeyId?: string;
  razorpayKeySecret?: string;
  currency: string;
  taxRate: number;
  
  // Security Settings
  enableTwoFactor: boolean;
  passwordMinLength: number;
  sessionTimeout: number;
  
  // Notification Settings
  emailNotifications: boolean;
  orderNotifications: boolean;
  reviewNotifications: boolean;
  lowStockNotifications: boolean;
  lowStockThreshold: number;
  
  // Advanced Settings
  maintenanceMode: boolean;
  maintenanceMessage?: string;
  enableAnalytics: boolean;
  googleAnalyticsId?: string;
  facebookPixelId?: string;
  
  // Top Banner Settings
  topBannerText?: string;
  topBannerLink?: string;
  topBannerActive: boolean;
  topBannerBackgroundColor?: string;
  topBannerTextColor?: string;
  
  updatedAt: Date;
  createdAt: Date;
}

const SettingsSchema: Schema = new Schema({
  // General Settings
  storeName: {
    type: String,
    required: true,
    default: 'FEFA Jewelry'
  },
  storeDescription: {
    type: String,
    default: 'Premium artificial jewelry store'
  },
  storeEmail: {
    type: String,
    required: true
  },
  storePhone: {
    type: String,
    default: ''
  },
  storeAddress: {
    type: String,
    default: ''
  },
  
  // Appearance Settings
  primaryColor: {
    type: String,
    default: '#3B82F6'
  },
  secondaryColor: {
    type: String,
    default: '#8B5CF6'
  },
  logo: {
    type: String
  },
  favicon: {
    type: String
  },
  
  // Email Settings
  emailProvider: {
    type: String,
    enum: ['smtp', 'sendgrid', 'mailgun'],
    default: 'smtp'
  },
  smtpHost: String,
  smtpPort: Number,
  smtpUser: String,
  smtpPassword: String,
  emailFrom: {
    type: String,
    required: true
  },
  emailReplyTo: String,
  
  // Payment Settings
  enableCOD: {
    type: Boolean,
    default: true
  },
  enableRazorpay: {
    type: Boolean,
    default: true
  },
  razorpayKeyId: String,
  razorpayKeySecret: String,
  currency: {
    type: String,
    default: 'INR'
  },
  taxRate: {
    type: Number,
    default: 0
  },
  
  // Security Settings
  enableTwoFactor: {
    type: Boolean,
    default: false
  },
  passwordMinLength: {
    type: Number,
    default: 8
  },
  sessionTimeout: {
    type: Number,
    default: 3600 // 1 hour in seconds
  },
  
  // Notification Settings
  emailNotifications: {
    type: Boolean,
    default: true
  },
  orderNotifications: {
    type: Boolean,
    default: true
  },
  reviewNotifications: {
    type: Boolean,
    default: true
  },
  lowStockNotifications: {
    type: Boolean,
    default: true
  },
  lowStockThreshold: {
    type: Number,
    default: 10
  },
  
  // Advanced Settings
  maintenanceMode: {
    type: Boolean,
    default: false
  },
  maintenanceMessage: String,
  enableAnalytics: {
    type: Boolean,
    default: false
  },
  googleAnalyticsId: String,
  facebookPixelId: String,
  
  // Top Banner Settings
  topBannerText: {
    type: String,
    default: ''
  },
  topBannerLink: {
    type: String,
    default: ''
  },
  topBannerActive: {
    type: Boolean,
    default: false
  },
  topBannerBackgroundColor: {
    type: String,
    default: '#DBC078'
  },
  topBannerTextColor: {
    type: String,
    default: '#470031'
  }
}, {
  timestamps: true
});

// Ensure only one settings document exists
SettingsSchema.pre('save', async function(next) {
  if (this.isNew) {
    const count = await mongoose.model('Settings').countDocuments();
    if (count > 0) {
      throw new Error('Only one settings document can exist');
    }
  }
  next();
});

export default mongoose.model<ISettings>('Settings', SettingsSchema);
