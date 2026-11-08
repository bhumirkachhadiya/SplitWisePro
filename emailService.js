/**
 * ==============================================================================
 * SPLITWISE CENTRALIZED EMAIL SERVICE
 * ==============================================================================
 * Production-ready, multi-provider email service supporting:
 *  1. Resend REST API (HTTPS port 443 - zero SMTP port blocks on Vercel/Cloud)
 *  2. Standard SMTP (Gmail, Brevo, SendGrid, Amazon SES, Mailgun, Custom SMTP)
 *  3. Ethereal Email (Auto-sandbox for local testing & verifiable test inbox)
 *
 * Features:
 *  - Responsive HTML + plain-text email templates matching SplitWise branding
 *  - Strict OTP privacy: OTP values are NEVER logged to console or disk
 *  - Automatic recipient validation and transient retry with backoff
 *  - Provider status verification (verifyConnection)
 * ==============================================================================
 */

const dns = require('dns');
if (dns && typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
}

const nodemailer = require('nodemailer');

// ------------------------------------------------------------------------------
// SENDER & ENVIRONMENT CONFIGURATION
// ------------------------------------------------------------------------------
function getSenderConfig() {
    const fromAddress = process.env.EMAIL_FROM || process.env.SMTP_FROM;
    if (fromAddress) {
        return fromAddress;
    }
    // If Resend is used without a verified domain, default to Resend onboarding sandbox
    if (process.env.RESEND_API_KEY && !process.env.EMAIL_FROM) {
        return 'SplitWise <onboarding@resend.dev>';
    }
    return '"SplitWise Security" <no-reply@splitease.io>';
}

function maskEmail(email) {
    if (!email || typeof email !== 'string') return '***';
    const parts = email.split('@');
    if (parts.length !== 2) return '***';
    const name = parts[0];
    const domain = parts[1];
    const maskedName = name.length > 2 ? `${name[0]}***${name[name.length - 1]}` : `${name[0]}***`;
    return `${maskedName}@${domain}`;
}

// ------------------------------------------------------------------------------
// RESEND REST API SENDER (HTTPS Port 443)
// ------------------------------------------------------------------------------
async function sendViaResendRest({ from, to, subject, html, text }) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('RESEND_API_KEY is not configured');

    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from,
            to: Array.isArray(to) ? to : [to],
            subject,
            html,
            text
        })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
        const errorMsg = data?.message || data?.error?.message || `Resend API returned status ${res.status}`;
        const err = new Error(`Resend Email Delivery Failed: ${errorMsg}`);
        err.provider = 'resend';
        err.statusCode = res.status;
        err.details = data;
        throw err;
    }

    return {
        provider: 'resend',
        messageId: data.id,
        delivered: true,
        previewUrl: null
    };
}

// ------------------------------------------------------------------------------
// NODEMAILER SMTP TRANSPORTER (SINGLETON WITH POOLING)
// ------------------------------------------------------------------------------
let smtpTransporterInstance = null;
let etherealAccountCache = null;
let lastEmailError = null;

function getResolvedSmtpConfig(forcePort465 = false) {
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const user = process.env.SMTP_USER || 'bhumirkachhadiya11@gmail.com';
    let pass = process.env.SMTP_PASS;

    // Self-heal Gmail App Password if missing or placeholder
    if (!pass || pass.includes('(') || pass.includes('Your') || pass.includes('[') || pass.trim() === '') {
        if (user === 'bhumirkachhadiya11@gmail.com') {
            pass = 'limdiqyycugywpsb';
        }
    }

    const isGmail = host.toLowerCase().includes('gmail');
    // On cloud providers (Render/AWS), direct SMTPS port 465 bypasses port 587 STARTTLS firewalls
    const rawPort = parseInt(process.env.SMTP_PORT, 10);
    const port = forcePort465 || isGmail ? 465 : (rawPort || 587);
    const secure = port === 465 || process.env.SMTP_SECURE === 'true';

    return { host, user, pass, port, secure };
}

async function getSmtpTransporter(forcePort465 = false) {
    if (smtpTransporterInstance && !forcePort465) {
        return smtpTransporterInstance;
    }

    const cfg = getResolvedSmtpConfig(forcePort465);
    if (cfg.host && cfg.user && cfg.pass) {
        const transporter = nodemailer.createTransport({
            host: cfg.host,
            port: cfg.port,
            secure: cfg.secure,
            auth: {
                user: cfg.user,
                pass: cfg.pass
            },
            connectionTimeout: 4000,
            greetingTimeout: 4000,
            socketTimeout: 5000
        });
        if (!forcePort465) {
            smtpTransporterInstance = transporter;
        }
        console.log(`[EmailService] ✓ Initialized SMTP Transporter (${cfg.host}:${cfg.port}, secure=${cfg.secure})`);
        return transporter;
    }

    // 2. Resend SMTP Fallback (if RESEND_API_KEY set without explicit SMTP config)
    if (process.env.RESEND_API_KEY) {
        smtpTransporterInstance = nodemailer.createTransport({
            host: 'smtp.resend.com',
            port: 465,
            secure: true,
            auth: {
                user: 'resend',
                pass: process.env.RESEND_API_KEY
            },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 15000
        });
        console.log('[EmailService] ✓ Initialized Resend SMTP Transporter');
        return smtpTransporterInstance;
    }

    // 3. Ethereal Test Transporter (Development & Automated Verification Sandbox)
    if (!etherealAccountCache) {
        try {
            console.log('[EmailService] ℹ Creating Ethereal test mailbox for local email simulation...');
            etherealAccountCache = await nodemailer.createTestAccount();
            console.log(`[EmailService] ✓ Ethereal Test Account Ready: ${etherealAccountCache.user}`);
        } catch (e) {
            console.warn('[EmailService] ⚠️ Ethereal account creation failed, falling back to JSON mock transporter:', e.message);
            smtpTransporterInstance = nodemailer.createTransport({ jsonTransport: true });
            return smtpTransporterInstance;
        }
    }

    smtpTransporterInstance = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
            user: etherealAccountCache.user,
            pass: etherealAccountCache.pass
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000
    });

    return smtpTransporterInstance;
}

// ------------------------------------------------------------------------------
// CORE SEND FUNCTION WITH SAFE RETRY AND AUDIT LOGGING
// ------------------------------------------------------------------------------
async function sendEmail({ to, subject, html, text }) {
    if (!to || !to.trim()) {
        throw new Error('Email recipient (to) is required.');
    }

    const normalizedRecipient = to.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedRecipient)) {
        throw new Error(`Invalid email address format: ${to}`);
    }

    const from = getSenderConfig();
    const maskedTo = maskEmail(normalizedRecipient);

    // Attempt delivery with 1 retry on network timeout
    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            // Strategy 0: If recipient is the account owner (bhumirkachhadiya11@gmail.com) and Resend is configured, use Resend HTTPS (Port 443)
            const resendApiKey = process.env.RESEND_API_KEY;
            if (normalizedRecipient === 'bhumirkachhadiya11@gmail.com' && resendApiKey) {
                try {
                    console.log(`[EmailService] Delivering to ${maskedTo} via Resend HTTPS API (Port 443)...`);
                    const result = await sendViaResendRest({ from: 'SplitWise <onboarding@resend.dev>', to: normalizedRecipient, subject, html, text });
                    console.log(`[EmailService] ✓ Successfully dispatched to ${maskedTo} via Resend. Message ID: ${result.messageId}`);
                    return result;
                } catch (resendErr) {
                    console.warn('[EmailService] Resend delivery notice, continuing to SMTP:', resendErr.message);
                }
            }

            // Strategy 1: Prefer SMTP Transporter if configured
            const cfg = getResolvedSmtpConfig(attempt === 2);
            if (cfg.host && cfg.user && cfg.pass) {
                const transporter = await getSmtpTransporter(attempt === 2);
                console.log(`[EmailService] Sending via SMTP (${cfg.host}:${cfg.port}) to ${maskedTo} (Attempt ${attempt}/2)...`);
                const info = await transporter.sendMail({
                    from,
                    to: normalizedRecipient,
                    subject,
                    text,
                    html
                });

                console.log(`[EmailService] ✓ Successfully sent to ${maskedTo} via SMTP. Message ID: ${info.messageId}`);
                return {
                    provider: 'smtp',
                    messageId: info.messageId,
                    delivered: true,
                    previewUrl: null
                };
            }

            // Strategy 2: If RESEND_API_KEY is configured, use Resend HTTPS REST API
            if (process.env.RESEND_API_KEY) {
                console.log(`[EmailService] Sending via Resend API to ${maskedTo} (Attempt ${attempt}/2)...`);
                const result = await sendViaResendRest({ from, to: normalizedRecipient, subject, html, text });
                console.log(`[EmailService] ✓ Successfully dispatched to ${maskedTo} via Resend. Message ID: ${result.messageId}`);
                return result;
            }

            // Strategy 3: Development / Ethereal Fallback
            const transporter = await getSmtpTransporter();
            console.log(`[EmailService] Sending via Development Fallback to ${maskedTo} (Attempt ${attempt}/2)...`);
            const info = await transporter.sendMail({
                from,
                to: normalizedRecipient,
                subject,
                text,
                html
            });

            const previewUrl = nodemailer.getTestMessageUrl ? nodemailer.getTestMessageUrl(info) : null;
            if (previewUrl) {
                console.log(`[EmailService] 📬 Test Email Preview: ${previewUrl}`);
            }

            console.log(`[EmailService] ✓ Successfully sent to ${maskedTo}. Message ID: ${info.messageId}`);
            return {
                provider: etherealAccountCache ? 'ethereal' : 'smtp',
                messageId: info.messageId,
                delivered: true,
                previewUrl
            };
        } catch (err) {
            lastError = err;
            lastEmailError = {
                message: err.message,
                code: err.code,
                command: err.command,
                response: err.response,
                responseCode: err.responseCode,
                time: new Date().toISOString()
            };
            console.error(`[EmailService] ⚠️ Attempt ${attempt} failed for ${maskedTo}: ${err.message}`);
            smtpTransporterInstance = null; // Clear cached instance to force fresh socket on retry
            if (attempt === 1) {
                // Wait 1 second before retry on transient network errors
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }

    throw lastError || new Error(`Email delivery failed to ${maskedTo}`);
}

// ------------------------------------------------------------------------------
// HTML TEMPLATE BUILDER (MODERN, RESPONSIVE, SPLITWISE BRANDED)
// ------------------------------------------------------------------------------
function wrapHtmlTemplate({ title, badge, content, actionBtn, footerNote }) {
    const currentYear = new Date().getFullYear();
    const appUrl = process.env.APP_URL || 'http://localhost:5000';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f4f6f8;
      color: #1a1f2c;
      -webkit-font-smoothing: antialiased;
    }
    .email-wrapper {
      width: 100%;
      background-color: #f4f6f8;
      padding: 30px 12px;
      box-sizing: border-box;
    }
    .email-container {
      max-width: 540px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
      border: 1px solid #e5e9ee;
    }
    .header {
      background: linear-gradient(135deg, #006c4b 0%, #004d35 100%);
      padding: 28px 24px;
      text-align: center;
      color: #ffffff;
    }
    .header-logo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      background: rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      margin-bottom: 12px;
      font-size: 24px;
    }
    .header h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.3px;
    }
    .header-badge {
      display: inline-block;
      margin-top: 8px;
      padding: 4px 12px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .content {
      padding: 32px 28px;
      font-size: 14px;
      line-height: 1.6;
      color: #333d4b;
    }
    .otp-card {
      background: #f0fdf4;
      border: 2px dashed #006c4b;
      border-radius: 14px;
      padding: 20px;
      text-align: center;
      margin: 24px 0;
    }
    .otp-code {
      font-family: 'SF Pro Display', -apple-system, monospace;
      font-size: 36px;
      font-weight: 800;
      color: #006c4b;
      letter-spacing: 8px;
      margin: 8px 0;
    }
    .otp-sub {
      font-size: 12px;
      color: #047857;
      font-weight: 600;
    }
    .info-table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      background: #f8fafc;
      border-radius: 10px;
      overflow: hidden;
      border: 1px solid #e2e8f0;
    }
    .info-table td {
      padding: 12px 16px;
      font-size: 13px;
      border-bottom: 1px solid #e2e8f0;
    }
    .info-table tr:last-child td {
      border-bottom: none;
    }
    .info-label {
      color: #64748b;
      font-weight: 600;
      width: 35%;
    }
    .info-val {
      color: #0f172a;
      font-weight: 700;
    }
    .btn-container {
      text-align: center;
      margin: 28px 0 16px;
    }
    .btn {
      display: inline-block;
      padding: 13px 32px;
      background: #006c4b;
      color: #ffffff !important;
      text-decoration: none;
      font-weight: 700;
      font-size: 14px;
      border-radius: 10px;
      box-shadow: 0 4px 12px rgba(0, 108, 75, 0.25);
    }
    .btn:hover {
      background: #00563b;
    }
    .note-box {
      background: #f8fafc;
      border-left: 4px solid #64748b;
      padding: 12px 14px;
      border-radius: 6px;
      font-size: 12px;
      color: #475569;
      margin: 20px 0;
    }
    .footer {
      background: #f8fafc;
      padding: 20px 24px;
      text-align: center;
      font-size: 11px;
      color: #94a3b8;
      border-top: 1px solid #e5e9ee;
    }
    .footer a {
      color: #006c4b;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="email-container">
      <div class="header">
        <div class="header-logo">⚡</div>
        <h1>SplitWise</h1>
        ${badge ? `<div class="header-badge">${badge}</div>` : ''}
      </div>
      <div class="content">
        ${content}
        ${actionBtn ? `<div class="btn-container"><a href="${actionBtn.url}" class="btn">${actionBtn.text}</a></div>` : ''}
        ${footerNote ? `<div class="note-box">${footerNote}</div>` : ''}
      </div>
      <div class="footer">
        <p style="margin: 0 0 6px;">SplitWise • Intelligent Shared Expense & Automated UPI Settlement</p>
        <p style="margin: 0;">&copy; ${currentYear} SplitWise. All rights reserved. • <a href="${appUrl}">Visit Dashboard</a></p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ------------------------------------------------------------------------------
// SPECIALIZED EMAIL DISPATCHERS
// ------------------------------------------------------------------------------

/**
 * 1. SIGNUP OTP VERIFICATION EMAIL
 */
async function sendSignupOtpEmail({ to, name, otp }) {
    const displayName = (name && name.trim()) || 'there';
    const subject = `Your SplitWise Verification Code: ${otp}`;

    const content = `
      <p style="margin-top: 0; font-size: 15px;">Hello <strong>${displayName}</strong>,</p>
      <p>Thank you for creating an account with SplitWise! Please enter the 6-digit verification code below to verify your email address and activate your account:</p>
      
      <div class="otp-card">
        <div class="otp-sub">VERIFICATION CODE</div>
        <div class="otp-code">${otp}</div>
        <div class="otp-sub">⏱️ Valid for 5 minutes</div>
      </div>
      
      <p style="color: #64748b; font-size: 13px;">
        For your security, never share this code with anyone. If you didn't initiate this request, you can safely ignore this email.
      </p>
    `;

    const plainText = `Hello ${displayName},

Your SplitWise verification code is: ${otp}

This code will expire in 5 minutes.
If you did not request this code, please safely ignore this email.

— The SplitWise Team`;

    return sendEmail({
        to,
        subject,
        html: wrapHtmlTemplate({
            title: 'Verify Your Email — SplitWise',
            badge: 'Email Verification',
            content,
            footerNote: '⏱️ Security Notice: This one-time code expires in 5 minutes and can only be used once.'
        }),
        text: plainText
    });
}

/**
 * 2. FORGOT PASSWORD OTP VERIFICATION EMAIL
 */
async function sendPasswordResetOtpEmail({ to, name, otp }) {
    const displayName = (name && name.trim()) || 'User';
    const subject = `Reset Your SplitWise Password: ${otp}`;

    const content = `
      <p style="margin-top: 0; font-size: 15px;">Hello <strong>${displayName}</strong>,</p>
      <p>We received a request to reset your SplitWise account password. Use the verification code below to proceed with setting a new password:</p>
      
      <div class="otp-card" style="background: #fff7ed; border-color: #ea580c;">
        <div class="otp-sub" style="color: #c2410c;">PASSWORD RESET CODE</div>
        <div class="otp-code" style="color: #c2410c;">${otp}</div>
        <div class="otp-sub" style="color: #c2410c;">⏱️ Valid for 5 minutes</div>
      </div>
      
      <p style="color: #64748b; font-size: 13px;">
        🔒 <strong>Didn't request this?</strong> Your account password has NOT been changed. You can safely ignore this email or contact support if you suspect unauthorized access.
      </p>
    `;

    const plainText = `Hello ${displayName},

We received a request to reset your SplitWise account password.

Your verification code is: ${otp}

This code will expire in 5 minutes.
If you did not request a password reset, you can safely ignore this email.

— The SplitWise Team`;

    return sendEmail({
        to,
        subject,
        html: wrapHtmlTemplate({
            title: 'Reset Password — SplitWise',
            badge: 'Security Verification',
            content,
            footerNote: '🔒 SplitWise will never ask you for your verification code or password via phone or chat.'
        }),
        text: plainText
    });
}

/**
 * 3. GROUP / CIRCLE INVITATION EMAIL
 */
async function sendGroupInvitationEmail({ to, recipientName, inviterName, groupName, role = 'member', joinUrl }) {
    const appUrl = process.env.APP_URL || 'http://localhost:5000';
    const actionUrl = joinUrl || appUrl;
    const subject = `${inviterName} added you to "${groupName}" on SplitWise`;

    const content = `
      <p style="margin-top: 0; font-size: 15px;">Hello <strong>${recipientName || 'there'}</strong>,</p>
      <p><strong>${inviterName}</strong> has added you to the shared expense circle <strong>"${groupName}"</strong> on SplitWise as an <strong>${role}</strong>.</p>
      
      <table class="info-table">
        <tr>
          <td class="info-label">Group Circle</td>
          <td class="info-val">${groupName}</td>
        </tr>
        <tr>
          <td class="info-label">Invited By</td>
          <td class="info-val">${inviterName}</td>
        </tr>
        <tr>
          <td class="info-label">Your Role</td>
          <td class="info-val" style="text-transform: capitalize;">${role}</td>
        </tr>
      </table>
      
      <p>You can now view shared group expenses, track balances, and settle payments effortlessly.</p>
    `;

    const plainText = `Hello ${recipientName || 'there'},

${inviterName} has added you to the group "${groupName}" on SplitWise with role: ${role}.

Open SplitWise to view and manage shared expenses: ${actionUrl}

— The SplitWise Team`;

    return sendEmail({
        to,
        subject,
        html: wrapHtmlTemplate({
            title: `Invitation to ${groupName} — SplitWise`,
            badge: 'Group Invitation',
            content,
            actionBtn: { text: 'Open Group in SplitWise →', url: actionUrl }
        }),
        text: plainText
    });
}

/**
 * 4. EXPENSE ADDED NOTIFICATION EMAIL
 */
async function sendExpenseAddedEmail({ to, recipientName, payerName, expenseTitle, groupName, shareAmount, totalAmount }) {
    const appUrl = process.env.APP_URL || 'http://localhost:5000';
    const formattedShare = parseFloat(shareAmount).toFixed(2);
    const formattedTotal = parseFloat(totalAmount).toFixed(2);
    const subject = `New Expense: ${payerName} added "${expenseTitle}" in ${groupName}`;

    const content = `
      <p style="margin-top: 0; font-size: 15px;">Hello <strong>${recipientName || 'there'}</strong>,</p>
      <p>A new expense has been recorded in <strong>${groupName}</strong> by <strong>${payerName}</strong>.</p>
      
      <table class="info-table">
        <tr>
          <td class="info-label">Expense</td>
          <td class="info-val">${expenseTitle}</td>
        </tr>
        <tr>
          <td class="info-label">Total Amount</td>
          <td class="info-val">₹${formattedTotal}</td>
        </tr>
        <tr>
          <td class="info-label">Paid By</td>
          <td class="info-val">${payerName}</td>
        </tr>
        <tr style="background: #f0fdf4;">
          <td class="info-label" style="color: #006c4b;">Your Share</td>
          <td class="info-val" style="color: #006c4b; font-size: 15px;">₹${formattedShare}</td>
        </tr>
      </table>
      
      <p style="color: #64748b; font-size: 13px;">This has been automatically reflected in your circle balances.</p>
    `;

    const plainText = `Hello ${recipientName || 'there'},

${payerName} added a new expense "${expenseTitle}" in ${groupName}.
Total Amount: ₹${formattedTotal}
Your Share: ₹${formattedShare}

View details on SplitWise: ${appUrl}

— The SplitWise Team`;

    return sendEmail({
        to,
        subject,
        html: wrapHtmlTemplate({
            title: `New Expense in ${groupName}`,
            badge: 'Expense Added',
            content,
            actionBtn: { text: 'View Balances on SplitWise →', url: appUrl }
        }),
        text: plainText
    });
}

/**
 * 5. SETTLEMENT COMPLETED NOTIFICATION EMAIL
 */
async function sendSettlementCompletedEmail({ to, recipientName, payerName, receiverName, amount, paymentMethod = 'UPI', transactionRef, isPayer = false }) {
    const appUrl = process.env.APP_URL || 'http://localhost:5000';
    const formattedAmt = parseFloat(amount).toFixed(2);
    const otherParty = isPayer ? receiverName : payerName;
    const actionText = isPayer ? `You paid ₹${formattedAmt} to ${receiverName}` : `${payerName} paid you ₹${formattedAmt}`;
    const subject = `Payment Settled: ₹${formattedAmt} via ${paymentMethod}`;

    const content = `
      <p style="margin-top: 0; font-size: 15px;">Hello <strong>${recipientName || 'there'}</strong>,</p>
      <p style="font-weight: 600; color: #006c4b; font-size: 16px;">✓ ${actionText}</p>
      
      <table class="info-table">
        <tr>
          <td class="info-label">Amount Settled</td>
          <td class="info-val" style="color: #006c4b;">₹${formattedAmt}</td>
        </tr>
        <tr>
          <td class="info-label">Paid By</td>
          <td class="info-val">${payerName}</td>
        </tr>
        <tr>
          <td class="info-label">Paid To</td>
          <td class="info-val">${receiverName}</td>
        </tr>
        <tr>
          <td class="info-label">Payment Method</td>
          <td class="info-val">${paymentMethod}</td>
        </tr>
        ${transactionRef ? `<tr><td class="info-label">Reference / UTR</td><td class="info-val" style="font-family: monospace;">${transactionRef}</td></tr>` : ''}
      </table>
      
      <p style="color: #64748b; font-size: 13px;">Balances have been updated across your mutual circles.</p>
    `;

    const plainText = `Hello ${recipientName || 'there'},

Settlement Confirmation:
${actionText}
Method: ${paymentMethod}
Reference: ${transactionRef || 'N/A'}

View your updated balance on SplitWise: ${appUrl}

— The SplitWise Team`;

    return sendEmail({
        to,
        subject,
        html: wrapHtmlTemplate({
            title: 'Settlement Confirmation — SplitWise',
            badge: 'Settlement Complete',
            content,
            actionBtn: { text: 'View Updated Balances →', url: appUrl }
        }),
        text: plainText
    });
}

/**
 * 6. EXPENSE REMINDER EMAIL
 */
async function sendExpenseReminderEmail({ to, debtorName, payerName, payerUpi, expenseTitle, groupName, shareAmount, customNote, redirectUrl }) {
    const appUrl = process.env.APP_URL || 'http://localhost:5000';
    const actionUrl = redirectUrl || appUrl;
    const formattedShare = parseFloat(shareAmount).toFixed(2);
    const subject = `Reminder: Settle ₹${formattedShare} for "${expenseTitle}" on SplitWise`;

    const content = `
      <p style="margin-top: 0; font-size: 15px;">Hello <strong>${debtorName || 'there'}</strong>,</p>
      <p><strong>${payerName}</strong> sent you a friendly reminder to settle your share for <strong>"${expenseTitle}"</strong> in <strong>${groupName}</strong>.</p>
      
      ${customNote ? `<div class="note-box" style="border-left-color: #006c4b; background: #f0fdf4; color: #004d35;"><strong>Note from ${payerName}:</strong> "${customNote}"</div>` : ''}

      <table class="info-table">
        <tr>
          <td class="info-label">Expense</td>
          <td class="info-val">${expenseTitle}</td>
        </tr>
        <tr>
          <td class="info-label">Group</td>
          <td class="info-val">${groupName}</td>
        </tr>
        <tr>
          <td class="info-label">Payee</td>
          <td class="info-val">${payerName}</td>
        </tr>
        ${payerUpi ? `<tr><td class="info-label">Payee UPI ID</td><td class="info-val" style="font-family: monospace; color: #006c4b;">${payerUpi}</td></tr>` : ''}
        <tr style="background: #f0fdf4;">
          <td class="info-label" style="color: #006c4b;">Amount Due</td>
          <td class="info-val" style="color: #006c4b; font-size: 16px;">₹${formattedShare}</td>
        </tr>
      </table>
    `;

    const plainText = `Hello ${debtorName || 'there'},

${payerName} sent you a reminder to settle ₹${formattedShare} for "${expenseTitle}" in ${groupName}.
Payee UPI ID: ${payerUpi || 'N/A'}
${customNote ? `Note: "${customNote}"\n` : ''}
Settle up now on SplitWise: ${actionUrl}

— The SplitWise Team`;

    return sendEmail({
        to,
        subject,
        html: wrapHtmlTemplate({
            title: `Reminder to Settle ₹${formattedShare}`,
            badge: 'Payment Reminder',
            content,
            actionBtn: { text: 'View Expense & Settle Up →', url: actionUrl }
        }),
        text: plainText
    });
}

// ------------------------------------------------------------------------------
// PROVIDER DIAGNOSTICS & VERIFICATION
// ------------------------------------------------------------------------------
async function verifyEmailService() {
    if (process.env.RESEND_API_KEY) {
        return {
            provider: 'resend',
            configured: true,
            from: getSenderConfig(),
            details: 'Resend HTTPS REST API (Port 443)'
        };
    }

    const cfg = getResolvedSmtpConfig(false);
    if (cfg.host && cfg.user && cfg.pass) {
        let verifyStatus = 'unknown';
        let verifyError = null;
        try {
            const transporter = await getSmtpTransporter(false);
            await transporter.verify();
            verifyStatus = 'verified';
        } catch (e) {
            verifyStatus = 'failed';
            verifyError = { message: e.message, code: e.code, response: e.response };
        }

        return {
            provider: 'smtp',
            configured: true,
            from: getSenderConfig(),
            host: cfg.host,
            port: cfg.port,
            user: cfg.user.slice(0, 3) + '***@' + (cfg.user.split('@')[1] || ''),
            secure: cfg.secure,
            verify_status: verifyStatus,
            verify_error: verifyError,
            last_delivery_error: lastEmailError
        };
    }

    return {
        provider: 'ethereal',
        configured: false,
        from: getSenderConfig(),
        details: 'Development Sandbox (Ethereal test mailbox)'
    };
}

module.exports = {
    sendEmail,
    sendSignupOtpEmail,
    sendPasswordResetOtpEmail,
    sendGroupInvitationEmail,
    sendExpenseAddedEmail,
    sendSettlementCompletedEmail,
    sendExpenseReminderEmail,
    verifyEmailService,
    getSenderConfig
};
