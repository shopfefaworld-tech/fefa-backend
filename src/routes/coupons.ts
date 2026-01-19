import { Router, Request, Response } from 'express';
import Coupon from '../models/Coupon';
import { verifyToken, requireAdmin } from '../middleware/auth';
import { connectDB } from '../config/database';

const router = Router();

// Apply coupon (public)
router.post('/apply', async (req: Request, res: Response) => {
  try {
    await connectDB();
    const { code, orderTotal } = req.body;

    if (!code || orderTotal === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Coupon code and orderTotal are required'
      });
    }

    const coupon = await Coupon.findOne({ code: code.toUpperCase(), isActive: true });
    if (!coupon) {
      return res.status(400).json({ success: false, message: 'Invalid coupon code' });
    }

    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
      return res.status(400).json({ success: false, message: 'Coupon has expired' });
    }

    if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
      return res.status(400).json({ success: false, message: 'Coupon usage limit reached' });
    }

    if (orderTotal < coupon.minOrderAmount) {
      return res.status(400).json({
        success: false,
        message: `Minimum order amount is ₹${coupon.minOrderAmount}`
      });
    }

    let discount = coupon.discountType === 'percentage'
      ? (orderTotal * coupon.discountValue) / 100
      : coupon.discountValue;

    if (coupon.maxDiscount && discount > coupon.maxDiscount) {
      discount = coupon.maxDiscount;
    }

    return res.json({
      success: true,
      data: {
        discount,
        code: coupon.code,
        discountType: coupon.discountType,
        maxDiscount: coupon.maxDiscount,
      }
    });
  } catch (error: any) {
    console.error('Coupon apply error:', error);
    return res.status(500).json({ success: false, message: 'Failed to apply coupon' });
  }
});

// Admin: list coupons
router.get('/', verifyToken, requireAdmin, async (_req: Request, res: Response) => {
  try {
    await connectDB();
    const coupons = await Coupon.find().sort({ createdAt: -1 });
    return res.json({ success: true, data: coupons });
  } catch (error: any) {
    console.error('List coupons error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch coupons' });
  }
});

// Admin: create coupon
router.post('/', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    await connectDB();
    const {
      code,
      discountType,
      discountValue,
      minOrderAmount = 0,
      maxDiscount,
      usageLimit = 0,
      expiresAt,
      isActive = true,
    } = req.body;

    if (!code || !discountType || discountValue === undefined) {
      return res.status(400).json({ success: false, message: 'code, discountType, and discountValue are required' });
    }

    const coupon = await Coupon.create({
      code: code.toUpperCase(),
      discountType,
      discountValue,
      minOrderAmount,
      maxDiscount,
      usageLimit,
      usedCount: 0,
      expiresAt,
      isActive,
    });

    return res.status(201).json({ success: true, data: coupon });
  } catch (error: any) {
    console.error('Create coupon error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to create coupon' });
  }
});

// Admin: update coupon
router.put('/:id', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    await connectDB();
    const updated = await Coupon.findByIdAndUpdate(
      req.params.id,
      { ...req.body, code: req.body.code ? req.body.code.toUpperCase() : undefined },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }

    return res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('Update coupon error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update coupon' });
  }
});

// Admin: delete coupon
router.delete('/:id', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    await connectDB();
    const deleted = await Coupon.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }
    return res.json({ success: true, message: 'Coupon deleted' });
  } catch (error: any) {
    console.error('Delete coupon error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete coupon' });
  }
});

export default router;
