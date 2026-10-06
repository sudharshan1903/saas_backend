import { Router } from 'express';
import { getStats } from '../controllers/stats.controller.js';
import { requireApiKey } from '../middlewares/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/stats', requireApiKey, asyncHandler(getStats));

export default router;
