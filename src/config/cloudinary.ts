import { v2 as cloudinary } from 'cloudinary';

let cloudinaryInitialized = false;

export const initializeCloudinary = (): void => {
  try {
    if (cloudinaryInitialized) {
      return;
    }

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });

    cloudinaryInitialized = true;
  } catch (error) {
    console.error('Cloudinary initialization failed:', error);
    throw error;
  }
};

export const getCloudinary = () => {
  if (!cloudinaryInitialized) {
    throw new Error('Cloudinary not initialized. Call initializeCloudinary() first.');
  }
  return cloudinary;
};

// Helper function to upload image from buffer
export const uploadImage = async (
  file: Buffer | string,
  options: {
    folder?: string;
    public_id?: string;
    transformation?: any;
    resource_type?: 'image' | 'video' | 'raw' | 'auto';
  } = {}
): Promise<{ secure_url: string; public_id: string }> => {
  const cloudinaryInstance = getCloudinary();
  
  const defaultOptions = {
    folder: 'fefa-jewelry',
    resource_type: 'image' as const,
    ...options,
  };

  try {
    let uploadOptions = defaultOptions;
    
    // If file is a buffer, convert it to data URI
    if (Buffer.isBuffer(file)) {
      const dataUri = `data:image/jpeg;base64,${file.toString('base64')}`;
      const result = await cloudinaryInstance.uploader.upload(dataUri, uploadOptions);
      return {
        secure_url: result.secure_url,
        public_id: result.public_id,
      };
    } else {
      // If file is a string (URL or data URI), upload directly
      const result = await cloudinaryInstance.uploader.upload(file, uploadOptions);
      return {
        secure_url: result.secure_url,
        public_id: result.public_id,
      };
    }
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw new Error('Failed to upload image to Cloudinary');
  }
};

// Helper function to delete image
export const deleteImage = async (publicId: string, options?: { folder?: string }): Promise<void> => {
  const cloudinaryInstance = getCloudinary();
  
  if (!publicId || publicId.trim() === '') {
    throw new Error('PublicId is required for deletion');
  }
  
  // Use the publicId as-is if it already contains the full path
  let fullPublicId = publicId;
  
  // Only prepend folder if publicId doesn't contain any slashes (meaning it's just the filename)
  if (!fullPublicId.includes('/')) {
    const folder = options?.folder || 'fefa-jewelry/products';
    fullPublicId = `${folder}/${fullPublicId}`;
  }
  
  try {
    const result = await cloudinaryInstance.uploader.destroy(fullPublicId);
    
    // Check if deletion was successful
    if (result.result === 'not found') {
      // Try without folder prefix as fallback
      if (fullPublicId.includes('/')) {
        const withoutFolder = fullPublicId.split('/').pop();
        const fallbackResult = await cloudinaryInstance.uploader.destroy(withoutFolder!);
        if (fallbackResult.result === 'ok') {
          return;
        }
      }
      // Don't throw error - image might already be deleted
    } else if (result.result !== 'ok') {
      throw new Error(`Cloudinary returned unexpected result: ${result.result}`);
    }
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    throw new Error(`Failed to delete image from Cloudinary: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

// Helper function to generate optimized image URL
export const getOptimizedImageUrl = (
  publicId: string,
  options: {
    width?: number;
    height?: number;
    quality?: string | number;
    format?: string;
    transformation?: any;
  } = {}
): string => {
  const cloudinaryInstance = getCloudinary();
  
  const defaultOptions = {
    quality: 'auto',
    format: 'auto',
    ...options,
  };

  return cloudinaryInstance.url(publicId, defaultOptions);
};
