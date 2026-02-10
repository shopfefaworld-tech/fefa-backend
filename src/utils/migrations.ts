/**
 * Database Migration Script
 * Run this script to update the database schema and data after code changes
 * 
 * Usage: 
 * - Import and call runMigrations() on server startup
 * - Or run manually: node -e "require('./dist/utils/migrations.js').runMigrations()"
 */

import mongoose from 'mongoose';
import Review from '../models/Review';
import Settings from '../models/Settings';
import Order from '../models/Order';
import { connectDB } from '../config/database';

interface MigrationResult {
  success: boolean;
  message: string;
  affected?: number;
}

/**
 * Migration 1: Update Review model default isApproved to false
 * Also update existing reviews that are approved but should be pending
 */
async function migrateReviewApprovalStatus(): Promise<MigrationResult> {
  try {
    // Update the schema default (this only affects new documents)
    // For existing documents, we'll update them explicitly
    const ReviewSchema = Review.schema;
    const isApprovedPath = ReviewSchema.path('isApproved');
    if (isApprovedPath) {
      (isApprovedPath as any).default(false);
    }

    // Optionally: Set all existing approved reviews to pending for re-moderation
    // Uncomment the following if you want to reset all reviews to pending:
    /*
    const result = await Review.updateMany(
      { isApproved: true },
      { $set: { isApproved: false } }
    );
    return {
      success: true,
      message: `Updated ${result.modifiedCount} reviews to pending status`,
      affected: result.modifiedCount
    };
    */

    // For now, just ensure the schema default is correct
    return {
      success: true,
      message: 'Review schema default updated to false (pending)',
      affected: 0
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Error migrating review approval status: ${error.message}`
    };
  }
}

/**
 * Migration 2: Initialize default Settings document
 */
async function migrateSettings(): Promise<MigrationResult> {
  try {
    const existingSettings = await Settings.findOne();
    
    if (existingSettings) {
      return {
        success: true,
        message: 'Settings document already exists',
        affected: 0
      };
    }

    // Create default settings
    const defaultSettings = await Settings.create({
      storeName: 'FEFA Jewelry',
      storeDescription: 'Premium artificial jewelry store',
      storeEmail: 'info@fefajewelry.com',
      storePhone: '',
      storeAddress: '',
      primaryColor: '#3B82F6',
      secondaryColor: '#8B5CF6',
      emailProvider: 'smtp',
      emailFrom: 'info@fefajewelry.com',
      enableCOD: true,
      enableRazorpay: true,
      shippingProvider: 'bluedart',
      shippingAutoCreateShipment: false,
      shippingPickupPincode: process.env.SHIPPING_PICKUP_PINCODE || '110001',
      shippingDefaultWeight: 0.5,
      shippingDefaultLength: 15,
      shippingDefaultBreadth: 10,
      shippingDefaultHeight: 5,
      shippingInsuredByDefault: false,
      shippingDefaultServiceType: 'surface',
      currency: 'INR',
      taxRate: 0,
      enableTwoFactor: false,
      passwordMinLength: 8,
      sessionTimeout: 3600,
      emailNotifications: true,
      orderNotifications: true,
      reviewNotifications: true,
      lowStockNotifications: true,
      lowStockThreshold: 10,
      maintenanceMode: false,
      enableAnalytics: false
    });

    return {
      success: true,
      message: 'Default settings document created',
      affected: 1
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Error initializing settings: ${error.message}`
    };
  }
}

/**
 * Migration 4: Ensure shipping settings fields exist
 */
async function migrateShippingSettingsDefaults(): Promise<MigrationResult> {
  try {
    const settings = await Settings.findOne();
    if (!settings) {
      return {
        success: true,
        message: 'Settings not found, skipped shipping settings default migration',
        affected: 0,
      };
    }

    let touched = false;
    const defaults: Record<string, any> = {
      shippingProvider: 'bluedart',
      shippingAutoCreateShipment: false,
      shippingPickupPincode: process.env.SHIPPING_PICKUP_PINCODE || '110001',
      shippingDefaultWeight: 0.5,
      shippingDefaultLength: 15,
      shippingDefaultBreadth: 10,
      shippingDefaultHeight: 5,
      shippingInsuredByDefault: false,
      shippingDefaultServiceType: 'surface',
    };

    Object.entries(defaults).forEach(([key, value]) => {
      if ((settings as any)[key] === undefined || (settings as any)[key] === null) {
        (settings as any)[key] = value;
        touched = true;
      }
    });

    if (touched) {
      await settings.save();
      return {
        success: true,
        message: 'Shipping settings defaults added to settings document',
        affected: 1,
      };
    }

    return {
      success: true,
      message: 'Shipping settings defaults already present',
      affected: 0,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Error migrating shipping settings defaults: ${error.message}`,
    };
  }
}

/**
 * Migration 3: Move provider-specific tracking fields to generic fields
 * - tracking.shiprocketOrderId -> tracking.providerOrderId
 * - tracking.shipmentId -> tracking.providerShipmentId
 * - tracking.provider defaults:
 *   - bluedart: records that had provider IDs
 *   - manual: records with manual tracking but no provider IDs
 */
async function migrateShippingTrackingFields(): Promise<MigrationResult> {
  try {
    const orders = await Order.find({
      tracking: { $exists: true },
      $or: [
        { 'tracking.provider': { $exists: false } },
        { 'tracking.providerOrderId': { $exists: false } },
        { 'tracking.providerShipmentId': { $exists: false } },
        { 'tracking.providerOrderId': '' },
        { 'tracking.providerShipmentId': '' },
      ],
    }).select('_id tracking');

    let modifiedCount = 0;

    for (const order of orders) {
      const tracking: any = order.tracking || {};
      let touched = false;

      const legacyOrderId = tracking.shiprocketOrderId;
      const legacyShipmentId = tracking.shipmentId;

      if (!tracking.providerOrderId && legacyOrderId !== undefined && legacyOrderId !== null) {
        tracking.providerOrderId = String(legacyOrderId);
        touched = true;
      }

      if (!tracking.providerShipmentId && legacyShipmentId !== undefined && legacyShipmentId !== null) {
        tracking.providerShipmentId = String(legacyShipmentId);
        touched = true;
      }

      if (!tracking.provider) {
        if (tracking.providerOrderId || tracking.providerShipmentId) {
          tracking.provider = 'bluedart';
        } else if (tracking.trackingNumber || tracking.trackingUrl || tracking.carrier) {
          tracking.provider = 'manual';
        }
        touched = true;
      }

      if (touched) {
        order.tracking = tracking;
        await order.save();
        modifiedCount += 1;
      }
    }

    return {
      success: true,
      message: 'Shipping tracking fields migration completed',
      affected: modifiedCount,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Error migrating shipping tracking fields: ${error.message}`,
    };
  }
}

/**
 * Run all migrations
 */
export async function runMigrations(): Promise<void> {
  try {
    console.log('🔄 Starting database migrations...');
    
    // Ensure database connection
    await connectDB();

    const results: MigrationResult[] = [];

    // Run migrations
    results.push(await migrateReviewApprovalStatus());
    results.push(await migrateSettings());
    results.push(await migrateShippingTrackingFields());
    results.push(await migrateShippingSettingsDefaults());

    // Log results
    console.log('\n📊 Migration Results:');
    results.forEach((result, index) => {
      if (result.success) {
        console.log(`✅ Migration ${index + 1}: ${result.message}${result.affected !== undefined ? ` (${result.affected} affected)` : ''}`);
      } else {
        console.error(`❌ Migration ${index + 1} failed: ${result.message}`);
      }
    });

    const allSuccess = results.every(r => r.success);
    if (allSuccess) {
      console.log('\n✨ All migrations completed successfully!');
    } else {
      console.error('\n⚠️  Some migrations failed. Please review the errors above.');
    }
  } catch (error: any) {
    console.error('❌ Fatal error running migrations:', error);
    throw error;
  }
}

// If running directly
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration script failed:', error);
      process.exit(1);
    });
}
