import { Router, Request, Response } from 'express';
import Wishlist, { IWishlist, IWishlistItem } from '../models/Wishlist';
import Product from '../models/Product';
import { verifyToken, AuthRequest } from '../middleware/auth';

const router = Router();

// Helper function to resolve variant data
const resolveVariantData = (wishlist: any) => {
  if (!wishlist || !wishlist.items) return wishlist;
  
  wishlist.items = wishlist.items.map((item: any) => {
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
  
  return wishlist;
};

// @route   GET /api/wishlist
// @desc    Get user wishlist
// @access  Private
router.get('/', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    
    let wishlist = await Wishlist.findOne({ user: userId })
      .populate('items.product', 'name price images slug variants ratings isActive')
      .lean();

    if (!wishlist) {
      // Create empty wishlist for user
      const newWishlist = await Wishlist.create({
        user: userId,
        items: []
      });
      wishlist = newWishlist.toObject() as any;
    }

    // Filter out inactive products
    if (wishlist && wishlist.items) {
      wishlist.items = wishlist.items.filter((item: any) => 
        item.product && item.product.isActive !== false
      );
    }

    res.json({
      success: true,
      data: resolveVariantData(wishlist)
    });
  } catch (error) {
    console.error('Error fetching wishlist:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch wishlist'
    });
  }
});

// @route   POST /api/wishlist
// @desc    Add item to wishlist
// @access  Private
router.post('/', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const { productId, variantId, notes } = req.body;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required'
      });
    }

    // Verify product exists and is active
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    if (!product.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Product is not available'
      });
    }

    // Verify variant exists if provided
    if (variantId && product.variants) {
      const variant = product.variants.find((v: any) => v._id.toString() === variantId);
      if (!variant) {
        return res.status(404).json({
          success: false,
          message: 'Product variant not found'
        });
      }
    }

    // Get or create wishlist
    let wishlist = await Wishlist.findOne({ user: userId });
    if (!wishlist) {
      wishlist = await Wishlist.create({
        user: userId,
        items: []
      });
    }

    // Check if item already exists
    const existingItem = wishlist.items.find((item: IWishlistItem) => 
      item.product.toString() === productId && 
      (!variantId || item.variant?.toString() === variantId)
    );

    if (existingItem) {
      return res.status(400).json({
        success: false,
        message: 'Item already in wishlist'
      });
    }

    // Add item to wishlist
    wishlist.items.push({
      product: productId as any,
      variant: variantId as any,
      addedAt: new Date(),
      notes: notes || undefined,
    });

    await wishlist.save();

    // Fetch updated wishlist with populated data
    const updatedWishlist = await Wishlist.findOne({ user: userId })
      .populate('items.product', 'name price images slug variants ratings isActive')
      .lean();

    return res.json({
      success: true,
      message: 'Item added to wishlist',
      data: resolveVariantData(updatedWishlist)
    });
  } catch (error) {
    console.error('Error adding to wishlist:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to add item to wishlist'
    });
  }
});

// @route   PUT /api/wishlist/:itemId
// @desc    Update wishlist item notes
// @access  Private
router.put('/:itemId', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const { itemId } = req.params;
    const { notes } = req.body;

    const wishlist = await Wishlist.findOne({ user: userId });
    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: 'Wishlist not found'
      });
    }

    // Find the item by product ID (since itemId is actually productId)
    const item = wishlist.items.find((item: IWishlistItem) => 
      item.product.toString() === itemId
    );

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found in wishlist'
      });
    }

    // Update notes
    item.notes = notes || undefined;
    
    await wishlist.save();

    // Fetch updated wishlist with populated data
    const updatedWishlist = await Wishlist.findOne({ user: userId })
      .populate('items.product', 'name price images slug variants ratings isActive')
      .lean();

    return res.json({
      success: true,
      message: 'Wishlist item updated',
      data: resolveVariantData(updatedWishlist)
    });
  } catch (error) {
    console.error('Error updating wishlist item:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update wishlist item'
    });
  }
});

// @route   DELETE /api/wishlist/:itemId
// @desc    Remove item from wishlist
// @access  Private
router.delete('/:itemId', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const { itemId } = req.params;

    const wishlist = await Wishlist.findOne({ user: userId });
    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: 'Wishlist not found'
      });
    }

    // Remove item (itemId is actually productId)
    const initialLength = wishlist.items.length;
    wishlist.items = wishlist.items.filter((item: IWishlistItem) => 
      !(item.product.toString() === itemId)
    );

    if (wishlist.items.length === initialLength) {
      return res.status(404).json({
        success: false,
        message: 'Item not found in wishlist'
      });
    }
    
    await wishlist.save();

    // Fetch updated wishlist with populated data
    const updatedWishlist = await Wishlist.findOne({ user: userId })
      .populate('items.product', 'name price images slug variants ratings isActive')
      .lean();

    return res.json({
      success: true,
      message: 'Item removed from wishlist',
      data: resolveVariantData(updatedWishlist)
    });
  } catch (error) {
    console.error('Error removing from wishlist:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to remove item from wishlist'
    });
  }
});

// @route   DELETE /api/wishlist
// @desc    Clear entire wishlist
// @access  Private
router.delete('/', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;

    const wishlist = await Wishlist.findOne({ user: userId });
    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: 'Wishlist not found'
      });
    }

    wishlist.items = [];
    await wishlist.save();

    return res.json({
      success: true,
      message: 'Wishlist cleared',
      data: {
        user: userId,
        items: []
      }
    });
  } catch (error) {
    console.error('Error clearing wishlist:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to clear wishlist'
    });
  }
});

// @route   POST /api/wishlist/:itemId/move-to-cart
// @desc    Move wishlist item to cart
// @access  Private
router.post('/:itemId/move-to-cart', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    const { itemId } = req.params;
    const { quantity = 1 } = req.body;

    // Import Cart here to avoid circular dependency
    const Cart = (await import('../models/Cart')).default;

    const wishlist = await Wishlist.findOne({ user: userId });
    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: 'Wishlist not found'
      });
    }

    // Find the item in wishlist
    const wishlistItem = wishlist.items.find((item: IWishlistItem) => 
      item.product.toString() === itemId
    );

    if (!wishlistItem) {
      return res.status(404).json({
        success: false,
        message: 'Item not found in wishlist'
      });
    }

    // Verify product still exists and is active
    const product = await Product.findById(wishlistItem.product);
    if (!product || !product.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Product is no longer available'
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
    if (wishlistItem.variant && product.variants) {
      const variant = product.variants.find((v: any) => v._id.toString() === wishlistItem.variant?.toString());
      if (variant) {
        price = variant.price;
      }
    }

    // Add item to cart
    const existingCartItem = cart.items.find((item: any) => 
      item.product.toString() === wishlistItem.product.toString() && 
      (!wishlistItem.variant || item.variant?.toString() === wishlistItem.variant.toString())
    );

    if (existingCartItem) {
      existingCartItem.quantity += quantity;
      existingCartItem.total = existingCartItem.quantity * existingCartItem.price;
    } else {
      cart.items.push({
        product: wishlistItem.product,
        variant: wishlistItem.variant,
        quantity,
        price,
        total: quantity * price,
        addedAt: new Date(),
      });
    }

    // Recalculate cart totals
    cart.subtotal = cart.items.reduce((sum, item) => sum + item.total, 0);
    cart.total = cart.subtotal + cart.tax + cart.shipping;
    
    await cart.save();

    // Remove item from wishlist
    wishlist.items = wishlist.items.filter((item: IWishlistItem) => 
      !(item.product.toString() === itemId)
    );
    await wishlist.save();

    // Fetch updated wishlist with populated data
    const updatedWishlist = await Wishlist.findOne({ user: userId })
      .populate('items.product', 'name price images slug variants ratings isActive')
      .lean();

    return res.json({
      success: true,
      message: 'Item moved to cart',
      data: resolveVariantData(updatedWishlist)
    });
  } catch (error) {
    console.error('Error moving item to cart:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to move item to cart'
    });
  }
});

export default router;
