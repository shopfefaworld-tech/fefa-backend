import { Router, Response } from 'express';
import { verifyToken, AuthRequest, requireAdmin } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import Settings from '../models/Settings';
import { connectDB } from '../config/database';

const router = Router();

/**
 * @route   GET /api/settings
 * @desc    Get application settings
 * @access  Private/Admin
 */
router.get('/', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();

    let settings = await Settings.findOne();
    
    // If no settings exist, create default settings
    if (!settings) {
      settings = await Settings.create({
        storeName: 'FEFA Jewelry',
        storeDescription: 'Premium artificial jewelry store',
        storeEmail: process.env.SMTP_USER || 'contact@fefajewelry.com',
        emailFrom: process.env.SMTP_USER || 'contact@fefajewelry.com',
      });
    }

    res.json({
      success: true,
      data: settings
    });
  } catch (error: any) {
    next(createError(error.message || 'Failed to fetch settings', 500));
  }
});

/**
 * @route   PUT /api/settings
 * @desc    Update application settings
 * @access  Private/Admin
 */
router.put('/', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();

    let settings = await Settings.findOne();
    
    // If no settings exist, create new
    if (!settings) {
      settings = await Settings.create(req.body);
    } else {
      // Update existing settings
      Object.assign(settings, req.body);
      await settings.save();
    }

    res.json({
      success: true,
      data: settings,
      message: 'Settings updated successfully'
    });
  } catch (error: any) {
    next(createError(error.message || 'Failed to update settings', 500));
  }
});

/**
 * @route   POST /api/settings/test-email
 * @desc    Send a test email
 * @access  Private/Admin
 */
router.post('/test-email', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return next(createError('Email address is required', 400));
    }

    // TODO: Implement actual email sending using configured email provider
    // For now, just return success
    res.json({
      success: true,
      message: `Test email would be sent to ${email}`
    });
  } catch (error: any) {
    next(createError(error.message || 'Failed to send test email', 500));
  }
});

export default router;
