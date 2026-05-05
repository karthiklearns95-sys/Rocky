import dotenv from 'dotenv';
dotenv.config();

/**
 * Direct Email Tool — Sends emails via SMTP without opening a browser.
 * Requires nodemailer to be installed.
 */
export default async function sendEmailDirect(args) {
  const { recipient, subject, body } = args;
  
  if (!recipient || !subject || !body) {
    return { success: false, error: "Grace, Rocky needs a recipient, subject, and body to send a direct email." };
  }

  // Check if credentials are still placeholders
  if (process.env.EMAIL_USER === 'your-email@gmail.com' || process.env.EMAIL_PASS === 'your-app-password-here') {
    return { success: false, error: "Grace... Rocky is ready to send mail, but you haven't given him your keys yet! Please update your EMAIL_USER and EMAIL_PASS in the .env file." };
  }

  console.log(`[Tool: sendEmailDirect] Attempting to send email to: ${recipient}`);

  try {
    const { default: nodemailer } = await import('nodemailer');

    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: recipient,
      subject: subject,
      text: body,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('[Tool: sendEmailDirect] Email sent:', info.response);
    
    try {
      const { default: eventBus } = await import('../../controller/eventBus.js');
      eventBus.emit('MAIL_SENT', { recipient, subject, timestamp: new Date().toISOString() });
    } catch (e) {}

    return { success: true, data: `Grace, Rocky sent the email to ${recipient} directly.` };
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' || err.message.includes('Cannot find module')) {
      return { success: false, error: "Grace, Rocky needs a small upgrade (nodemailer) to send emails directly." };
    }
    
    console.error('[Tool: sendEmailDirect] Error:', err.message);
    return { success: false, error: `Grace, Rocky failed to send the email. Check your .env credentials (you need a Gmail App Password).` };
  }
}
