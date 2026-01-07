import { Router, Response } from 'express';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { verifyToken, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import User from '../models/User';
import { connectDB } from '../config/database';

const router = Router();

/**
 * @route   POST /api/2fa/setup
 * @desc    Generate 2FA secret and QR code for setup
 * @access  Private
 */
router.post('/setup', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const userId = req.user?._id;

    if (!userId) {
      return next(createError('User not authenticated', 401));
    }

    // Get user with 2FA fields
    const user = await User.findById(userId).select('+twoFactorAuth.secret +twoFactorAuth.enabled');
    if (!user) {
      return next(createError('User not found', 404));
    }

    // Check if 2FA is already enabled
    if (user.twoFactorAuth?.enabled) {
      return next(createError('Two-factor authentication is already enabled', 400));
    }

    // Generate new secret
    const secret = speakeasy.generateSecret({
      name: `FEFA Jewelry (${user.email})`,
      issuer: 'FEFA Jewelry',
      length: 32
    });

    // Generate QR code data URL
    const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url || '');

    // Generate backup codes
    const backupCodes = Array.from({ length: 10 }, () => 
      crypto.randomBytes(4).toString('hex').toUpperCase()
    );

    // Store secret temporarily (not enabled yet until verified)
    user.twoFactorAuth = {
      enabled: false,
      secret: secret.base32,
      backupCodes: backupCodes.map(code => 
        crypto.createHash('sha256').update(code).digest('hex')
      ),
    };
    await user.save();

    res.json({
      success: true,
      data: {
        secret: secret.base32,
        qrCode: qrCodeDataUrl,
        backupCodes: backupCodes, // Only show once during setup
        manualEntry: secret.base32,
      },
      message: 'Scan the QR code with your authenticator app, then verify with a code'
    });
  } catch (error: any) {
    console.error('2FA setup error:', error);
    next(createError(error.message || 'Failed to setup 2FA', 500));
  }
});

/**
 * @route   POST /api/2fa/verify-setup
 * @desc    Verify 2FA code and enable 2FA
 * @access  Private
 */
router.post('/verify-setup', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const userId = req.user?._id;
    const { token } = req.body;

    if (!userId) {
      return next(createError('User not authenticated', 401));
    }

    if (!token) {
      return next(createError('Verification token is required', 400));
    }

    // Get user with 2FA fields
    const user = await User.findById(userId).select('+twoFactorAuth.secret +twoFactorAuth.enabled');
    if (!user) {
      return next(createError('User not found', 404));
    }

    if (!user.twoFactorAuth?.secret) {
      return next(createError('2FA setup has not been initiated', 400));
    }

    if (user.twoFactorAuth?.enabled) {
      return next(createError('2FA is already enabled', 400));
    }

    // Verify the token
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorAuth.secret,
      encoding: 'base32',
      token: token,
      window: 2 // Allow 2 time steps tolerance
    });

    if (!verified) {
      return next(createError('Invalid verification code. Please try again.', 400));
    }

    // Enable 2FA
    user.twoFactorAuth.enabled = true;
    user.twoFactorAuth.verifiedAt = new Date();
    await user.save();

    res.json({
      success: true,
      message: 'Two-factor authentication has been enabled successfully'
    });
  } catch (error: any) {
    console.error('2FA verify setup error:', error);
    next(createError(error.message || 'Failed to verify 2FA', 500));
  }
});

/**
 * @route   POST /api/2fa/verify
 * @desc    Verify 2FA code during login
 * @access  Public (but requires valid user context)
 */
router.post('/verify', async (req, res, next) => {
  try {
    await connectDB();
    const { userId, token } = req.body;

    if (!userId || !token) {
      return next(createError('User ID and verification token are required', 400));
    }

    // Get user with 2FA fields
    const user = await User.findById(userId).select('+twoFactorAuth.secret +twoFactorAuth.backupCodes');
    if (!user) {
      return next(createError('User not found', 404));
    }

    if (!user.twoFactorAuth?.enabled) {
      return next(createError('2FA is not enabled for this account', 400));
    }

    // First try TOTP verification
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorAuth.secret || '',
      encoding: 'base32',
      token: token,
      window: 2
    });

    if (verified) {
      return res.json({
        success: true,
        message: '2FA verification successful'
      });
    }

    // If TOTP failed, try backup codes
    const hashedToken = crypto.createHash('sha256').update(token.toUpperCase()).digest('hex');
    const backupCodeIndex = user.twoFactorAuth.backupCodes?.findIndex(code => code === hashedToken);

    if (backupCodeIndex !== undefined && backupCodeIndex >= 0) {
      // Remove used backup code
      user.twoFactorAuth.backupCodes?.splice(backupCodeIndex, 1);
      await user.save();

      return res.json({
        success: true,
        message: '2FA verification successful (backup code used)',
        backupCodeUsed: true,
        remainingBackupCodes: user.twoFactorAuth.backupCodes?.length || 0
      });
    }

    return next(createError('Invalid verification code', 400));
  } catch (error: any) {
    console.error('2FA verify error:', error);
    next(createError(error.message || 'Failed to verify 2FA', 500));
  }
});

/**
 * @route   POST /api/2fa/disable
 * @desc    Disable 2FA for user
 * @access  Private
 */
router.post('/disable', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const userId = req.user?._id;
    const { token, password } = req.body;

    if (!userId) {
      return next(createError('User not authenticated', 401));
    }

    if (!token) {
      return next(createError('Current 2FA token is required to disable', 400));
    }

    // Get user with 2FA fields
    const user = await User.findById(userId).select('+twoFactorAuth.secret +twoFactorAuth.enabled +twoFactorAuth.backupCodes');
    if (!user) {
      return next(createError('User not found', 404));
    }

    if (!user.twoFactorAuth?.enabled) {
      return next(createError('2FA is not enabled', 400));
    }

    // Verify the token
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorAuth.secret || '',
      encoding: 'base32',
      token: token,
      window: 2
    });

    // Also check backup codes
    const hashedToken = crypto.createHash('sha256').update(token.toUpperCase()).digest('hex');
    const isBackupCode = user.twoFactorAuth.backupCodes?.includes(hashedToken);

    if (!verified && !isBackupCode) {
      return next(createError('Invalid verification code', 400));
    }

    // Disable 2FA
    user.twoFactorAuth = {
      enabled: false,
      secret: undefined,
      backupCodes: undefined,
      verifiedAt: undefined,
    };
    await user.save();

    res.json({
      success: true,
      message: 'Two-factor authentication has been disabled'
    });
  } catch (error: any) {
    console.error('2FA disable error:', error);
    next(createError(error.message || 'Failed to disable 2FA', 500));
  }
});

/**
 * @route   GET /api/2fa/status
 * @desc    Get 2FA status for current user
 * @access  Private
 */
router.get('/status', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const userId = req.user?._id;

    if (!userId) {
      return next(createError('User not authenticated', 401));
    }

    const user = await User.findById(userId).select('+twoFactorAuth.enabled +twoFactorAuth.verifiedAt +twoFactorAuth.backupCodes');
    if (!user) {
      return next(createError('User not found', 404));
    }

    res.json({
      success: true,
      data: {
        enabled: user.twoFactorAuth?.enabled || false,
        verifiedAt: user.twoFactorAuth?.verifiedAt,
        backupCodesRemaining: user.twoFactorAuth?.backupCodes?.length || 0,
      }
    });
  } catch (error: any) {
    console.error('2FA status error:', error);
    next(createError(error.message || 'Failed to get 2FA status', 500));
  }
});

/**
 * @route   POST /api/2fa/regenerate-backup-codes
 * @desc    Generate new backup codes
 * @access  Private
 */
router.post('/regenerate-backup-codes', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();
    const userId = req.user?._id;
    const { token } = req.body;

    if (!userId) {
      return next(createError('User not authenticated', 401));
    }

    if (!token) {
      return next(createError('Current 2FA token is required', 400));
    }

    // Get user with 2FA fields
    const user = await User.findById(userId).select('+twoFactorAuth.secret +twoFactorAuth.enabled +twoFactorAuth.backupCodes');
    if (!user) {
      return next(createError('User not found', 404));
    }

    if (!user.twoFactorAuth?.enabled) {
      return next(createError('2FA is not enabled', 400));
    }

    // Verify the token
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorAuth.secret || '',
      encoding: 'base32',
      token: token,
      window: 2
    });

    if (!verified) {
      return next(createError('Invalid verification code', 400));
    }

    // Generate new backup codes
    const backupCodes = Array.from({ length: 10 }, () => 
      crypto.randomBytes(4).toString('hex').toUpperCase()
    );

    user.twoFactorAuth.backupCodes = backupCodes.map(code => 
      crypto.createHash('sha256').update(code).digest('hex')
    );
    await user.save();

    res.json({
      success: true,
      data: {
        backupCodes: backupCodes // Only shown once
      },
      message: 'New backup codes generated. Please save them in a safe place.'
    });
  } catch (error: any) {
    console.error('2FA regenerate backup codes error:', error);
    next(createError(error.message || 'Failed to regenerate backup codes', 500));
  }
});

export default router;
