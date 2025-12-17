import mongoose from 'mongoose';

/**
 * Wait for MongoDB connection to be ready
 * This is important when bufferCommands is false
 */
export const waitForConnection = async (): Promise<void> => {
  // If already connected, return immediately
  if (mongoose.connection.readyState === 1) {
    return;
  }

  // If connecting, wait for it to complete
  if (mongoose.connection.readyState === 2) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('MongoDB connection timeout'));
      }, 10000); // 10 second timeout

      mongoose.connection.once('connected', () => {
        clearTimeout(timeout);
        resolve();
      });

      mongoose.connection.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  // If disconnected, need to connect first
  if (mongoose.connection.readyState === 0) {
    throw new Error('MongoDB not connected. Call connectDB() first.');
  }
};

export const connectDB = async (): Promise<void> => {
  try {
    // Check if already connected
    if (mongoose.connection.readyState === 1) {
      console.log('MongoDB already connected');
      return;
    }

    const mongoURI = process.env.MONGODB_URI;
    
    if (!mongoURI) {
      const error = new Error('MONGODB_URI is not defined in environment variables');
      console.error('MongoDB connection failed:', error.message);
      throw error;
    }

    const options = {
      maxPoolSize: 10, // Maintain up to 10 socket connections
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      bufferCommands: false, // Disable mongoose buffering
    };

    await mongoose.connect(mongoURI, options);
    
    // Ensure connection is fully established
    // readyState 1 = connected
    if (mongoose.connection.readyState !== 1) {
      throw new Error('MongoDB connection not fully established');
    }
    
    console.log('MongoDB connected successfully');
    
    // Handle connection events (only register once)
    if (!mongoose.connection.listeners('error').length) {
      mongoose.connection.on('error', (err) => {
        console.error('MongoDB connection error:', err);
      });

      mongoose.connection.on('disconnected', () => {
        console.log('MongoDB disconnected');
      });

      mongoose.connection.on('reconnected', () => {
        console.log('MongoDB reconnected');
      });
    }

  } catch (error) {
    console.error('MongoDB connection failed:', error);
    // Don't exit process in serverless - let it continue and retry on next request
    if (process.env.VERCEL || process.env.VERCEL_ENV) {
      // In serverless, just throw the error to be caught by caller
      throw error;
    } else {
      // Only exit in regular server mode
      process.exit(1);
    }
  }
};

export const disconnectDB = async (): Promise<void> => {
  try {
    await mongoose.connection.close();
    console.log('MongoDB disconnected gracefully');
  } catch (error) {
    console.error('Error disconnecting from MongoDB:', error);
  }
};
