import { Router, Request, Response } from 'express';
import GiftOption from '../models/GiftOption';
import { verifyToken, requireAdmin } from '../middleware/auth';
import { connectDB } from '../config/database';

const router = Router();

// Public: get active gift options
router.get('/', async (_req: Request, res: Response) => {
  try {
    await connectDB();
    const gifts = await GiftOption.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 });
    return res.json({ success: true, data: gifts });
  } catch (error: any) {
    console.error('Get gifts error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch gift options' });
  }
});

// Admin: list all gift options
router.get('/all', verifyToken, requireAdmin, async (_req: Request, res: Response) => {
  try {
    await connectDB();
    const gifts = await GiftOption.find().sort({ sortOrder: 1, createdAt: -1 });
    return res.json({ success: true, data: gifts });
  } catch (error: any) {
    console.error('List gifts error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch gifts' });
  }
});

// Admin: create gift option
router.post('/', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    await connectDB();
    const { name, description, price, image, isActive = true, sortOrder = 0 } = req.body;

    if (!name || !description || price === undefined || !image) {
      return res.status(400).json({ success: false, message: 'name, description, price, and image are required' });
    }

    const gift = await GiftOption.create({
      name,
      description,
      price,
      image,
      isActive,
      sortOrder,
    });

    return res.status(201).json({ success: true, data: gift });
  } catch (error: any) {
    console.error('Create gift option error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create gift option' });
  }
});

// Admin: update gift option
router.put('/:id', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    await connectDB();
    const updated = await GiftOption.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Gift option not found' });
    }
    return res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('Update gift option error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update gift option' });
  }
});

// Admin: delete gift option
router.delete('/:id', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    await connectDB();
    const deleted = await GiftOption.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Gift option not found' });
    }
    return res.json({ success: true, message: 'Gift option deleted' });
  } catch (error: any) {
    console.error('Delete gift option error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete gift option' });
  }
});

// Admin: toggle gift option
router.patch('/:id/toggle', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    await connectDB();
    const gift = await GiftOption.findById(req.params.id);
    if (!gift) {
      return res.status(404).json({ success: false, message: 'Gift option not found' });
    }
    gift.isActive = !gift.isActive;
    await gift.save();
    return res.json({ success: true, data: gift });
  } catch (error: any) {
    console.error('Toggle gift option error:', error);
    return res.status(500).json({ success: false, message: 'Failed to toggle gift option' });
  }
});

export default router;
