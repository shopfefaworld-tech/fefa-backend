import { Router, Response } from 'express';
import nodemailer from 'nodemailer';
import { verifyToken, AuthRequest, requireAdmin } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import Settings from '../models/Settings';
import { connectDB } from '../config/database';

const router = Router();

/**
 * @route   GET /api/settings
 * @desc    Get application settings
 * @access  Private/Admin
 */
router.get('/', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();

    let settings = await Settings.findOne();
    
    // If no settings exist, create default settings
    if (!settings) {
      settings = await Settings.create({
        storeName: 'FEFA Jewelry',
        storeDescription: 'Premium artificial jewelry store',
        storeEmail: process.env.SMTP_USER || 'contact@fefajewelry.com',
        emailFrom: process.env.SMTP_USER || 'contact@fefajewelry.com',
      });
    }

    res.json({
      success: true,
      data: settings
    });
  } catch (error: any) {
    next(createError(error.message || 'Failed to fetch settings', 500));
  }
});

/**
 * @route   PUT /api/settings
 * @desc    Update application settings
 * @access  Private/Admin
 */
router.put('/', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    await connectDB();

    let settings = await Settings.findOne();
    
    // If no settings exist, create new
    if (!settings) {
      settings = await Settings.create(req.body);
    } else {
      // Update existing settings
      Object.assign(settings, req.body);
      await settings.save();
    }

    res.json({
      success: true,
      data: settings,
      message: 'Settings updated successfully'
    });
  } catch (error: any) {
    next(createError(error.message || 'Failed to update settings', 500));
  }
});

/**
 * @route   GET /api/settings/top-banner
 * @desc    Get top banner settings (public)
 * @access  Public
 */
router.get('/top-banner', async (req: any, res: Response, next) => {
  try {
    await connectDB();

    const settings = await Settings.findOne().select('topBannerText topBannerLink topBannerActive topBannerBackgroundColor topBannerTextColor');
    
    if (!settings) {
      return res.json({
        success: true,
        data: {
          text: '',
          link: '',
          isActive: false,
          backgroundColor: '#DBC078',
          textColor: '#470031'
        }
      });
    }

    return res.json({
      success: true,
      data: {
        text: settings.topBannerText || '',
        link: settings.topBannerLink || '',
        isActive: settings.topBannerActive || false,
        backgroundColor: settings.topBannerBackgroundColor || '#DBC078',
        textColor: settings.topBannerTextColor || '#470031'
      }
    });
  } catch (error: any) {
    return next(createError(error.message || 'Failed to fetch top banner', 500));
  }
});

/**
 * @route   POST /api/settings/test-email
 * @desc    Send a test email
 * @access  Private/Admin
 */
router.post('/test-email', verifyToken, requireAdmin, async (req: AuthRequest, res: Response, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return next(createError('Email address is required', 400));
    }

    // Validate email format
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(email)) {
      return next(createError('Please enter a valid email address', 400));
    }

    // Get SMTP configuration
    const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
    const smtpPort = parseInt(process.env.SMTP_PORT || '587');
    const smtpUser = process.env.SMTP_USER || process.env.SMTP_USERNAME;
    const smtpPassword = process.env.SMTP_PASSWORD;

    if (!smtpUser || !smtpPassword) {
      return next(createError('SMTP configuration is not set. Please configure SMTP_USER and SMTP_PASSWORD in environment variables.', 400));
    }

    // Create transporter
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: smtpUser,
        pass: smtpPassword,
      },
    });

    // Get store settings
    await connectDB();
    const settings = await Settings.findOne();
    const storeName = settings?.storeName || 'FEFA Jewelry';
    const fromEmail = process.env.EMAIL_FROM || smtpUser || 'noreply@fefajewelry.com';

    // Send test email
    const mailOptions = {
      from: `"${storeName}" <${fromEmail}>`,
      to: email,
      subject: `Test Email from ${storeName}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Test Email</title>
          </head>
          <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
            <table role="presentation" style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 20px 0; text-align: center; background-color: #3B82F6;">
                  <h1 style="color: #ffffff; margin: 0;">${storeName}</h1>
                </td>
              </tr>
              <tr>
                <td style="padding: 40px 20px; background-color: #f4f4f4;">
                  <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <tr>
                      <td>
                        <h2 style="color: #1F2937; margin: 0 0 20px 0;">✅ Email Configuration Test</h2>
                        <p style="color: #4B5563; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                          Congratulations! Your email configuration is working correctly.
                        </p>
                        <div style="background-color: #F0FDF4; border: 1px solid #22C55E; border-radius: 8px; padding: 20px; margin: 20px 0;">
                          <p style="color: #166534; font-size: 14px; margin: 0;">
                            <strong>SMTP Server:</strong> ${smtpHost}<br>
                            <strong>Port:</strong> ${smtpPort}<br>
                            <strong>Sent at:</strong> ${new Date().toISOString()}
                          </p>
                        </div>
                        <p style="color: #4B5563; font-size: 14px; line-height: 1.6; margin: 20px 0 0 0;">
                          This is a test email to verify that your SMTP configuration is set up correctly. You can now send emails for:
                        </p>
                        <ul style="color: #4B5563; font-size: 14px; line-height: 1.8;">
                          <li>Order confirmations</li>
                          <li>Shipping notifications</li>
                          <li>Password reset emails</li>
                          <li>Newsletter subscriptions</li>
                        </ul>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding: 20px; text-align: center; background-color: #1F2937;">
                  <p style="color: #9CA3AF; font-size: 12px; margin: 0;">
                    © ${new Date().getFullYear()} ${storeName}. All rights reserved.
                  </p>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `,
      text: `
        ${storeName} - Email Configuration Test
        
        Congratulations! Your email configuration is working correctly.
        
        SMTP Server: ${smtpHost}
        Port: ${smtpPort}
        Sent at: ${new Date().toISOString()}
        
        This is a test email to verify that your SMTP configuration is set up correctly.
        
        © ${new Date().getFullYear()} ${storeName}. All rights reserved.
      `,
    };

    // Verify connection first
    await transporter.verify();
    console.log('SMTP connection verified for test email');

    // Send the email
    const info = await transporter.sendMail(mailOptions);
    console.log('Test email sent successfully:', info.messageId);

    res.json({
      success: true,
      message: `Test email sent successfully to ${email}`,
      details: {
        messageId: info.messageId,
        smtpServer: smtpHost,
        port: smtpPort
      }
    });
  } catch (error: any) {
    console.error('Test email error:', error);
    
    // Provide more specific error messages
    let errorMessage = 'Failed to send test email';
    if (error.code === 'EAUTH') {
      errorMessage = 'SMTP authentication failed. Please check your SMTP credentials.';
    } else if (error.code === 'ECONNECTION') {
      errorMessage = 'Could not connect to SMTP server. Please check SMTP_HOST and SMTP_PORT.';
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = 'SMTP connection timed out. Please check your network connection.';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    next(createError(errorMessage, 500));
  }
});

export default router;
