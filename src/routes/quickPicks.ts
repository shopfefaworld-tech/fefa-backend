import { Router, Request, Response } from 'express';
import QuickPick from '../models/QuickPick';
import { verifyToken, requireAdmin } from '../middleware/auth';
import { connectDB } from '../config/database';
import { uploadSingle, handleUploadError } from '../middleware/upload';
import { uploadImage } from '../config/cloudinary';

const router = Router();

// Public: get active quick picks
router.get('/', async (_req: Request, res: Response) => {
  try {
    await connectDB();
    const quickPicks = await QuickPick.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 });
    return res.json({ success: true, data: quickPicks });
  } catch (error: any) {
    console.error('Get quick picks error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch quick picks' });
  }
});

// Admin: list all quick picks
router.get('/all', verifyToken, requireAdmin, async (_req: Request, res: Response) => {
  try {
    await connectDB();
    const quickPicks = await QuickPick.find().sort({ sortOrder: 1, createdAt: -1 });
    return res.json({ success: true, data: quickPicks });
  } catch (error: any) {
    console.error('Get all quick picks error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch quick picks' });
  }
});

// Admin: create quick pick (with image upload to Cloudinary)
router.post(
  '/',
  verifyToken,
  requireAdmin,
  uploadSingle,
  handleUploadError,
  async (req: Request, res: Response) => {
    try {
      await connectDB();
      const quickPickData: any = req.body || {};

      // Handle image upload if a file is provided
      if (req.file) {
        try {
          const uploadResult = await uploadImage(req.file.buffer, {
            folder: 'fefa-jewelry/quick-picks',
            public_id: `quick-pick-${Date.now()}`,
          });

          quickPickData.image = uploadResult.secure_url;
        } catch (uploadError) {
          console.error('Quick pick image upload error:', uploadError);
          return res.status(500).json({
            success: false,
            message: 'Failed to upload quick pick image',
            error: uploadError instanceof Error ? uploadError.message : 'Unknown error',
          });
        }
      }

      const price = quickPickData.price !== undefined ? Number(quickPickData.price) : undefined;
      const comparePrice =
        quickPickData.comparePrice !== undefined ? Number(quickPickData.comparePrice) : undefined;

      if (!quickPickData.name || price === undefined || comparePrice === undefined || !quickPickData.image) {
        return res
          .status(400)
          .json({ success: false, message: 'name, price, comparePrice, and image are required' });
      }

      if (price > 200) {
        return res
          .status(400)
          .json({ success: false, message: 'Quick Pick price must be under ₹200' });
      }

      const quickPick = await QuickPick.create({
        name: quickPickData.name,
        price,
        comparePrice,
        image: quickPickData.image,
        productId: quickPickData.productId,
        isActive:
          typeof quickPickData.isActive === 'string'
            ? quickPickData.isActive === 'true'
            : quickPickData.isActive ?? true,
        sortOrder:
          quickPickData.sortOrder !== undefined ? Number(quickPickData.sortOrder) : 0,
      });

      return res.status(201).json({ success: true, data: quickPick });
    } catch (error: any) {
      console.error('Create quick pick error:', error);
      return res.status(500).json({ success: false, message: 'Failed to create quick pick' });
    }
  }
);

// Admin: update quick pick (with optional image upload)
router.put(
  '/:id',
  verifyToken,
  requireAdmin,
  uploadSingle,
  handleUploadError,
  async (req: Request, res: Response) => {
    try {
      await connectDB();
      const updateData: any = req.body || {};

      // Handle optional image upload
      if (req.file) {
        try {
          const uploadResult = await uploadImage(req.file.buffer, {
            folder: 'fefa-jewelry/quick-picks',
            public_id: `quick-pick-${req.params.id}-${Date.now()}`,
          });

          updateData.image = uploadResult.secure_url;
        } catch (uploadError) {
          console.error('Quick pick image upload error (update):', uploadError);
          return res.status(500).json({
            success: false,
            message: 'Failed to upload quick pick image',
            error: uploadError instanceof Error ? uploadError.message : 'Unknown error',
          });
        }
      }

      const price =
        updateData.price !== undefined ? Number(updateData.price) : undefined;
      if (price !== undefined && price > 200) {
        return res
          .status(400)
          .json({ success: false, message: 'Quick Pick price must be under ₹200' });
      }

      const updated = await QuickPick.findByIdAndUpdate(req.params.id, updateData, {
        new: true,
      });
      if (!updated) {
        return res.status(404).json({ success: false, message: 'Quick Pick not found' });
      }

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      console.error('Update quick pick error:', error);
      return res.status(500).json({ success: false, message: 'Failed to update quick pick' });
    }
  }
);

// Admin: delete quick pick
router.delete('/:id', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    await connectDB();
    const deleted = await QuickPick.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Quick Pick not found' });
    }
    return res.json({ success: true, message: 'Quick Pick deleted' });
  } catch (error: any) {
    console.error('Delete quick pick error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete quick pick' });
  }
});

// Admin: toggle active status
router.patch('/:id/toggle', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    await connectDB();
    const quickPick = await QuickPick.findById(req.params.id);
    if (!quickPick) {
      return res.status(404).json({ success: false, message: 'Quick Pick not found' });
    }
    quickPick.isActive = !quickPick.isActive;
    await quickPick.save();
    return res.json({ success: true, data: quickPick });
  } catch (error: any) {
    console.error('Toggle quick pick error:', error);
    return res.status(500).json({ success: false, message: 'Failed to toggle quick pick' });
  }
});

export default router;
