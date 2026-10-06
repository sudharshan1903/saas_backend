import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { createCheckout, handleCheckoutSuccess, handleCheckoutCancel } from '../controllers/checkout.controller.js';
import { validateRequest } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many checkout creation attempts from this IP. Please try again later.',
    },
  },
});

const checkoutSchema = z.object({
  email: z.string().email('Valid email address is required').transform((v) => v.toLowerCase().trim()),
  name: z.string().min(1, 'Customer name is required').trim(),
});

router.post('/checkout', checkoutLimiter, validateRequest(checkoutSchema), asyncHandler(createCheckout));
router.get('/checkout/success', handleCheckoutSuccess);
router.get('/checkout/cancel', handleCheckoutCancel);

export default router;
