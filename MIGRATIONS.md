# Database Migrations Guide

This document explains the database changes required after the admin panel updates.

## What Changed?

### 1. Review Model
- **Change**: Default `isApproved` changed from `true` to `false`
- **Reason**: New reviews now require admin approval before being displayed
- **Impact**: 
  - New reviews will be created with `isApproved: false` (pending)
  - Existing approved reviews remain approved
  - Admin must approve reviews before they appear on the frontend

### 2. Settings Collection
- **Change**: New `Settings` model and collection
- **Reason**: Store application-wide settings (store info, email config, payment settings, etc.)
- **Impact**: 
  - A default settings document will be created automatically on first access
  - Or you can run migrations to initialize it immediately

## Running Migrations

### Option 1: Using npm script (Recommended)
```bash
cd backend
npm run migrate
```

### Option 2: Manual execution
```bash
cd backend
npx tsc
node dist/utils/migrations.js
```

### Option 3: Programmatic (from code)
```typescript
import { runMigrations } from './utils/migrations';

// Run on server startup (optional)
await runMigrations();
```

## What the Migration Does

1. **Review Schema Update**
   - Updates the default value for `isApproved` to `false`
   - This only affects new documents (existing reviews are unchanged)

2. **Settings Initialization**
   - Creates a default settings document if one doesn't exist
   - Sets up default values for:
     - Store information (name, email, address)
     - Appearance (colors, logo)
     - Email configuration
     - Payment settings (Razorpay, COD)
     - Security settings
     - Notification preferences

## Important Notes

- **Existing Reviews**: Existing approved reviews (`isApproved: true`) will remain approved
- **New Reviews**: All new reviews will be created as pending (`isApproved: false`)
- **Settings**: The settings document is created automatically when first accessed via the API, but running migrations ensures it exists immediately
- **No Data Loss**: These migrations are safe and won't delete or modify existing data (except schema defaults)

## Verification

After running migrations, verify:

1. **Reviews**: Check that new reviews are created with `isApproved: false`
   ```javascript
   // In MongoDB shell or Compass
   db.reviews.find({ isApproved: false }).count()
   ```

2. **Settings**: Check that settings document exists
   ```javascript
   // In MongoDB shell or Compass
   db.settings.findOne()
   ```

## Troubleshooting

### Migration fails with connection error
- Ensure MongoDB is running and accessible
- Check your `.env` file has correct `MONGODB_URI`

### Settings already exists error
- This is normal if settings were already created via the API
- The migration will skip creating settings if it already exists

### TypeScript compilation errors
- Run `npm install` to ensure all dependencies are installed
- Check that `tsconfig.json` is properly configured

## Next Steps

After running migrations:
1. Restart your backend server
2. Test the admin panel review moderation features
3. Check that settings page loads correctly
4. Verify new reviews appear as "pending" in admin panel
