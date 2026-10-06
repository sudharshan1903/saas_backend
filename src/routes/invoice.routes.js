import { Router } from 'express';
import { downloadInvoice } from '../controllers/invoice.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/invoices/:id/download', asyncHandler(downloadInvoice));

export default router;
