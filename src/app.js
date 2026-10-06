import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { httpLogger } from './config/logger.js';
import { requestIdMiddleware } from './middlewares/requestId.js';
import { notFoundHandler } from './middlewares/notFound.js';
import { errorHandler } from './middlewares/errorHandler.js';

import webhookRoutes from './routes/webhook.routes.js';
import checkoutRoutes from './routes/checkout.routes.js';
import statsRoutes from './routes/stats.routes.js';
import invoiceRoutes from './routes/invoice.routes.js';
import healthRoutes from './routes/health.routes.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');

  // Attach unique Request ID
  app.use(requestIdMiddleware);

  // Attach HTTP request logger
  app.use(httpLogger);

  // CORS Configuration
  const allowedOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
          return callback(null, true);
        }
        callback(new Error('Origin not allowed by CORS'));
      },
      credentials: true,
    }),
  );

  // Global Rate Limiter
  const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many requests from this IP. Please try again later.',
      },
    },
  });
  app.use(globalLimiter);

  // Health and Readiness Routes (unparsed body)
  app.use('/', healthRoutes);

  // Stripe Webhooks Route (raw body buffer mounted BEFORE express.json())
  app.use('/api', webhookRoutes);

  // JSON Body Parser for all other endpoints
  app.use(express.json({ limit: '100kb' }));

  // API Routes
  app.use('/api', checkoutRoutes);
  app.use('/api', statsRoutes);
  app.use('/api', invoiceRoutes);

  // Landing page routes
  app.use('/', checkoutRoutes);

  // 404 Route Handler
  app.use(notFoundHandler);

  // Global Error Handler
  app.use(errorHandler);

  return app;
}

export default createApp;
