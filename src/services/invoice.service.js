import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import PDFDocument from 'pdfkit';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import {
  findInvoiceByPaymentId,
  findInvoiceById,
  createInvoiceRecord,
  getNextInvoiceNumber,
} from '../repositories/invoice.repo.js';
import { findPaymentDetailsForInvoice } from '../repositories/payment.repo.js';
import { centsToCurrency } from '../utils/money.js';
import { AppError } from '../utils/AppError.js';
import { UnrecoverableError } from 'bullmq';

const invoiceDir = path.resolve(process.cwd(), env.INVOICE_DIR);

async function ensureInvoiceDir() {
  await fs.mkdir(invoiceDir, { recursive: true });
}

export async function ensureInvoiceForPayment(paymentId, db = pool) {
  await ensureInvoiceDir();

  const payment = await findPaymentDetailsForInvoice(paymentId, db);
  if (!payment) {
    throw new UnrecoverableError(`Payment ${paymentId} was not found in database`);
  }

  let existing = await findInvoiceByPaymentId(paymentId, db);
  let fileName = existing?.file_path ? path.basename(existing.file_path) : null;
  let fullPath = fileName ? path.join(invoiceDir, fileName) : null;

  let pdfExists = false;
  if (fullPath) {
    try {
      await fs.access(fullPath);
      pdfExists = true;
    } catch {
      pdfExists = false;
    }
  }

  if (existing && pdfExists) {
    return { ...existing, fullPath };
  }

  const invoiceNumber = existing?.invoice_number || (await getNextInvoiceNumber(db));
  fileName = `${String(invoiceNumber).replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
  fullPath = path.join(invoiceDir, fileName);
  const tempPath = `${fullPath}.${randomUUID()}.tmp`;

  const doc = new PDFDocument({ margin: 50 });
  const outputStream = createWriteStream(tempPath, { flags: 'wx' });

  doc.fontSize(24).text(env.COMPANY_NAME, { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(16).text('Official Payment Invoice', { align: 'center' });
  doc.moveDown(1.5);

  doc.fontSize(12).text(`Invoice Number: ${invoiceNumber}`);
  doc.text(`Invoice Date: ${new Date().toISOString().split('T')[0]}`);
  doc.text(`Payment ID: ${payment.id}`);
  doc.moveDown();

  doc.text(`Customer Name: ${payment.user_name || 'Valued Customer'}`);
  doc.text(`Customer Email: ${payment.user_email || 'N/A'}`);
  doc.text(`Subscription Plan: ${payment.plan || 'Subscription'}`);
  doc.text(`Payment Status: ${payment.status.toUpperCase()}`);
  doc.moveDown();

  const amountStr = centsToCurrency(payment.amount_cents, payment.currency);
  doc.fontSize(14).text(`Total Amount Paid: ${amountStr}`, { underline: true });
  doc.moveDown(2);

  doc.fontSize(10).text('Thank you for your business!', { align: 'center' });
  doc.end();

  try {
    await pipeline(doc, outputStream);
    await fs.rm(fullPath, { force: true });
    await fs.rename(tempPath, fullPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }

  const record = await createInvoiceRecord(
    {
      paymentId: payment.id,
      subscriptionId: payment.subscription_id,
      invoiceNumber,
      filePath: fileName,
      amountCents: payment.amount_cents,
    },
    db,
  );

  return { ...record, fullPath };
}

export async function getInvoiceForDownload(invoiceId, db = pool) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoiceId);
  if (!isUuid) {
    throw new AppError('INVALID_ID', 'Invoice ID must be a valid UUID', 400);
  }

  let invoice = await findInvoiceById(invoiceId, db);
  if (!invoice) {
    throw new AppError('INVOICE_NOT_FOUND', 'Invoice not found', 404);
  }

  if (!invoice.payment_id) {
    throw new AppError('INVOICE_PAYMENT_MISSING', 'Invoice missing associated payment', 400);
  }

  const result = await ensureInvoiceForPayment(invoice.payment_id, db);
  const fullPath = result.fullPath;

  let buffer;
  try {
    buffer = await fs.readFile(fullPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new AppError('INVOICE_FILE_MISSING', 'Invoice PDF file could not be generated or found', 404);
    }
    throw error;
  }

  return { filePath: fullPath, fileName: path.basename(fullPath), buffer, invoice: result };
}
