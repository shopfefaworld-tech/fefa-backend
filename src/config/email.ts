import nodemailer from 'nodemailer';

// Email transporter configuration
const createTransporter = () => {
  // Use environment variables for email configuration
  // For Gmail, you can use App Password: https://support.google.com/accounts/answer/185833
  
  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = parseInt(process.env.SMTP_PORT || '587');
  const smtpUser = process.env.SMTP_USER || process.env.SMTP_USERNAME;
  const smtpPassword = process.env.SMTP_PASSWORD;

  // Validate required configuration
  if (!smtpUser || !smtpPassword) {
    throw new Error('SMTP_USER and SMTP_PASSWORD must be set in environment variables');
  }

  console.log('Creating email transporter with:', {
    host: smtpHost,
    port: smtpPort,
    user: smtpUser,
    passwordSet: !!smtpPassword,
  });

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: smtpUser,
      pass: smtpPassword,
    },
  });

  return transporter;
};

// Send email OTP
export const sendEmailOTP = async (email: string, otp: string): Promise<void> => {
  const transporter = createTransporter();
  
  const fromName = process.env.EMAIL_FROM_NAME || 'FEFA Jewelry';
  const fromEmail = process.env.EMAIL_FROM || process.env.SMTP_USER || 'noreply@fefajewelry.com';

  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to: email,
    subject: 'Your FEFA Jewelry Verification Code',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verification Code</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
          <table role="presentation" style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 20px 0; text-align: center; background-color: #ffffff;">
                <h1 style="color: #3B82F6; margin: 0;">FEFA Jewelry</h1>
              </td>
            </tr>
            <tr>
              <td style="padding: 40px 20px; background-color: #f4f4f4;">
                <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  <tr>
                    <td>
                      <h2 style="color: #1F2937; margin: 0 0 20px 0;">Your Verification Code</h2>
                      <p style="color: #4B5563; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
                        Hello,
                      </p>
                      <p style="color: #4B5563; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                        We received a request to sign in to your FEFA Jewelry account. Use the verification code below to complete your sign-in:
                      </p>
                      <div style="background-color: #F3F4F6; border: 2px dashed #9CA3AF; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0;">
                        <p style="font-size: 32px; font-weight: bold; color: #1F2937; letter-spacing: 8px; margin: 0; font-family: 'Courier New', monospace;">
                          ${otp}
                        </p>
                      </div>
                      <p style="color: #4B5563; font-size: 14px; line-height: 1.6; margin: 20px 0 0 0;">
                        This code will expire in <strong>10 minutes</strong>. If you didn't request this code, you can safely ignore this email.
                      </p>
                      <p style="color: #6B7280; font-size: 12px; line-height: 1.6; margin: 30px 0 0 0; border-top: 1px solid #E5E7EB; padding-top: 20px;">
                        For security reasons, never share this code with anyone. FEFA Jewelry will never ask for your verification code.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 20px; text-align: center; background-color: #ffffff;">
                <p style="color: #6B7280; font-size: 12px; margin: 0;">
                  © ${new Date().getFullYear()} FEFA Jewelry. All rights reserved.
                </p>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
    text: `
      FEFA Jewelry - Verification Code
      
      Hello,
      
      We received a request to sign in to your FEFA Jewelry account. Use the verification code below to complete your sign-in:
      
      ${otp}
      
      This code will expire in 10 minutes. If you didn't request this code, you can safely ignore this email.
      
      For security reasons, never share this code with anyone. FEFA Jewelry will never ask for your verification code.
      
      © ${new Date().getFullYear()} FEFA Jewelry. All rights reserved.
    `,
  };

  try {
    // Verify connection first
    await transporter.verify();
    console.log('SMTP connection verified successfully');
    
    // Send email
    const info = await transporter.sendMail(mailOptions);
    console.log(`Email OTP sent successfully to ${email}`, {
      messageId: info.messageId,
      response: info.response,
    });
  } catch (error: any) {
    console.error('Error sending email OTP:', error);
    console.error('Error details:', {
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode,
    });
    
    // Provide more specific error messages
    if (error.code === 'EAUTH') {
      throw new Error('SMTP authentication failed. Please check your SMTP_USER and SMTP_PASSWORD in .env file.');
    } else if (error.code === 'ECONNECTION') {
      throw new Error('Could not connect to SMTP server. Please check SMTP_HOST and SMTP_PORT in .env file.');
    } else if (error.code === 'ETIMEDOUT') {
      throw new Error('SMTP connection timed out. Please check your network connection and SMTP settings.');
    } else {
      throw new Error(`Failed to send email: ${error.message || 'Unknown error'}`);
    }
  }
};

// Verify email transporter connection
export const verifyEmailConnection = async (): Promise<boolean> => {
  try {
    const transporter = createTransporter();
    await transporter.verify();
    console.log('Email server connection verified successfully');
    return true;
  } catch (error) {
    console.error('Email server connection failed:', error);
    return false;
  }
};

// Send order confirmation email
export const sendOrderConfirmationEmail = async (
  email: string,
  order: {
    orderNumber: string;
    items: Array<{ name: string; quantity: number; price: number; total: number }>;
    pricing: { subtotal: number; shipping: number; discount?: number; total: number };
    shippingAddress: any;
  }
): Promise<void> => {
  const transporter = createTransporter();

  const itemsHtml = (order.items || [])
    .map(
      (item) => `
        <tr>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;">${item.name}</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;text-align:center;">${item.quantity}</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;text-align:right;">₹${item.price}</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;text-align:right;">₹${item.total}</td>
        </tr>
      `
    )
    .join('');

  const address = order.shippingAddress;
  const addressHtml = address
    ? `
      <p style="margin:0;">${address.firstName || ''} ${address.lastName || ''}</p>
      <p style="margin:0;">${address.addressLine1 || address.address || ''}</p>
      ${address.addressLine2 ? `<p style="margin:0;">${address.addressLine2}</p>` : ''}
      <p style="margin:0;">${address.city || ''}, ${address.state || ''} ${address.postalCode || ''}</p>
      <p style="margin:0;">${address.country || ''}</p>
    `
    : '';

  const discount = order.pricing.discount || 0;

  const mailOptions = {
    from: `"FEFA Jewelry" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
    to: email,
    subject: `Order Confirmed - #${order.orderNumber}`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
        <h2 style="color:#d4a574;">Thank you for your order!</h2>
        <p>Your order <strong>#${order.orderNumber}</strong> has been confirmed.</p>
        <h3 style="margin-top:20px;">Items</h3>
        <table style="border-collapse: collapse; width:100%; font-size:14px;">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px 12px;border:1px solid #e5e7eb;">Item</th>
              <th style="text-align:center;padding:8px 12px;border:1px solid #e5e7eb;">Qty</th>
              <th style="text-align:right;padding:8px 12px;border:1px solid #e5e7eb;">Price</th>
              <th style="text-align:right;padding:8px 12px;border:1px solid #e5e7eb;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <h3 style="margin-top:20px;">Summary</h3>
        <p style="margin:0;">Subtotal: ₹${order.pricing.subtotal}</p>
        ${discount > 0 ? `<p style="margin:0;">Discount: -₹${discount}</p>` : ''}
        <p style="margin:0;">Shipping: ₹${order.pricing.shipping}</p>
        <p style="margin:4px 0 0 0;"><strong>Total: ₹${order.pricing.total}</strong></p>

        <h3 style="margin-top:20px;">Shipping Address</h3>
        ${addressHtml}

        <p style="margin-top:24px;">We will notify you when your order ships.</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

// Common email header template
const getEmailHeader = () => `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
      <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 20px 0; text-align: center; background-color: #d4a574;">
            <h1 style="color: #ffffff; margin: 0; font-size: 28px;">FEFA Jewelry</h1>
          </td>
        </tr>
        <tr>
          <td style="padding: 40px 20px; background-color: #f4f4f4;">
            <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <tr>
                <td>
`;

const getEmailFooter = () => `
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding: 20px; text-align: center; background-color: #ffffff;">
            <p style="color: #6B7280; font-size: 12px; margin: 0;">
              © ${new Date().getFullYear()} FEFA Jewelry. All rights reserved.
            </p>
            <p style="color: #9CA3AF; font-size: 11px; margin: 8px 0 0 0;">
              If you have any questions, please contact us at support@fefajewelry.com
            </p>
          </td>
        </tr>
      </table>
    </body>
  </html>
`;

// Send order shipped email with tracking information
export const sendOrderShippedEmail = async (
  email: string,
  order: {
    orderNumber: string;
    items: Array<{ name: string; quantity: number; price: number; total: number }>;
    shippingAddress: any;
  },
  tracking: {
    carrier?: string;
    trackingNumber: string;
    trackingUrl?: string;
    estimatedDelivery?: string;
  }
): Promise<void> => {
  const transporter = createTransporter();

  const itemsList = order.items
    .map(item => `<li style="margin: 8px 0;">${item.name} × ${item.quantity}</li>`)
    .join('');

  const address = order.shippingAddress;
  const addressHtml = address
    ? `${address.firstName || ''} ${address.lastName || ''}<br>
       ${address.addressLine1 || ''}<br>
       ${address.addressLine2 ? address.addressLine2 + '<br>' : ''}
       ${address.city || ''}, ${address.state || ''} ${address.postalCode || ''}<br>
       ${address.country || ''}`
    : '';

  const trackingButtonHtml = tracking.trackingUrl
    ? `<a href="${tracking.trackingUrl}" style="display: inline-block; background-color: #d4a574; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 16px; font-weight: bold;">Track Your Package</a>`
    : '';

  const mailOptions = {
    from: `"FEFA Jewelry" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
    to: email,
    subject: `Your Order Has Shipped! - #${order.orderNumber}`,
    html: `
      ${getEmailHeader()}
      <h2 style="color: #1F2937; margin: 0 0 20px 0;">Great news! Your order is on its way! 📦</h2>
      
      <p style="color: #4B5563; font-size: 16px; line-height: 1.6;">
        Your order <strong>#${order.orderNumber}</strong> has been shipped and is on its way to you.
      </p>
      
      <div style="background-color: #FEF3C7; border-left: 4px solid #D97706; padding: 16px; margin: 24px 0; border-radius: 4px;">
        <h3 style="color: #92400E; margin: 0 0 12px 0; font-size: 16px;">Tracking Information</h3>
        ${tracking.carrier ? `<p style="margin: 4px 0; color: #78350F;"><strong>Carrier:</strong> ${tracking.carrier}</p>` : ''}
        <p style="margin: 4px 0; color: #78350F;"><strong>Tracking Number:</strong> ${tracking.trackingNumber}</p>
        ${tracking.estimatedDelivery ? `<p style="margin: 4px 0; color: #78350F;"><strong>Estimated Delivery:</strong> ${tracking.estimatedDelivery}</p>` : ''}
        ${trackingButtonHtml}
      </div>
      
      <h3 style="color: #1F2937; margin: 24px 0 12px 0;">Items in Your Order</h3>
      <ul style="color: #4B5563; padding-left: 20px; margin: 0;">
        ${itemsList}
      </ul>
      
      <h3 style="color: #1F2937; margin: 24px 0 12px 0;">Shipping Address</h3>
      <p style="color: #4B5563; line-height: 1.6; margin: 0;">
        ${addressHtml}
      </p>
      
      <p style="color: #6B7280; font-size: 14px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #E5E7EB;">
        Thank you for shopping with FEFA Jewelry. We hope you love your new jewelry!
      </p>
      ${getEmailFooter()}
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Order shipped email sent to ${email} for order ${order.orderNumber}`);
  } catch (error: any) {
    console.error('Error sending order shipped email:', error);
    throw error;
  }
};

// Send order delivered email
export const sendOrderDeliveredEmail = async (
  email: string,
  order: {
    orderNumber: string;
    items: Array<{ name: string; quantity: number }>;
  }
): Promise<void> => {
  const transporter = createTransporter();

  const itemsList = order.items
    .map(item => `<li style="margin: 8px 0;">${item.name} × ${item.quantity}</li>`)
    .join('');

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  const mailOptions = {
    from: `"FEFA Jewelry" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
    to: email,
    subject: `Your Order Has Been Delivered! - #${order.orderNumber}`,
    html: `
      ${getEmailHeader()}
      <h2 style="color: #1F2937; margin: 0 0 20px 0;">Your order has arrived! 🎉</h2>
      
      <p style="color: #4B5563; font-size: 16px; line-height: 1.6;">
        Great news! Your order <strong>#${order.orderNumber}</strong> has been delivered.
      </p>
      
      <div style="background-color: #D1FAE5; border-left: 4px solid #10B981; padding: 16px; margin: 24px 0; border-radius: 4px;">
        <p style="color: #065F46; margin: 0; font-weight: bold;">
          ✓ Delivery Confirmed
        </p>
      </div>
      
      <h3 style="color: #1F2937; margin: 24px 0 12px 0;">Items Delivered</h3>
      <ul style="color: #4B5563; padding-left: 20px; margin: 0;">
        ${itemsList}
      </ul>
      
      <div style="background-color: #F3F4F6; padding: 20px; margin: 24px 0; border-radius: 8px; text-align: center;">
        <h3 style="color: #1F2937; margin: 0 0 12px 0;">We'd love to hear from you!</h3>
        <p style="color: #4B5563; margin: 0 0 16px 0; font-size: 14px;">
          How was your experience? Your feedback helps us improve.
        </p>
        <a href="${frontendUrl}/account/orders" style="display: inline-block; background-color: #d4a574; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Leave a Review
        </a>
      </div>
      
      <p style="color: #6B7280; font-size: 14px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #E5E7EB;">
        Thank you for choosing FEFA Jewelry. We hope you enjoy your new jewelry!
      </p>
      ${getEmailFooter()}
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Order delivered email sent to ${email} for order ${order.orderNumber}`);
  } catch (error: any) {
    console.error('Error sending order delivered email:', error);
    throw error;
  }
};

// Send order cancelled email
export const sendOrderCancelledEmail = async (
  email: string,
  order: {
    orderNumber: string;
    items: Array<{ name: string; quantity: number; price: number; total: number }>;
    pricing: { total: number };
  },
  reason?: string
): Promise<void> => {
  const transporter = createTransporter();

  const itemsList = order.items
    .map(item => `<li style="margin: 8px 0;">${item.name} × ${item.quantity} - ₹${item.total}</li>`)
    .join('');

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  const mailOptions = {
    from: `"FEFA Jewelry" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
    to: email,
    subject: `Order Cancelled - #${order.orderNumber}`,
    html: `
      ${getEmailHeader()}
      <h2 style="color: #1F2937; margin: 0 0 20px 0;">Your order has been cancelled</h2>
      
      <p style="color: #4B5563; font-size: 16px; line-height: 1.6;">
        Your order <strong>#${order.orderNumber}</strong> has been cancelled.
      </p>
      
      ${reason ? `
        <div style="background-color: #FEE2E2; border-left: 4px solid #EF4444; padding: 16px; margin: 24px 0; border-radius: 4px;">
          <p style="color: #991B1B; margin: 0;">
            <strong>Reason:</strong> ${reason}
          </p>
        </div>
      ` : ''}
      
      <h3 style="color: #1F2937; margin: 24px 0 12px 0;">Cancelled Items</h3>
      <ul style="color: #4B5563; padding-left: 20px; margin: 0;">
        ${itemsList}
      </ul>
      
      <div style="background-color: #F3F4F6; padding: 16px; margin: 24px 0; border-radius: 8px;">
        <p style="color: #1F2937; margin: 0; font-weight: bold;">
          Order Total: ₹${order.pricing.total}
        </p>
        <p style="color: #4B5563; margin: 8px 0 0 0; font-size: 14px;">
          If you were charged, a refund will be processed within 5-7 business days.
        </p>
      </div>
      
      <p style="color: #4B5563; font-size: 16px; line-height: 1.6;">
        We're sorry to see this order cancelled. If you have any questions or concerns, please don't hesitate to contact our support team.
      </p>
      
      <div style="text-align: center; margin: 24px 0;">
        <a href="${frontendUrl}/collections" style="display: inline-block; background-color: #d4a574; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Continue Shopping
        </a>
      </div>
      
      <p style="color: #6B7280; font-size: 14px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #E5E7EB;">
        Thank you for considering FEFA Jewelry. We hope to serve you again soon.
      </p>
      ${getEmailFooter()}
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Order cancelled email sent to ${email} for order ${order.orderNumber}`);
  } catch (error: any) {
    console.error('Error sending order cancelled email:', error);
    throw error;
  }
};

// Send payment success email (separate from order confirmation for immediate feedback)
export const sendPaymentSuccessEmail = async (
  email: string,
  order: {
    orderNumber: string;
    pricing: { total: number };
    payment: {
      method: string;
      transactionId?: string;
    };
  }
): Promise<void> => {
  const transporter = createTransporter();

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  const mailOptions = {
    from: `"FEFA Jewelry" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
    to: email,
    subject: `Payment Successful - Order #${order.orderNumber}`,
    html: `
      ${getEmailHeader()}
      <h2 style="color: #1F2937; margin: 0 0 20px 0;">Payment Received! ✓</h2>
      
      <p style="color: #4B5563; font-size: 16px; line-height: 1.6;">
        We've received your payment for order <strong>#${order.orderNumber}</strong>.
      </p>
      
      <div style="background-color: #D1FAE5; border-left: 4px solid #10B981; padding: 16px; margin: 24px 0; border-radius: 4px;">
        <p style="color: #065F46; margin: 0 0 8px 0; font-weight: bold; font-size: 18px;">
          Payment Confirmed
        </p>
        <p style="color: #065F46; margin: 4px 0;"><strong>Amount:</strong> ₹${order.pricing.total}</p>
        <p style="color: #065F46; margin: 4px 0;"><strong>Method:</strong> ${order.payment.method}</p>
        ${order.payment.transactionId ? `<p style="color: #065F46; margin: 4px 0;"><strong>Transaction ID:</strong> ${order.payment.transactionId}</p>` : ''}
      </div>
      
      <p style="color: #4B5563; font-size: 16px; line-height: 1.6;">
        Your order is now being processed. You'll receive another email with your order details and tracking information once your package ships.
      </p>
      
      <div style="text-align: center; margin: 24px 0;">
        <a href="${frontendUrl}/order-confirmation/${order.orderNumber}" style="display: inline-block; background-color: #d4a574; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
          View Order Details
        </a>
      </div>
      
      <p style="color: #6B7280; font-size: 14px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #E5E7EB;">
        Thank you for shopping with FEFA Jewelry!
      </p>
      ${getEmailFooter()}
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Payment success email sent to ${email} for order ${order.orderNumber}`);
  } catch (error: any) {
    console.error('Error sending payment success email:', error);
    throw error;
  }
};
