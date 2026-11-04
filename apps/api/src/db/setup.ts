import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { transaction, type Pool } from "./pool.js";
import { hashPassword } from "../modules/auth/password.js";
export async function migrate(pool: Pool) {
  await transaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(48123001)");
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const directory = fileURLToPath(
      new URL("../../migrations/", import.meta.url),
    );
    for (const name of (await readdir(directory))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      if (
        (
          await db.query("SELECT 1 FROM schema_migrations WHERE name=$1", [
            name,
          ])
        ).rowCount
      )
        continue;
      await db.query(await readFile(`${directory}/${name}`, "utf8"));
      await db.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    }
  });
}
export async function seed(pool: Pool) {
  const password = await hashPassword("Demo-2026!");
  await transaction(pool, async (db) => {
    await db.query(
      "INSERT INTO workspaces VALUES ('alpha','Alpha'),('beta','Beta') ON CONFLICT DO NOTHING",
    );
    const accounts = [
      ["initiator.alpha", "Инициатор Alpha", "alpha", true, false],
      ["approver.alpha", "Согласующий Alpha", "alpha", false, true],
      ["initiator.beta", "Инициатор Beta", "beta", true, false],
      ["universal.alpha", "Универсальный Alpha", "alpha", true, true],
    ];
    for (const [login, name, workspace, create, approve] of accounts)
      await db.query(
        "INSERT INTO users(id,login,name,password_hash,workspace_id,can_create,can_approve) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(login) DO NOTHING",
        [randomUUID(), login, name, password, workspace, create, approve],
      );
    await db.query(
      `INSERT INTO resources VALUES ('res-a-01','alpha','Хранилище A','2027-03-01',128000,'RUB'),('res-a-02','alpha','Сервис B','2027-05-20',250000,'RUB'),('res-b-01','beta','Сервис C','2027-06-01',150000,'RUB') ON CONFLICT DO NOTHING`,
    );
  });
}
