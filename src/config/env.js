import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from 'dotenv';
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");

// Try loading src/.env.development, .env.development, or .env
const envCandidates = [
  path.join(projectRoot, "src/.env.development"),
  path.join(projectRoot, ".env.development"),
  path.join(projectRoot, ".env"),
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, quiet: true });
  }
}

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  STRIPE_SECRET_KEY: z.string().min(1, "STRIPE_SECRET_KEY is required"),
  STRIPE_WEBHOOK_SECRET: z.string().min(1, "STRIPE_WEBHOOK_SECRET is required"),
  STRIPE_PRICE_ID: z.string().min(1, "STRIPE_PRICE_ID is required"),
  CHECKOUT_SUCCESS_URL: z
    .string()
    .url()
    .default("http://localhost:3000/checkout/success"),
  CHECKOUT_CANCEL_URL: z
    .string()
    .url()
    .default("http://localhost:3000/checkout/cancel"),
  MAIL_HOST: z.string().default("smtp.mailtrap.io"),
  MAIL_PORT: z.coerce.number().default(587),
  MAIL_USER: z.string().default(""),
  MAIL_PASS: z.string().default(""),
  MAIL_FROM: z.string().default("SaaS Platform <noreply@example.com>"),
  ADMIN_API_KEY: z
    .string()
    .min(16, "ADMIN_API_KEY must be at least 16 characters long")
    .default("replace-with-strong-secret"),
  INVOICE_LINK_SECRET: z
    .string()
    .min(16)
    .default(process.env.ADMIN_API_KEY || "replace-with-strong-secret"),
  INVOICE_LINK_TTL_HOURS: z.coerce.number().default(24),
  CRON_SCHEDULE: z.string().default("0 9 * * *"),
  CRON_TIMEZONE: z.string().default("UTC"),
  CRON_RUN_ON_START: z.coerce.boolean().default(false),
  REMINDER_DAYS_BEFORE: z.coerce.number().default(7),
  EXPIRY_GRACE_HOURS: z.coerce.number().default(24),
  STATS_CACHE_TTL_SECONDS: z.coerce.number().default(300),
  INVOICE_DIR: z.string().default("./invoices"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000,http://localhost:5173"),
  WORKER_CONCURRENCY: z.coerce.number().default(2),
  COMPANY_NAME: z.string().default("SaaS Platform Inc."),
  DEFAULT_CURRENCY: z.string().length(3).default("usd"),
});

const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  console.error("❌ Environment validation failed:");
  for (const issue of parseResult.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parseResult.data;
