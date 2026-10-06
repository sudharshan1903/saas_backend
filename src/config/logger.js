import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { env } from './env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');
const loggerDir = path.join(projectRoot, 'logger');

if (!fs.existsSync(loggerDir)) {
  fs.mkdirSync(loggerDir, { recursive: true });
}

const logFilePath = path.join(loggerDir, 'app.log');

// If process runs under MCP (LOG_TO_STDERR === '1'), direct logs to stderr.
// Otherwise, write all log messages (info, warn, error) to logger/app.log.
const destination = process.env.LOG_TO_STDERR === '1'
  ? process.stderr
  : pino.destination({ dest: logFilePath, sync: true, mkdir: true });

export const logger = pino(
  {
    level: env.LOG_LEVEL,
    redact: ['req.headers["x-api-key"]', 'req.headers.authorization', 'password', 'stripeSecretKey'],
  },
  destination,
);

export const httpLogger = pinoHttp({
  logger,
  customLogLevel(req, res, err) {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  autoLogging: {
    ignore: (req) => ['/health', '/ready'].includes(req.url),
  },
});
