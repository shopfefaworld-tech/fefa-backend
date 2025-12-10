import { Router, Request, Response } from 'express';
import Cart, { ICart, ICartItem } from '../models/Cart';
import Product from '../models/Product';
import { verifyToken, AuthRequest } from '../middleware/auth';

const router = Router();

// Helper function to resolve variant data
const resolveVariantData = (cart: any) => {
  if (!cart || !cart.items) return cart;
  
  cart.items = cart.items.map((item: any) => {
    if (item.variant && item.product && item.product.variants) {
      const variant = item.product.variants.find((v: any) => 
        v._id.toString() === item.variant.toString()
      );
      if (variant) {
        item.variant = {
          _id: variant._id,
          name: variant.name,
          price: variant.price,
          sku: variant.sku
        };
      }
    }
    return item;
  });
  
  return cart;
};

// @route   GET /api/cart
// @desc    Get user cart
// @access  Private
router.get('/', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    
    let cart = await Cart.findOne({ user: userId })
      .populate('items.product', 'name price images slug variants')
      .lean();

    if (!cart) {
      // Create empty cart for user
      const newCart = await Cart.create({
        user: userId,
        items: [],
        subtotal: 0,
        tax: 0,
        shipping: 0,
        total: 0,
        currency: 'INR'
      });
      cart = newCart.toObject() as any;
    }

    res.json({
      success: true,
      data: resolveVariantData(cart)
    });
  } catch (error) {
    console.error('Error fetching cart:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cart'
    });
  }
});

// @route   POST /api/cart
// @desc    Add item to cart
// @access  Private
router.post('/', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const { productId, quantity = 1, variantId } = req.body;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required'
      });
    }

    // Verify product exists
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Get or create cart
    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
      cart = await Cart.create({
        user: userId,
        items: [],
        subtotal: 0,
        tax: 0,
        shipping: 0,
        total: 0,
        currency: 'INR'
      });
    }

    // Determine price (variant price or product price)
    let price = product.price;
    if (variantId && product.variants) {
      const variant = product.variants.find((v: any) => v._id.toString() === variantId);
      if (variant) {
        price = variant.price;
      }
    }

    // Add item to cart using the method
    const existingItem = cart.items.find((item: ICartItem) => 
      item.product.toString() === productId && 
      (!variantId || item.variant?.toString() === variantId)
    );

    if (existingItem) {
      existingItem.quantity += quantity;
      existingItem.total = existingItem.quantity * existingItem.price;
    } else {
      cart.items.push({
        product: productId as any,
        variant: variantId as any,
        quantity,
        price,
        total: quantity * price,
        addedAt: new Date(),
      });
    }

    // Recalculate totals
    cart.subtotal = cart.items.reduce((sum, item) => sum + item.total, 0);
    cart.total = cart.subtotal + cart.tax + cart.shipping;
    
    await cart.save();

    // Fetch updated cart with populated data
    const updatedCart = await Cart.findOne({ user: userId })
      .populate('items.product', 'name price images slug variants')
      .lean();

    return res.json({
      success: true,
      message: 'Item added to cart',
      data: resolveVariantData(updatedCart)
    });
  } catch (error) {
    console.error('Error adding to cart:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to add item to cart'
    });
  }
});

// @route   PUT /api/cart/:itemId
// @desc    Update cart item quantity
// @access  Private
router.put('/:itemId', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const { itemId } = req.params;
    const { quantity } = req.body;

    if (!quantity || quantity < 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid quantity is required'
      });
    }

    const cart = await Cart.findOne({ user: userId });
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    // Find the item by product ID (since itemId is actually productId)
    const item = cart.items.find((item: ICartItem) => 
      item.product.toString() === itemId
    );

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found in cart'
      });
    }

    // Update quantity
    if (quantity <= 0) {
      cart.items = cart.items.filter((item: ICartItem) => 
        !(item.product.toString() === itemId)
      );
    } else {
      item.quantity = quantity;
      item.total = item.quantity * item.price;
    }

    // Recalculate totals
    cart.subtotal = cart.items.reduce((sum, item) => sum + item.total, 0);
    cart.total = cart.subtotal + cart.tax + cart.shipping;
    
    await cart.save();

    // Fetch updated cart with populated data
    const updatedCart = await Cart.findOne({ user: userId })
      .populate('items.product', 'name price images slug variants')
      .lean();

    return res.json({
      success: true,
      message: 'Cart updated',
      data: resolveVariantData(updatedCart)
    });
  } catch (error) {
    console.error('Error updating cart:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update cart'
    });
  }
});

// @route   DELETE /api/cart/:itemId
// @desc    Remove item from cart
// @access  Private
router.delete('/:itemId', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const { itemId } = req.params;

    const cart = await Cart.findOne({ user: userId });
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    // Remove item (itemId is actually productId)
    cart.items = cart.items.filter((item: ICartItem) => 
      !(item.product.toString() === itemId)
    );

    // Recalculate totals
    cart.subtotal = cart.items.reduce((sum, item) => sum + item.total, 0);
    cart.total = cart.subtotal + cart.tax + cart.shipping;
    
    await cart.save();

    // Fetch updated cart with populated data
    const updatedCart = await Cart.findOne({ user: userId })
      .populate('items.product', 'name price images slug variants')
      .lean();

    return res.json({
      success: true,
      message: 'Item removed from cart',
      data: resolveVariantData(updatedCart)
    });
  } catch (error) {
    console.error('Error removing from cart:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to remove item from cart'
    });
  }
});

// @route   DELETE /api/cart
// @desc    Clear entire cart
// @access  Private
router.delete('/', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;

    const cart = await Cart.findOne({ user: userId });
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    cart.items = [];
    cart.subtotal = 0;
    cart.tax = 0;
    cart.shipping = 0;
    cart.total = 0;
    
    await cart.save();

    return res.json({
      success: true,
      message: 'Cart cleared',
      data: {
        user: userId,
        items: [],
        subtotal: 0,
        tax: 0,
        shipping: 0,
        total: 0,
        currency: 'INR'
      }
    });
  } catch (error) {
    console.error('Error clearing cart:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to clear cart'
    });
  }
});

export default router;
