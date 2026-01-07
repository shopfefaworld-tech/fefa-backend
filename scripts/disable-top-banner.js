const mongoose = require('mongoose');
require('dotenv').config();

// Settings schema matching the model
const SettingsSchema = new mongoose.Schema({
  storeName: String,
  storeDescription: String,
  storeEmail: String,
  storePhone: String,
  storeAddress: String,
  primaryColor: String,
  secondaryColor: String,
  logo: String,
  favicon: String,
  emailProvider: String,
  smtpHost: String,
  smtpPort: Number,
  smtpUser: String,
  smtpPassword: String,
  emailFrom: String,
  emailReplyTo: String,
  enableCOD: Boolean,
  enableRazorpay: Boolean,
  razorpayKeyId: String,
  razorpayKeySecret: String,
  currency: String,
  taxRate: Number,
  enableTwoFactor: Boolean,
  passwordMinLength: Number,
  sessionTimeout: Number,
  emailNotifications: Boolean,
  orderNotifications: Boolean,
  reviewNotifications: Boolean,
  lowStockNotifications: Boolean,
  lowStockThreshold: Number,
  maintenanceMode: Boolean,
  maintenanceMessage: String,
  enableAnalytics: Boolean,
  googleAnalyticsId: String,
  facebookPixelId: String,
  topBannerText: String,
  topBannerLink: String,
  topBannerActive: { type: Boolean, default: false },
  topBannerBackgroundColor: String,
  topBannerTextColor: String,
}, { strict: false, timestamps: true });

const Settings = mongoose.models.Settings || mongoose.model('Settings', SettingsSchema);

async function disableTopBanner() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/fefa');
    console.log('Connected to MongoDB');

    // Find or create settings
    let settings = await Settings.findOne();
    
    if (!settings) {
      console.log('No settings found. Creating new settings document...');
      settings = await Settings.create({
        topBannerActive: false,
        topBannerText: '',
        topBannerLink: '',
      });
    } else {
      // Disable the banner
      settings.topBannerActive = false;
      settings.topBannerText = '';
      settings.topBannerLink = '';
      await settings.save();
    }

    console.log('✅ Top banner has been disabled');
    console.log('Settings updated:', {
      topBannerActive: settings.topBannerActive,
      topBannerText: settings.topBannerText || '(empty)',
    });

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error disabling top banner:', error);
    process.exit(1);
  }
}

disableTopBanner();
