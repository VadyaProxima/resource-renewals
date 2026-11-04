import { z } from "zod";
const positive = z.coerce.number().int().positive();
const env = z
  .object({
    DATABASE_URL: z
      .string()
      .default("postgres://renewals:renewals_local@127.0.0.1:5433/renewals"),
    PORT: positive.default(3001),
    APP_ORIGIN: z.url().default("http://localhost:5173"),
    PROVIDER_URL: z.url().default("http://127.0.0.1:8091"),
    PROVIDER_TIMEOUT_MS: positive.default(3000),
    RETRY_DELAY_MS: positive.default(15000),
    WORKER_POLL_MS: positive.default(500),
    WORKER_ENABLED: z.enum(["true", "false"]).default("true"),
    COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  })
  .parse(process.env);
export const config = {
  databaseUrl: env.DATABASE_URL,
  port: env.PORT,
  origin: env.APP_ORIGIN,
  providerUrl: env.PROVIDER_URL,
  providerTimeoutMs: env.PROVIDER_TIMEOUT_MS,
  retryDelayMs: env.RETRY_DELAY_MS,
  pollMs: env.WORKER_POLL_MS,
  workerEnabled: env.WORKER_ENABLED === "true",
  cookieSecure: env.COOKIE_SECURE === "true",
};
export type Config = typeof config;
