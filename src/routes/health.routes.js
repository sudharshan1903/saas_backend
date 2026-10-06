import { Router } from 'express';
import { getHealth, getReadiness } from '../controllers/health.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/health', getHealth);
router.get('/ready', asyncHandler(getReadiness));

export default router;
