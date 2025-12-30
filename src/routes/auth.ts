import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { getFirebaseAuth } from '../config/firebase';
import { User, IUser, OTP, IOTP } from '../models';
import { verifyToken, verifyFirebaseToken, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { ensureDB } from '../middleware/ensureDB';
import jwt from 'jsonwebtoken';
import { sendEmailOTP } from '../config/email';

const router = Router();

// Apply ensureDB middleware to all auth routes that need database access
router.use(ensureDB);

// Validation schemas
const registerSchema = Joi.object({
  firebaseUid: Joi.string().required(),
  email: Joi.string().email().required(),
  firstName: Joi.string().min(2).max(50).required(),
  lastName: Joi.string().min(2).max(50).required(),
  phone: Joi.string().pattern(/^[6-9]\d{9}$/).optional(),
  dateOfBirth: Joi.date().optional(),
  gender: Joi.string().valid('male', 'female', 'other').optional(),
});

const emailPasswordRegisterSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  firstName: Joi.string().min(2).max(50).required(),
  lastName: Joi.string().min(2).max(50).required(),
  phone: Joi.string().pattern(/^[6-9]\d{9}$/).optional(),
  dateOfBirth: Joi.date().optional(),
  gender: Joi.string().valid('male', 'female', 'other').optional(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

const googleTokenSchema = Joi.object({
  idToken: Joi.string().required(),
});

const otpVerifySchema = Joi.object({
  idToken: Joi.string().required(),
  phone: Joi.string().optional(),
  email: Joi.string().email().optional(),
});

const sendEmailOTPSchema = Joi.object({
  email: Joi.string().email().required(),
});

const verifyEmailOTPSchema = Joi.object({
  email: Joi.string().email().required(),
  otp: Joi.string().length(6).pattern(/^\d+$/).required(),
});

const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
});

const resetPasswordSchema = Joi.object({
  token: Joi.string().required(),
  newPassword: Joi.string().min(6).required(),
});

// Root auth endpoint - provides info about available auth endpoints
router.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Authentication API',
    endpoints: {
      'verify-otp': 'POST /api/auth/verify-otp',
      login: 'POST /api/auth/login',
      google: 'POST /api/auth/google',
      'forgot-password': 'POST /api/auth/forgot-password',
      'reset-password': 'POST /api/auth/reset-password',
      me: 'GET /api/auth/me',
      profile: 'PUT /api/auth/profile',
      'addresses-create': 'POST /api/auth/addresses',
      'addresses-update': 'PUT /api/auth/addresses/:id',
      'addresses-delete': 'DELETE /api/auth/addresses/:id',
      logout: 'POST /api/auth/logout'
    }
  });
});

// Helper function to generate JWT tokens
const generateTokens = (userId: string) => {
  const accessToken = jwt.sign(
    { userId },
    process.env.JWT_SECRET || 'fallback-secret',
    { expiresIn: '15m' }
  );
  
  const refreshToken = jwt.sign(
    { userId },
    process.env.JWT_REFRESH_SECRET || 'fallback-refresh-secret',
    { expiresIn: '7d' }
  );
  
  return { accessToken, refreshToken };
};

const updateProfileSchema = Joi.object({
  firstName: Joi.string().min(2).max(50).optional(),
  lastName: Joi.string().min(2).max(50).optional(),
  phone: Joi.string().pattern(/^[6-9]\d{9}$/).optional(),
  dateOfBirth: Joi.date().optional(),
  gender: Joi.string().valid('male', 'female', 'other').optional(),
  preferences: Joi.object({
    newsletter: Joi.boolean().optional(),
    smsNotifications: Joi.boolean().optional(),
    emailNotifications: Joi.boolean().optional(),
  }).optional(),
});

// @route   POST /api/auth/register-email
// @desc    Register user with email and password
// @access  Public
router.post('/register-email', async (req: Request, res: Response, next) => {
  try {
    const { error, value } = emailPasswordRegisterSchema.validate(req.body);
    if (error) {
      throw createError(error.details[0].message, 400);
    }

    const { email, password, firstName, lastName, phone, dateOfBirth, gender } = value;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw createError('User with this email already exists', 409);
    }

    // Create Firebase user
    const auth = getFirebaseAuth();
    const firebaseUser = await auth.createUser({
      email,
      password,
      displayName: `${firstName} ${lastName}`,
      emailVerified: false,
    });

    // Create user in MongoDB
    const user = new User({
      firebaseUid: firebaseUser.uid,
      email,
      firstName,
      lastName,
      phone,
      dateOfBirth,
      gender,
      lastLogin: new Date(),
    });

    await user.save();

    // Generate JWT tokens
    const tokens = generateTokens((user._id as any).toString());

    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: `${user.firstName} ${user.lastName}`,
          phone: user.phone,
          profileImage: user.profileImage,
          role: user.role,
          preferences: user.preferences,
          createdAt: user.createdAt,
        },
        tokens
      }
    });
  } catch (error) {
    next(error);
    return;
  }
});

// @route   POST /api/auth/login
// @desc    Login user with email and password
// @access  Public
router.post('/login', async (req: Request, res: Response, next) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      throw createError(error.details[0].message, 400);
    }

    const { email, password } = value;

    // First check if user exists in our database
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      throw createError('Invalid credentials', 401);
    }

    // Verify password using Firebase Auth REST API
    // Firebase Admin SDK doesn't verify passwords directly, so we use the REST API
    const firebaseApiKey = process.env.FIREBASE_WEB_API_KEY || process.env.FIREBASE_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
      throw createError('Firebase API key not configured', 500);
    }

    try {
      // Call Firebase Auth REST API to verify password
      const response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: email.toLowerCase().trim(),
            password: password,
            returnSecureToken: true,
          }),
        }
      );

      const data = await response.json() as {
        error?: {
          message?: string;
        };
        localId?: string;
        idToken?: string;
        email?: string;
      };

      if (!response.ok) {
        // Handle Firebase auth errors
        if (data.error?.message?.includes('INVALID_PASSWORD') || 
            data.error?.message?.includes('INVALID_EMAIL') ||
            data.error?.message?.includes('EMAIL_NOT_FOUND')) {
          throw createError('Invalid credentials', 401);
        } else if (data.error?.message?.includes('TOO_MANY_ATTEMPTS')) {
          throw createError('Too many failed login attempts. Please try again later.', 429);
        } else {
          throw createError(data.error?.message || 'Authentication failed', 401);
        }
      }

      // Password verified successfully
      // Update Firebase UID if missing or different
      if (data.localId && (!user.firebaseUid || user.firebaseUid !== data.localId)) {
        user.firebaseUid = data.localId;
      }

      // Update last login
      user.lastLogin = new Date();
      await user.save();

      // Generate JWT tokens
      const tokens = generateTokens((user._id as any).toString());

      return res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: {
            id: user._id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || email,
            phone: user.phone,
            profileImage: user.profileImage,
            role: user.role,
            preferences: user.preferences,
            lastLogin: user.lastLogin,
          },
          tokens
        }
      });
    } catch (fetchError: any) {
      // If Firebase REST API call fails, check if it's a credential error
      if (fetchError.status === 401 || fetchError.message?.includes('Invalid credentials')) {
        throw fetchError;
      }
      // For other errors, log and throw generic error
      console.error('Firebase Auth REST API error:', fetchError);
      throw createError('Authentication failed. Please try again.', 401);
    }
  } catch (error: any) {
    if (error.status) {
      next(error);
      return;
    }
    next(error);
    return;
  }
});

// @route   POST /api/auth/verify-otp
// @desc    Verify OTP and login/register user
// @access  Public
router.post('/verify-otp', async (req: Request, res: Response, next) => {
  try {
    const { error, value } = otpVerifySchema.validate(req.body);
    if (error) {
      throw createError(error.details[0].message, 400);
    }

    const { idToken, phone, email } = value;

    // Verify Firebase ID token
    const auth = getFirebaseAuth();
    const decodedToken = await auth.verifyIdToken(idToken);
    
    const { uid, phone_number, email: firebaseEmail } = decodedToken;
    
    // Use phone or email from token if not provided
    const userPhone = phone || phone_number;
    const userEmail = email || firebaseEmail;

    // Normalize phone number for comparison (remove spaces, ensure consistent format)
    const normalizePhone = (phoneNum: string | undefined): string | undefined => {
      if (!phoneNum) return undefined;
      // Remove all non-digit characters except +
      const cleaned = phoneNum.replace(/[^\d+]/g, '');
      // If it doesn't start with +, try to normalize
      if (!cleaned.startsWith('+')) {
        // If it's 10 digits, assume Indian number and add +91
        if (cleaned.length === 10) {
          return `+91${cleaned}`;
        }
        // If it's 12 digits and starts with 91, add +
        if (cleaned.length === 12 && cleaned.startsWith('91')) {
          return `+${cleaned}`;
        }
      }
      return cleaned;
    };

    const normalizedPhone = normalizePhone(userPhone);
    const normalizedEmail = userEmail ? userEmail.toLowerCase().trim() : undefined;

    console.log('Checking for existing user:', {
      uid,
      userPhone,
      normalizedPhone,
      userEmail,
      normalizedEmail,
    });

    // Check if user exists in MongoDB by firebaseUid, email, or phone
    // Try multiple phone formats for better matching
    const phoneQueries = normalizedPhone ? [
      { phone: normalizedPhone },
      { phone: normalizedPhone.replace('+', '') }, // Without +
      { phone: normalizedPhone.replace('+91', '') }, // Without country code
      { phone: normalizedPhone.replace('+91', '0') }, // With 0 prefix
      // Also try with spaces removed
      { phone: normalizedPhone.replace(/\s/g, '') },
    ] : [];

    let user = await User.findOne({ 
      $or: [
        { firebaseUid: uid },
        ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
        ...phoneQueries
      ]
    });

    console.log('User lookup result:', user ? {
      id: user._id,
      email: user.email,
      phone: user.phone,
      firebaseUid: user.firebaseUid,
    } : 'No user found');

    if (user) {
      // User exists - update Firebase UID if different, and update phone/email if missing
      if (user.firebaseUid && user.firebaseUid !== uid) {
        user.firebaseUid = uid;
      } else if (!user.firebaseUid) {
        // If user doesn't have firebaseUid (email-only user), update it
        user.firebaseUid = uid;
      }
      // Update phone if missing or different (normalize before comparing)
      if (normalizedPhone) {
        const existingPhoneNormalized = user.phone ? normalizePhone(user.phone) : null;
        if (!user.phone || existingPhoneNormalized !== normalizedPhone) {
          user.phone = normalizedPhone;
        }
      }
      // Update email if missing
      if (normalizedEmail && !user.email) {
        user.email = normalizedEmail;
      }
      user.lastLogin = new Date();
      await user.save();
    } else {
      // New user - auto-create account
      const nameParts = decodedToken.name ? decodedToken.name.split(' ') : ['', ''];
      user = new User({
        firebaseUid: uid,
        email: normalizedEmail || undefined,
        phone: normalizedPhone || undefined,
        firstName: nameParts[0] || '',
        lastName: nameParts.slice(1).join(' ') || '',
        profileImage: decodedToken.picture,
        lastLogin: new Date(),
      });
      await user.save();
    }

    // Generate JWT tokens
    const tokens = generateTokens((user._id as any).toString());

    return res.json({
      success: true,
      message: 'OTP verified successfully',
      data: {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User',
          phone: user.phone,
          profileImage: user.profileImage,
          role: user.role,
          preferences: user.preferences,
          lastLogin: user.lastLogin,
        },
        tokens
      }
    });
  } catch (error: any) {
    if (error.code === 'auth/id-token-expired') {
      next(createError('OTP verification expired. Please try again.', 401));
    } else if (error.code === 'auth/invalid-id-token') {
      next(createError('Invalid OTP. Please try again.', 401));
    } else {
      next(error);
    }
    return;
  }
});

// @route   POST /api/auth/google
// @desc    Login/Register with Google
// @access  Public
router.post('/google', async (req: Request, res: Response, next) => {
  try {
    const { error, value } = googleTokenSchema.validate(req.body);
    if (error) {
      throw createError(error.details[0].message, 400);
    }

    const { idToken } = value;

    // Verify Firebase ID token
    const auth = getFirebaseAuth();
    const decodedToken = await auth.verifyIdToken(idToken);
    
    const { uid, email, name, picture } = decodedToken;
    
    if (!email) {
      throw createError('Email not provided by Google', 400);
    }

    // Check if user exists in MongoDB
    let user = await User.findOne({ 
      $or: [
        { firebaseUid: uid },
        { email: email }
      ]
    });

    if (user) {
      // If user exists but with different Firebase UID, update it
      if (user.firebaseUid && user.firebaseUid !== uid) {
        user.firebaseUid = uid;
        await user.save();
      } else if (!user.firebaseUid) {
        // If user doesn't have firebaseUid (email-only user), update it
        user.firebaseUid = uid;
        await user.save();
      }
    } else {
      // Create new user
      const nameParts = name ? name.split(' ') : ['', ''];
      user = new User({
        firebaseUid: uid,
        email,
        firstName: nameParts[0] || '',
        lastName: nameParts.slice(1).join(' ') || '',
        profileImage: picture,
        lastLogin: new Date(),
      });
      await user.save();
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate JWT tokens
    const tokens = generateTokens((user._id as any).toString());

    return res.json({
      success: true,
      message: 'Google authentication successful',
      data: {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: `${user.firstName} ${user.lastName}`,
          phone: user.phone,
          profileImage: user.profileImage,
          role: user.role,
          preferences: user.preferences,
          lastLogin: user.lastLogin,
        },
        tokens
      }
    });
  } catch (error) {
    next(error);
    return;
  }
});

// @route   POST /api/auth/forgot-password
// @desc    Request password reset
// @access  Public
router.post('/forgot-password', async (req: Request, res: Response, next) => {
  try {
    const { error, value } = forgotPasswordSchema.validate(req.body);
    if (error) {
      throw createError(error.details[0].message, 400);
    }

    const { email } = value;

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal if user exists or not for security
      return res.json({
        success: true,
        message: 'If an account with that email exists, we have sent a password reset link.'
      });
    }

    // Generate password reset token
    const resetToken = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '1h' }
    );

    // In a real application, you would:
    // 1. Store the reset token in database with expiration
    // 2. Send email with reset link containing the token
    // 3. Use a service like SendGrid, AWS SES, or Nodemailer

    return res.json({
      success: true,
      message: 'If an account with that email exists, we have sent a password reset link.',
      // In development, include the reset token for testing
      ...(process.env.NODE_ENV === 'development' && { resetToken })
    });
  } catch (error) {
    next(error);
    return;
  }
});

// @route   POST /api/auth/reset-password
// @desc    Reset password with token
// @access  Public
router.post('/reset-password', async (req: Request, res: Response, next) => {
  try {
    const { error, value } = resetPasswordSchema.validate(req.body);
    if (error) {
      throw createError(error.details[0].message, 400);
    }

    const { token, newPassword } = value;

    // Verify reset token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret') as any;
    
    // Find user
    const user = await User.findById(decoded.userId);
    if (!user) {
      throw createError('Invalid or expired reset token', 400);
    }

    // Update password in Firebase (only if user has a Firebase UID)
    if (!user.firebaseUid) {
      throw createError('Password reset is only available for Firebase-authenticated users. Please use OTP login instead.', 400);
    }

    const auth = getFirebaseAuth();
    await auth.updateUser(user.firebaseUid, {
      password: newPassword
    });

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    return res.json({
      success: true,
      message: 'Password has been reset successfully. You can now login with your new password.'
    });
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      next(createError('Reset token has expired. Please request a new password reset.', 400));
      return;
    } else if (error.name === 'JsonWebTokenError') {
      next(createError('Invalid reset token', 400));
      return;
    } else {
      next(error);
      return;
    }
  }
});

// @route   POST /api/auth/register
// @desc    Register user with Firebase UID
// @access  Public
router.post('/register', async (req: Request, res: Response, next) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      throw createError(error.details[0].message, 400);
    }

    const { firebaseUid, email, firstName, lastName, phone, dateOfBirth, gender } = value;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ firebaseUid }, { email }]
    });

    if (existingUser) {
      throw createError('User already exists', 409);
    }

    // Verify Firebase UID (optional - you can skip this if you trust the frontend)
    try {
      const auth = getFirebaseAuth();
      await auth.getUser(firebaseUid);
    } catch (firebaseError) {
      throw createError('Invalid Firebase UID', 400);
    }

    // Create new user
    const user = new User({
      firebaseUid,
      email,
      firstName,
      lastName,
      phone,
      dateOfBirth,
      gender,
      lastLogin: new Date(),
    });

    await user.save();

    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: `${user.firstName} ${user.lastName}`,
          phone: user.phone,
          profileImage: user.profileImage,
          role: user.role,
          preferences: user.preferences,
          createdAt: user.createdAt,
        }
      }
    });
  } catch (error) {
    next(error);
    return;
  }
});

// @route   GET /api/auth/me
// @desc    Get current user profile
// @access  Private
router.get('/me', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    const user = req.user;

    return res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: `${user.firstName} ${user.lastName}`,
          phone: user.phone,
          dateOfBirth: user.dateOfBirth,
          gender: user.gender,
          profileImage: user.profileImage,
          role: user.role,
          addresses: user.addresses,
          preferences: user.preferences,
          lastLogin: user.lastLogin,
          createdAt: user.createdAt,
        }
      }
    });
  } catch (error) {
    next(error);
    return;
  }
});

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    const { error, value } = updateProfileSchema.validate(req.body);
    if (error) {
      throw createError(error.details[0].message, 400);
    }

    const user = req.user;
    const updates = value;

    // Update user fields
    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        user[key] = updates[key];
      }
    });

    await user.save();

    return res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: `${user.firstName} ${user.lastName}`,
          phone: user.phone,
          dateOfBirth: user.dateOfBirth,
          gender: user.gender,
          profileImage: user.profileImage,
          preferences: user.preferences,
          updatedAt: user.updatedAt,
        }
      }
    });
  } catch (error) {
    next(error);
    return;
  }
});

// @route   POST /api/auth/addresses
// @desc    Add new address
// @access  Private
router.post('/addresses', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    const addressSchema = Joi.object({
      type: Joi.string().valid('home', 'work', 'other').required(),
      firstName: Joi.string().required(),
      lastName: Joi.string().required(),
      company: Joi.string().optional(),
      addressLine1: Joi.string().required(),
      addressLine2: Joi.string().optional(),
      city: Joi.string().required(),
      state: Joi.string().required(),
      postalCode: Joi.string().required(),
      country: Joi.string().default('India'),
      phone: Joi.string().required(),
      isDefault: Joi.boolean().default(false),
    });

    const { error, value } = addressSchema.validate(req.body);
    if (error) {
      throw createError(error.details[0].message, 400);
    }

    const user = req.user;

    // If this is set as default, unset other defaults
    if (value.isDefault) {
      user.addresses.forEach((addr: any) => {
        addr.isDefault = false;
      });
    }

    user.addresses.push(value);
    await user.save();

    return res.status(201).json({
      success: true,
      message: 'Address added successfully',
      data: {
        address: user.addresses[user.addresses.length - 1]
      }
    });
  } catch (error) {
    next(error);
    return;
  }
});

// @route   PUT /api/auth/addresses/:addressId
// @desc    Update address
// @access  Private
router.put('/addresses/:addressId', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    const addressSchema = Joi.object({
      type: Joi.string().valid('home', 'work', 'other').optional(),
      firstName: Joi.string().optional(),
      lastName: Joi.string().optional(),
      company: Joi.string().optional(),
      addressLine1: Joi.string().optional(),
      addressLine2: Joi.string().optional(),
      city: Joi.string().optional(),
      state: Joi.string().optional(),
      postalCode: Joi.string().optional(),
      country: Joi.string().optional(),
      phone: Joi.string().optional(),
      isDefault: Joi.boolean().optional(),
    });

    const { error, value } = addressSchema.validate(req.body);
    if (error) {
      throw createError(error.details[0].message, 400);
    }

    const user = req.user;
    const addressId = req.params.addressId;
    const address = user.addresses.id(addressId);

    if (!address) {
      throw createError('Address not found', 404);
    }

    // If this is set as default, unset other defaults
    if (value.isDefault) {
      user.addresses.forEach((addr: any) => {
        if (addr._id.toString() !== addressId) {
          addr.isDefault = false;
        }
      });
    }

    Object.keys(value).forEach(key => {
      if (value[key] !== undefined) {
        address[key] = value[key];
      }
    });

    await user.save();

    return res.json({
      success: true,
      message: 'Address updated successfully',
      data: { address }
    });
  } catch (error) {
    next(error);
    return;
  }
});

// @route   DELETE /api/auth/addresses/:addressId
// @desc    Delete address
// @access  Private
router.delete('/addresses/:addressId', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    const user = req.user;
    const addressId = req.params.addressId;
    const address = user.addresses.id(addressId);

    if (!address) {
      throw createError('Address not found', 404);
    }

    address.remove();
    await user.save();

    return res.json({
      success: true,
      message: 'Address deleted successfully'
    });
  } catch (error) {
    next(error);
    return;
  }
});

// @route   POST /api/auth/send-email-otp
// @desc    Send OTP code to email
// @access  Public
router.post('/send-email-otp', async (req: Request, res: Response, next) => {
  try {
    const { error, value } = sendEmailOTPSchema.validate(req.body);
    if (error) {
      throw createError(error.details[0].message, 400);
    }

    const { email } = value;

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store OTP in database (expires in 10 minutes)
    const otpRecord = new OTP({
      email,
      otp,
      type: 'email',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      attempts: 0,
      verified: false,
    });

    await otpRecord.save();

    // Send email with OTP
    try {
      await sendEmailOTP(email, otp);
    } catch (emailError: any) {
      console.error('Email sending error:', emailError);
      throw createError(
        `Failed to send email: ${emailError.message || 'Please check your SMTP configuration in .env file'}`,
        500
      );
    }

    return res.json({
      success: true,
      message: 'OTP sent to your email. Please check your inbox.',
      data: {
        email,
        expiresIn: 600, // 10 minutes in seconds
      }
    });
  } catch (error: any) {
    console.error('Send email OTP route error:', error);
    next(error);
    return;
  }
});

// @route   POST /api/auth/verify-email-otp
// @desc    Verify email OTP and login/register user
// @access  Public
router.post('/verify-email-otp', async (req: Request, res: Response, next) => {
  try {
    const { error, value } = verifyEmailOTPSchema.validate(req.body);
    if (error) {
      throw createError(error.details[0].message, 400);
    }

    const { email, otp } = value;

    // Find OTP record
    const otpRecord = await OTP.findOne({
      email: email.toLowerCase(),
      type: 'email',
      verified: false,
    }).sort({ createdAt: -1 });

    if (!otpRecord) {
      throw createError('OTP not found. Please request a new OTP.', 404);
    }

    // Check if OTP is expired
    if (new Date() > otpRecord.expiresAt) {
      throw createError('OTP has expired. Please request a new OTP.', 400);
    }

    // Check attempts (max 5 attempts)
    if (otpRecord.attempts >= 5) {
      throw createError('Too many failed attempts. Please request a new OTP.', 429);
    }

    // Verify OTP
    if (otpRecord.otp !== otp) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      throw createError('Invalid OTP code. Please try again.', 400);
    }

    // Mark OTP as verified
    otpRecord.verified = true;
    await otpRecord.save();

    // Normalize email for comparison
    const normalizedEmail = email.toLowerCase().trim();

    console.log('Checking for existing user by email:', normalizedEmail);

    // Check if user exists by email
    let user = await User.findOne({ email: normalizedEmail });

    console.log('User lookup result:', user ? {
      id: user._id,
      email: user.email,
      phone: user.phone,
      firebaseUid: user.firebaseUid,
    } : 'No user found - will create new user');

    if (!user) {
      // Create new user with email
      // Generate a unique identifier for email-only users (no Firebase UID)
      const emailUserId = `email-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      
      user = new User({
        firebaseUid: emailUserId, // Use generated ID for email-only users
        email: email.toLowerCase(),
        firstName: '',
        lastName: '',
        lastLogin: new Date(),
      });
      await user.save();
    } else {
      // Update last login
      user.lastLogin = new Date();
      await user.save();
    }

    // Generate JWT tokens
    const tokens = generateTokens((user._id as any).toString());

    return res.json({
      success: true,
      message: 'Email verified successfully',
      data: {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: `${user.firstName} ${user.lastName}`,
          phone: user.phone,
          profileImage: user.profileImage,
          role: user.role,
        },
        tokens,
      }
    });
  } catch (error) {
    next(error);
    return;
  }
});

// @route   POST /api/auth/logout
// @desc    Logout user (client-side token removal)
// @access  Private
router.post('/logout', verifyToken, async (req: AuthRequest, res: Response, next) => {
  try {
    // In a stateless JWT system, logout is handled client-side
    // You can add token blacklisting here if needed
    return res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    next(error);
    return;
  }
});

export default router;
