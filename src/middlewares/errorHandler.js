import { AppError } from '../utils/AppError.js';
import { logger } from '../config/logger.js';

export function errorHandler(error, req, res, _next) {
  const requestId = req.id || null;

  // Handle malformed JSON body parser errors
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid JSON payload format',
        requestId,
      },
    });
  }

  if (error instanceof AppError) {
    return res.status(error.statusCode || 500).json({
      error: {
        code: error.code,
        message: error.message,
        requestId,
        ...(error.details ? { details: error.details } : {}),
      },
    });
  }

  const statusCode = Number(error.statusCode || error.status || 500);
  const isClientError = statusCode >= 400 && statusCode < 500;

  if (!isClientError) {
    logger.error({ err: error, requestId, url: req.originalUrl }, 'Unhandled internal server error');
  }

  res.status(statusCode).json({
    error: {
      code: isClientError ? 'BAD_REQUEST' : 'INTERNAL_ERROR',
      message: isClientError ? error.message : 'Internal server error occurred',
      requestId,
    },
  });
}
