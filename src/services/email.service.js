import path from 'node:path';
import { transporter } from '../config/mailer.js';
import { env } from '../config/env.js';
import { centsToCurrency } from '../utils/money.js';
import { escapeHtml } from '../utils/mask.js';
import { generateSignedInvoiceUrl } from '../utils/signedLink.js';

export async function sendInvoiceEmail({
  to,
  name,
  plan,
  amountCents,
  currency,
  invoiceNumber,
  invoiceId,
  invoicePath,
  paidAt,
}) {
  const customerName = name || 'Valued Customer';
  const planName = plan || 'SaaS Subscription';
  const formattedAmount = centsToCurrency(amountCents || 0, currency || 'usd');
  const signedDownloadUrl = generateSignedInvoiceUrl(invoiceId);

  const formattedDate = paidAt ? new Date(paidAt).toUTCString() : new Date().toUTCString();

  const textBody = `Hello ${customerName},

Thank you for your payment!

Subscription Details:
- Plan: ${planName}
- Amount Paid: ${formattedAmount}
- Paid Date: ${formattedDate}
- Invoice #: ${invoiceNumber}

You can download your PDF invoice here (link expires in ${env.INVOICE_LINK_TTL_HOURS} hours):
${signedDownloadUrl}

Your PDF invoice is also attached to this email.

Best regards,
The ${env.COMPANY_NAME} Team`;

  const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; line-height: 1.5; color: #333;">
  <h2>Payment Confirmation & Invoice</h2>
  <p>Hello <strong>${escapeHtml(customerName)}</strong>,</p>
  <p>Thank you for your payment! Your subscription is active.</p>
  <table style="border-collapse: collapse; width: 100%; max-width: 500px; margin: 20px 0;">
    <tr style="background: #f4f4f4;"><td style="padding: 8px; border: 1px solid #ddd;"><strong>Plan</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(planName)}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Amount Paid</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(formattedAmount)}</td></tr>
    <tr style="background: #f4f4f4;"><td style="padding: 8px; border: 1px solid #ddd;"><strong>Date</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(formattedDate)}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Invoice Number</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(invoiceNumber)}</td></tr>
  </table>
  <p>
    <a href="${escapeHtml(signedDownloadUrl)}" style="background-color: #0066cc; color: white; padding: 10px 18px; text-decoration: none; border-radius: 4px; display: inline-block;">
      Download PDF Invoice
    </a>
  </p>
  <p style="font-size: 12px; color: #666;">Note: The download link above expires in ${env.INVOICE_LINK_TTL_HOURS} hours.</p>
  <br>
  <p>Best regards,<br>The ${escapeHtml(env.COMPANY_NAME)} Team</p>
</body>
</html>`;

  await transporter.sendMail({
    from: env.MAIL_FROM,
    to,
    subject: `Receipt & Invoice ${invoiceNumber} - ${env.COMPANY_NAME}`,
    text: textBody,
    html: htmlBody,
    attachments: [
      {
        filename: path.basename(invoicePath),
        path: invoicePath,
      },
    ],
  });
}

export async function sendReminderEmail({
  to,
  name,
  plan,
  endDate,
  cancelAtPeriodEnd,
}) {
  const customerName = name || 'Valued Customer';
  const planName = plan || 'SaaS Subscription';
  const formattedDate = endDate ? new Date(endDate).toUTCString() : 'soon';

  let subject = `Renewal Reminder: Your ${planName} subscription renews on ${formattedDate}`;
  let textContent = `Hello ${customerName},\n\nThis is a friendly reminder that your ${planName} subscription will automatically renew on ${formattedDate}.\n\nThank you for choosing ${env.COMPANY_NAME}!`;
  let htmlContent = `<p>Hello <strong>${escapeHtml(customerName)}</strong>,</p><p>This is a friendly reminder that your <strong>${escapeHtml(planName)}</strong> subscription will automatically renew on <strong>${escapeHtml(formattedDate)}</strong>.</p><p>Thank you for choosing ${escapeHtml(env.COMPANY_NAME)}!</p>`;

  if (cancelAtPeriodEnd) {
    subject = `Notice: Your ${planName} subscription will expire on ${formattedDate}`;
    textContent = `Hello ${customerName},\n\nYour ${planName} subscription is scheduled to expire on ${formattedDate}. If you wish to continue service, please reactivate your subscription prior to expiration.\n\nThank you for choosing ${env.COMPANY_NAME}!`;
    htmlContent = `<p>Hello <strong>${escapeHtml(customerName)}</strong>,</p><p>Your <strong>${escapeHtml(planName)}</strong> subscription is set to expire on <strong>${escapeHtml(formattedDate)}</strong>.</p><p>If you wish to continue service, please update your billing settings before then.</p><p>Thank you for choosing ${escapeHtml(env.COMPANY_NAME)}!</p>`;
  }

  await transporter.sendMail({
    from: env.MAIL_FROM,
    to,
    subject,
    text: textContent,
    html: htmlContent,
  });
}
