import { AppError } from '../utils/AppError.js';

export function validateRequest(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      return next(new AppError('VALIDATION_ERROR', 'Invalid request payload', 400, details));
    }
    req[source] = result.data;
    next();
  };
}
