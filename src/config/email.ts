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

