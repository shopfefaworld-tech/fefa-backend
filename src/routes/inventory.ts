import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { verifyToken, requireAdmin, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { connectDB } from '../config/database';
import Product from '../models/Product';
import Category from '../models/Category';
import StockMovement from '../models/StockMovement';

const router = Router();

const parseNumber = (value: any, fallback: number): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const parseBool = (value: any): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  return value.toLowerCase() === 'true' || value === '1';
};

const escapeCsv = (value: any): string => {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const extractImageUrl = (image: any): string => {
  if (!image) return '';
  if (typeof image === 'string') return image;
  if (typeof image.url === 'string') return image.url;
  return '';
};

const buildProductFilter = async (query: any) => {
  const filter: any = {};
  const andConditions: any[] = [];

  if (query.search) {
    const searchRegex = new RegExp(String(query.search), 'i');
    andConditions.push({
      $or: [
        { name: { $regex: searchRegex } },
        { sku: { $regex: searchRegex } },
        { description: { $regex: searchRegex } },
      ],
    });
  }

  if (query.category && query.category !== 'all') {
    const categoryValue = String(query.category).trim();

    if (mongoose.Types.ObjectId.isValid(categoryValue)) {
      filter.category = new mongoose.Types.ObjectId(categoryValue);
    } else {
      const categoryDoc = await Category.findOne({
        $or: [
          { name: { $regex: categoryValue, $options: 'i' } },
          { slug: categoryValue.toLowerCase() },
        ],
      })
        .select('_id')
        .lean();

      if (categoryDoc?._id) {
        filter.category = categoryDoc._id;
      }
    }
  }

  if (parseBool(query.lowStock)) {
    andConditions.push({
      $expr: {
        $lte: [
          { $ifNull: ['$inventory.quantity', 0] },
          { $ifNull: ['$inventory.lowStockThreshold', 0] },
        ],
      },
    });
  }

  if (andConditions.length > 0) {
    filter.$and = andConditions;
  }

  return filter;
};

// @route   GET /api/inventory/items
// @desc    Get inventory items with filters
// @access  Private/Admin
router.get('/items', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();

    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '20'), 10)));
    const sortBy = String(req.query.sortBy || 'updatedAt');
    const sortOrder = String(req.query.sortOrder || 'desc') === 'asc' ? 1 : -1;

    const sort: any = {};
    sort[sortBy] = sortOrder;

    const filter = await buildProductFilter(req.query);
    const skip = (page - 1) * limit;

    const [products, totalItems] = await Promise.all([
      Product.find(filter)
        .populate('category', 'name slug')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter),
    ]);

    const data = products.map((product: any) => {
      const quantity = product.inventory?.quantity ?? 0;
      const lowStockThreshold = product.inventory?.lowStockThreshold ?? 0;
      const purchasePrice = product.costPrice ?? 0;
      const salesPrice = product.price ?? 0;
      const stockValue = quantity * purchasePrice;
      const stockStatus =
        quantity <= 0
          ? 'out_of_stock'
          : quantity <= lowStockThreshold
          ? 'low_stock'
          : 'in_stock';

      return {
        _id: product._id,
        name: product.name,
        sku: product.sku,
        category: product.category,
        image: product.images?.[0]?.url || '',
        quantity,
        unit: 'PCS',
        purchasePrice,
        salesPrice,
        mrp: product.comparePrice || null,
        lowStockThreshold,
        stockValue,
        stockStatus,
        isActive: product.isActive !== false,
        updatedAt: product.updatedAt,
      };
    });

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        currentPage: page,
        totalPages: Math.max(1, Math.ceil(totalItems / limit)),
        totalItems,
        hasNextPage: skip + limit < totalItems,
        hasPrevPage: page > 1,
      },
    });
  } catch (error: any) {
    return next(createError(error.message || 'Failed to fetch inventory items', 500));
  }
});

// @route   GET /api/inventory/summary
// @desc    Get stock summary totals and list
// @access  Private/Admin
router.get('/summary', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();

    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit || '100'), 10)));
    const filter = await buildProductFilter(req.query);
    const skip = (page - 1) * limit;

    const [products, totalItems] = await Promise.all([
      Product.find(filter)
        .populate('category', 'name slug')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter),
    ]);

    let totalQuantity = 0;
    let totalStockValue = 0;
    let lowStockItems = 0;

    const rows = products.map((product: any) => {
      const quantity = product.inventory?.quantity ?? 0;
      const lowStockThreshold = product.inventory?.lowStockThreshold ?? 0;
      const purchasePrice = product.costPrice ?? 0;
      const value = quantity * purchasePrice;

      totalQuantity += quantity;
      totalStockValue += value;
      if (quantity <= lowStockThreshold) lowStockItems += 1;

      return {
        _id: product._id,
        itemCode: product.sku,
        itemName: product.name,
        category: product.category,
        quantity,
        unit: 'PCS',
        value,
        lowStockThreshold,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        totals: {
          totalItems,
          totalQuantity,
          totalStockValue,
          lowStockItems,
        },
        rows,
      },
      pagination: {
        currentPage: page,
        totalPages: Math.max(1, Math.ceil(totalItems / limit)),
        totalItems,
        hasNextPage: skip + limit < totalItems,
        hasPrevPage: page > 1,
      },
    });
  } catch (error: any) {
    return next(createError(error.message || 'Failed to fetch stock summary', 500));
  }
});

// @route   GET /api/inventory/items/:id
// @desc    Get inventory item with timeline
// @access  Private/Admin
router.get('/items/:id', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();

    const { id } = req.params;
    const product = await Product.findById(id)
      .populate('category', 'name slug')
      .populate('collections', 'name slug')
      .lean();

    if (!product) {
      return next(createError('Product not found', 404));
    }

    const movements = await StockMovement.find({ product: product._id })
      .sort({ movementDate: -1, createdAt: -1 })
      .limit(200)
      .lean();

    const quantity = product.inventory?.quantity ?? 0;
    const purchasePrice = product.costPrice ?? 0;
    const salesPrice = product.price ?? 0;
    const stockValue = quantity * purchasePrice;

    return res.status(200).json({
      success: true,
      data: {
        product: {
          ...product,
          quantity,
          stockValue,
          purchasePrice,
          salesPrice,
          mrp: product.comparePrice || null,
        },
        timeline: movements,
      },
    });
  } catch (error: any) {
    return next(createError(error.message || 'Failed to fetch inventory item', 500));
  }
});

// @route   POST /api/inventory/adjust
// @desc    Adjust stock for one item
// @access  Private/Admin
router.post('/adjust', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();

    const {
      productId,
      mode = 'add',
      quantity,
      note = '',
      movementDate,
      referenceId,
      type = 'adjustment',
    } = req.body;

    if (!productId || quantity === undefined || quantity === null) {
      return next(createError('productId and quantity are required', 400));
    }

    const product = await Product.findById(productId);
    if (!product) {
      return next(createError('Product not found', 404));
    }

    const previousQuantity = product.inventory?.quantity ?? 0;
    const parsedQty = parseNumber(quantity, NaN);
    if (!Number.isFinite(parsedQty)) {
      return next(createError('Invalid quantity', 400));
    }

    let newQuantity = previousQuantity;
    let quantityChange = 0;

    if (mode === 'set') {
      newQuantity = Math.max(0, Math.round(parsedQty));
      quantityChange = newQuantity - previousQuantity;
    } else {
      quantityChange = Math.round(parsedQty);
      newQuantity = Math.max(0, previousQuantity + quantityChange);
      quantityChange = newQuantity - previousQuantity;
    }

    product.inventory.quantity = newQuantity;
    await product.save();

    const movement = await StockMovement.create({
      product: product._id,
      type,
      quantityChange,
      previousQuantity,
      newQuantity,
      unit: 'PCS',
      note,
      referenceType: 'manual',
      referenceId: referenceId || undefined,
      movementDate: movementDate ? new Date(movementDate) : new Date(),
      createdBy: req.user?._id,
    });

    return res.status(200).json({
      success: true,
      data: {
        productId: product._id,
        previousQuantity,
        newQuantity,
        quantityChange,
        movement,
      },
      message: 'Stock adjusted successfully',
    });
  } catch (error: any) {
    return next(createError(error.message || 'Failed to adjust stock', 500));
  }
});

// @route   POST /api/inventory/bulk
// @desc    Bulk stock updates
// @access  Private/Admin
router.post('/bulk', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();

    const { adjustments = [], note = '' } = req.body;
    if (!Array.isArray(adjustments) || adjustments.length === 0) {
      return next(createError('adjustments array is required', 400));
    }

    const results: any[] = [];

    for (const adjustment of adjustments) {
      const { productId, mode = 'add', quantity, itemNote = '' } = adjustment || {};
      if (!productId || quantity === undefined || quantity === null) {
        results.push({ productId, success: false, error: 'Invalid payload' });
        continue;
      }

      const product = await Product.findById(productId);
      if (!product) {
        results.push({ productId, success: false, error: 'Product not found' });
        continue;
      }

      const previousQuantity = product.inventory?.quantity ?? 0;
      const parsedQty = parseNumber(quantity, NaN);
      if (!Number.isFinite(parsedQty)) {
        results.push({ productId, success: false, error: 'Invalid quantity' });
        continue;
      }

      let newQuantity = previousQuantity;
      let quantityChange = 0;

      if (mode === 'set') {
        newQuantity = Math.max(0, Math.round(parsedQty));
        quantityChange = newQuantity - previousQuantity;
      } else {
        quantityChange = Math.round(parsedQty);
        newQuantity = Math.max(0, previousQuantity + quantityChange);
        quantityChange = newQuantity - previousQuantity;
      }

      product.inventory.quantity = newQuantity;
      await product.save();

      await StockMovement.create({
        product: product._id,
        type: 'bulk_update',
        quantityChange,
        previousQuantity,
        newQuantity,
        unit: 'PCS',
        note: itemNote || note || 'Bulk stock update',
        referenceType: 'bulk',
        referenceId: `bulk-${Date.now()}`,
        createdBy: req.user?._id,
        movementDate: new Date(),
      });

      results.push({
        productId,
        success: true,
        previousQuantity,
        newQuantity,
        quantityChange,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        total: results.length,
        successful: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        results,
      },
      message: 'Bulk stock update completed',
    });
  } catch (error: any) {
    return next(createError(error.message || 'Failed to apply bulk stock update', 500));
  }
});

// @route   GET /api/inventory/export
// @desc    Export stock summary as CSV (with image URLs for Shopify/import workflows)
// @access  Private/Admin
router.get('/export', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();

    const filter = await buildProductFilter(req.query);
    const products = await Product.find(filter)
      .populate('category', 'name')
      .sort({ updatedAt: -1 })
      .lean();

    const header = [
      'Item Code',
      'Item Name',
      'Category',
      'Image Src',
      'Primary Image URL',
      'Additional Image URLs',
      'All Image URLs',
      'Quantity',
      'Unit',
      'Sales Price',
      'Purchase Price',
      'Low Stock Threshold',
      'Stock Value',
      'Status',
    ];

    const rows = products.map((product: any) => {
      const quantity = product.inventory?.quantity ?? 0;
      const lowStockThreshold = product.inventory?.lowStockThreshold ?? 0;
      const purchasePrice = product.costPrice ?? 0;
      const salesPrice = product.price ?? 0;
      const stockValue = quantity * purchasePrice;
      const status =
        quantity <= 0 ? 'Out of Stock' : quantity <= lowStockThreshold ? 'Low Stock' : 'In Stock';
      const imageUrls = Array.isArray(product.images)
        ? product.images.map((img: any) => extractImageUrl(img)).filter(Boolean)
        : [];
      const primaryImage =
        extractImageUrl(product.images?.find((img: any) => img?.isPrimary)) || imageUrls[0] || '';
      const additionalImages = imageUrls.filter((url: string) => url !== primaryImage).join(', ');

      return [
        product.sku || '',
        product.name || '',
        product.category?.name || 'Uncategorized',
        primaryImage,
        primaryImage,
        additionalImages,
        imageUrls.join(', '),
        quantity,
        'PCS',
        salesPrice,
        purchasePrice,
        lowStockThreshold,
        stockValue,
        status,
      ];
    });

    const csv =
      [header, ...rows]
        .map((row) => row.map((cell) => escapeCsv(cell)).join(','))
        .join('\n') + '\n';

    const datePart = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="stock-summary-${datePart}.csv"`);
    return res.status(200).send(csv);
  } catch (error: any) {
    return next(createError(error.message || 'Failed to export stock summary', 500));
  }
});

export default router;
