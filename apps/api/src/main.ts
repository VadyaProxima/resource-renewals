import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { serveWeb } from "./shared/serve-web.js";
import { config } from "./config.js";
import { createPool } from "./db/pool.js";
import { createApp } from "./app.js";
import { ProviderClient } from "./modules/provider/client.js";
import { Worker } from "./modules/worker/worker.js";
const pool = createPool(config.databaseUrl);
const app = await createApp(pool, config, true);
const worker = new Worker(
  pool,
  new ProviderClient(config.providerUrl, config.providerTimeoutMs),
  config.retryDelayMs,
  config.pollMs,
  () => app.log.error("Worker failed; durable job will be retried"),
);
const webRoot = resolve(
  process.cwd().endsWith("api") ? "../web/dist" : "apps/web/dist",
);
if (existsSync(webRoot)) serveWeb(app, webRoot);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await worker.stop();
  await app.close();
  await pool.end();
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
try {
  await app.listen({ host: "127.0.0.1", port: config.port });
  if (config.workerEnabled) worker.start();
} catch {
  app.log.error("Cannot start application");
  await shutdown();
  process.exitCode = 1;
}
