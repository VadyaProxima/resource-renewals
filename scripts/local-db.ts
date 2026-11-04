import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const databaseDir = resolve(".data/postgres");
const postgres = new EmbeddedPostgres({
  databaseDir,
  user: "renewals",
  password: "renewals_local",
  port: 5433,
  persistent: true,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: (message) => {
    if (/FATAL|ERROR/.test(message)) console.error(message);
  },
  onError: console.error,
});
if (!existsSync(resolve(databaseDir, "PG_VERSION")))
  await postgres.initialise();
await postgres.start();
const client = postgres.getPgClient();
await client.connect();
if (
  !(await client.query("SELECT 1 FROM pg_database WHERE datname='renewals'"))
    .rowCount
)
  await client.query("CREATE DATABASE renewals");
await client.end();
console.log("PostgreSQL: 127.0.0.1:5433 / renewals. Для остановки: Ctrl+C.");
let closing = false;
const keepAlive = setInterval(() => {}, 60000);
async function stop() {
  if (closing) return;
  closing = true;
  clearInterval(keepAlive);
  await postgres.stop();
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
