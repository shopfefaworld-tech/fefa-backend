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
