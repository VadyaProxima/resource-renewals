import EmbeddedPostgres from "embedded-postgres";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createPool } from "../apps/api/src/db/pool.js";
import { migrate, seed } from "../apps/api/src/db/setup.js";
import { createApp } from "../apps/api/src/app.js";
import { config } from "../apps/api/src/config.js";
import { serveWeb } from "../apps/api/src/shared/serve-web.js";
import { Worker } from "../apps/api/src/modules/worker/worker.js";
import { ProviderClient } from "../apps/api/src/modules/provider/client.js";

const database = new EmbeddedPostgres({
  databaseDir: resolve(`.data/e2e-${randomUUID()}`),
  user: "renewals",
  password: "renewals_local",
  port: 55433,
  persistent: false,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: console.error,
});
await database.initialise();
await database.start();
await database.createDatabase("renewals_e2e");
const pool = createPool(
  "postgres://renewals:renewals_local@127.0.0.1:55433/renewals_e2e",
);
await migrate(pool);
await seed(pool);
const provider = spawn(
  "python",
  [
    "-c",
    "import runpy; m=runpy.run_path('provider_simulator.py'); m['ThreadingHTTPServer'](('127.0.0.1',18092),m['Handler']).serve_forever()",
  ],
  { stdio: "ignore" },
);
const settings = { ...config, port: 13002, origin: "http://127.0.0.1:13002" };
const app = await createApp(pool, settings);
serveWeb(app, resolve("apps/web/dist"));
const worker = new Worker(
  pool,
  new ProviderClient("http://127.0.0.1:18092", 1000),
  75,
  25,
);
await app.listen({ host: "127.0.0.1", port: 13002 });
worker.start();
console.log("E2E server ready");
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  await worker.stop();
  await app.close();
  provider.kill();
  await pool.end();
  await database.stop();
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
