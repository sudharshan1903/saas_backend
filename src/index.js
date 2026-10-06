import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { closeDb } from './config/db.js';
import { closeRedis } from './config/redis.js';
import { logger } from './config/logger.js';
import { AppError } from './utils/AppError.js';
import webhookRoutes from './routes/webhook.routes.js';
import checkoutRoutes from './routes/checkout.routes.js';
import statsRoutes from './routes/stats.routes.js';
import invoiceRoutes from './routes/invoice.routes.js';

const app = express();

app.use(express.json());
app.disable('x-powered-by');
app.use(
  cors({
    origin: (origin, callback) => {
      const allowed = (process.env.CORS_ORIGINS || 'http://localhost:3000')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (!origin || allowed.includes(origin) || allowed.includes('*')) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
  }),
);
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.use('/api', webhookRoutes);
app.use('/api', checkoutRoutes);
app.use('/api', statsRoutes);
app.use('/api', invoiceRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Route not found: ${req.originalUrl}` } });
});

app.use((error, _req, res, _next) => {
  if (error instanceof AppError) {
    return res.status(error.statusCode || 500).json({
      success: false,
      error: { code: error.code, message: error.message, details: error.details },
    });
  }

  const statusCode = Number(error.statusCode || 500);
  const isClientError = statusCode >= 400 && statusCode < 500;
  if (!isClientError) logger.error({ err: error }, 'Unhandled request error');
  res.status(statusCode).json({
    success: false,
    error: {
      code: isClientError ? 'BAD_REQUEST' : 'INTERNAL_ERROR',
      message: isClientError ? error.message : 'Internal server error',
    },
  });
});

const port = Number(process.env.PORT);
const server = app.listen(port, () => {
  console.log(`SaaS backend listening on port ${port}`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down HTTP server');
  server.close((error) => {
    Promise.all([closeDb(), closeRedis()])
      .then(() => process.exit(error ? 1 : 0))
      .catch((shutdownError) => {
        logger.error({ err: shutdownError }, 'HTTP server shutdown failed');
        process.exit(1);
      });
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
