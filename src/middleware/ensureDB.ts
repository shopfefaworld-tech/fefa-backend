import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { connectDB } from '../config/database';
import { createError } from './errorHandler';

/**
 * Middleware to ensure MongoDB connection before handling requests
 * This is critical for serverless environments where connection might not be ready
 * readyState values: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
 */
export const ensureDB = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Check if already connected (readyState === 1)
    if (mongoose.connection.readyState === 1) {
      return next();
    }

    // If connecting (readyState === 2), wait for it
    const currentState = mongoose.connection.readyState;
    if (currentState === 2) {
      // Wait for connection to complete (with timeout)
      await Promise.race([
        new Promise<void>((resolve) => {
          const checkConnection = () => {
            const state: number = mongoose.connection.readyState as number;
            if (state === 1) {
              // Connected
              resolve();
            } else if (state === 0 || state === 99) {
              // Disconnected or uninitialized, try to reconnect
              connectDB()
                .then(() => resolve())
                .catch(() => resolve()); // Continue anyway
            } else {
              // Still connecting (state === 2), check again
              setTimeout(checkConnection, 100);
            }
          };
          checkConnection();
        }),
        new Promise<void>((resolve) => 
          setTimeout(() => resolve(), 5000) // 5 second timeout
        )
      ]);
      
      // Check final state
      const finalState: number = mongoose.connection.readyState as number;
      if (finalState === 1) {
        return next();
      }
    }

    // Not connected, try to connect
    try {
      await Promise.race([
        connectDB(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 8000)
        )
      ]);
      
      // Check if connection succeeded
      const connectionState: number = mongoose.connection.readyState as number;
      if (connectionState === 1) {
        return next();
      }
    } catch (error) {
      console.error('Database connection failed in ensureDB middleware:', error);
      // Continue anyway - buffering might handle it if enabled
    }

    // If we get here, connection failed but we'll continue
    // With bufferCommands enabled in serverless, Mongoose will buffer commands
    return next();
  } catch (error) {
    console.error('ensureDB middleware error:', error);
    return next(createError('Database connection error', 503));
  }
};

