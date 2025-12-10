import { Request, Response, NextFunction } from 'express';
import { getFirebaseAuth } from '../config/firebase';
import { User } from '../models';
import { createError } from './errorHandler';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: any;
  firebaseUser?: any;
}

// Middleware to verify JWT token
export const verifyToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw createError('Access token required', 401);
    }

    const token = authHeader.split(' ')[1];
    
    if (!token) {
      throw createError('Access token required', 401);
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret') as any;
    
    // Get user from database
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      throw createError('User not found', 404);
    }

    if (!user.isActive) {
      throw createError('Account is deactivated', 403);
    }

    req.user = user;
    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      next(createError('Token expired', 401));
    } else if (error.name === 'JsonWebTokenError') {
      next(createError('Invalid token', 401));
    } else {
      next(error);
    }
  }
};

// Middleware to verify Firebase token (for backward compatibility)
export const verifyFirebaseToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw createError('Access token required', 401);
    }

    const token = authHeader.split(' ')[1];
    
    if (!token) {
      throw createError('Access token required', 401);
    }

    // Verify Firebase token
    const auth = getFirebaseAuth();
    const decodedToken = await auth.verifyIdToken(token);
    
    // Get user from database
    const user = await User.findOne({ firebaseUid: decodedToken.uid });
    
    if (!user) {
      throw createError('User not found', 404);
    }

    if (!user.isActive) {
      throw createError('Account is deactivated', 403);
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    req.firebaseUser = decodedToken;
    req.user = user;
    next();
  } catch (error: any) {
    if (error.code === 'auth/id-token-expired') {
      next(createError('Token expired', 401));
    } else if (error.code === 'auth/invalid-id-token') {
      next(createError('Invalid token', 401));
    } else {
      next(error);
    }
  }
};

// Middleware to check if user is admin (optional for future use)
export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    return next(createError('Authentication required', 401));
  }

  // Add admin check logic here when you implement admin roles
  // For now, we'll just pass through
  next();
};

// Optional auth middleware (doesn't throw error if no token)
export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    
    if (!token) {
      return next();
    }

    // Verify Firebase token
    const auth = getFirebaseAuth();
    const decodedToken = await auth.verifyIdToken(token);
    
    // Get user from database
    const user = await User.findOne({ firebaseUid: decodedToken.uid });
    
    if (user && user.isActive) {
      req.firebaseUser = decodedToken;
      req.user = user;
    }

    next();
  } catch (error) {
    // Ignore auth errors for optional auth
    next();
  }
};
