import { Router, Request, Response } from 'express';
import QuickPick from '../models/QuickPick';
import { verifyToken, requireAdmin } from '../middleware/auth';
import { connectDB } from '../config/database';

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

// Admin: create quick pick
router.post('/', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    await connectDB();
    const { name, price, comparePrice, image, productId, isActive = true, sortOrder = 0 } = req.body;

    if (!name || price === undefined || comparePrice === undefined || !image) {
      return res.status(400).json({ success: false, message: 'name, price, comparePrice, and image are required' });
    }

    if (price > 200) {
      return res.status(400).json({ success: false, message: 'Quick Pick price must be under ₹200' });
    }

    const quickPick = await QuickPick.create({
      name,
      price,
      comparePrice,
      image,
      productId,
      isActive,
      sortOrder,
    });

    return res.status(201).json({ success: true, data: quickPick });
  } catch (error: any) {
    console.error('Create quick pick error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create quick pick' });
  }
});

// Admin: update quick pick
router.put('/:id', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    await connectDB();
    const { price } = req.body;
    if (price !== undefined && price > 200) {
      return res.status(400).json({ success: false, message: 'Quick Pick price must be under ₹200' });
    }

    const updated = await QuickPick.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Quick Pick not found' });
    }

    return res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('Update quick pick error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update quick pick' });
  }
});

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
