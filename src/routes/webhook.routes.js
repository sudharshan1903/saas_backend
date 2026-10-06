import express, { Router } from 'express';
import { handleStripeWebhook } from '../controllers/webhook.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Mount express.raw handler BEFORE any express.json body parsers
router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), asyncHandler(handleStripeWebhook));

export default router;
