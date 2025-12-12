import Razorpay from 'razorpay';
import crypto from 'crypto';

let razorpayInstance: Razorpay | null = null;

export const initializeRazorpay = (): Razorpay => {
  if (razorpayInstance) {
    return razorpayInstance;
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error('Razorpay credentials are not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables.');
  }

  razorpayInstance = new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });

  console.log('✅ Razorpay initialized');
  return razorpayInstance;
};

export const getRazorpayInstance = (): Razorpay => {
  if (!razorpayInstance) {
    return initializeRazorpay();
  }
  return razorpayInstance;
};

/**
 * Verify Razorpay payment signature
 * @param orderId - Razorpay order ID
 * @param paymentId - Razorpay payment ID
 * @param signature - Razorpay signature
 * @returns boolean - true if signature is valid
 */
export const verifyPaymentSignature = (
  orderId: string,
  paymentId: string,
  signature: string
): boolean => {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  
  if (!keySecret) {
    throw new Error('RAZORPAY_KEY_SECRET is not configured');
  }

  const generatedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  return generatedSignature === signature;
};

/**
 * Generate Razorpay order
 * @param amount - Amount in paise (smallest currency unit)
 * @param currency - Currency code (default: INR)
 * @param receipt - Receipt identifier
 * @param notes - Additional notes
 * @returns Razorpay order object
 */
export const createRazorpayOrder = async (
  amount: number,
  receipt: string,
  notes?: Record<string, string>,
  currency: string = 'INR'
): Promise<any> => {
  const razorpay = getRazorpayInstance();

  const options = {
    amount: amount, // amount in paise
    currency: currency,
    receipt: receipt,
    notes: notes || {},
  };

  try {
    const order = await razorpay.orders.create(options);
    return order;
  } catch (error: any) {
    console.error('Error creating Razorpay order:', error);
    throw new Error(`Failed to create Razorpay order: ${error.message}`);
  }
};

