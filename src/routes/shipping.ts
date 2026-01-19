import { Router, Request, Response } from 'express';

const router = Router();

// Simple configurable shipping calculation
const SHIPPING_CONFIG = {
  freeShippingThreshold: 1000,
  baseRate: 99,
  expressRate: 199,
};

router.post('/calculate', async (req: Request, res: Response) => {
  try {
    const { subtotal } = req.body;

    const useFreeShipping = typeof subtotal === 'number' && subtotal >= SHIPPING_CONFIG.freeShippingThreshold;

    const data = {
      standard: {
        cost: useFreeShipping ? 0 : SHIPPING_CONFIG.baseRate,
        days: '5-7 business days',
        label: useFreeShipping ? 'Free Shipping' : 'Standard Shipping',
      },
      express: {
        cost: SHIPPING_CONFIG.expressRate,
        days: '1-2 business days',
        label: 'Express Delivery',
      },
    };

    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('Shipping calculation error:', error);
    return res.status(500).json({ success: false, message: 'Failed to calculate shipping' });
  }
});

export default router;
