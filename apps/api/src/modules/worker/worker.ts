import type { Renewal } from "@renewals/contracts";
import type { Client, Pool } from "../../db/pool.js";
import type { Provider, ProviderResult } from "../provider/client.js";
import { history } from "../renewals/service.js";
interface Job extends Renewal {
  post_attempts: number;
  cycle_attempts: number;
}
// Session advisory locks span HTTP, but no SQL transaction is held during network IO.
// A process crash releases the lock immediately. The durable due date survives it.
export class Worker {
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopped = true;
  constructor(
    private pool: Pool,
    private provider: Provider,
    private delay: number,
    private poll: number,
    private onError: (error: unknown) => void = console.error,
  ) {}
  start() {
    this.stopped = false;
    this.schedule(0);
  }
  private schedule(delay: number) {
    this.timer = setTimeout(() => {
      this.running = this.tick()
        .catch(this.onError)
        .finally(() => {
          if (!this.stopped) this.schedule(this.poll);
        });
    }, delay);
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }
  async tick() {
    const candidates = (
      await this.pool.query(
        `SELECT renewal_id FROM renewal_jobs WHERE NOT done AND next_attempt_at<=now() ORDER BY next_attempt_at LIMIT 20`,
      )
    ).rows;
    for (const { renewal_id: id } of candidates) await this.process(id);
  }
  async process(id: string) {
    const db = await this.pool.connect();
    let locked = false;
    try {
      locked = (
        await db.query(
          "SELECT pg_try_advisory_lock(48123,hashtext($1)) locked",
          [id],
        )
      ).rows[0].locked;
      if (!locked) return;
      const row = (
        await db.query<Job>(
          `SELECT n.*,j.post_attempts,j.cycle_attempts FROM renewals n JOIN renewal_jobs j ON j.renewal_id=n.id WHERE n.id=$1 AND n.status='processing' AND NOT j.done AND j.next_attempt_at<=now()`,
          [id],
        )
      ).rows[0];
      if (!row) return;
      // Every recovery first reconciles an earlier POST, including the third attempt.
      if (row.post_attempts > 0) {
        const known = await this.provider.lookup(row);
        if (known) {
          await this.complete(db, row, known);
          return;
        }
      }
      if (row.cycle_attempts >= 3) {
        await this.attention(db, row);
        return;
      }
      await this.inTransaction(db, async () => {
        // Persist the budget BEFORE POST: a crash cannot create uncounted attempts.
        await db.query(
          "UPDATE renewal_jobs SET post_attempts=post_attempts+1,cycle_attempts=cycle_attempts+1,next_attempt_at=now()+($2::int*interval '1 millisecond') WHERE renewal_id=$1",
          [id, this.delay],
        );
        await history(
          db,
          id,
          null,
          "processing",
          "processing",
          `Отправка провайдеру: попытка ${row.cycle_attempts + 1} из 3`,
        );
      });
      const result = await this.provider.send(row);
      if (result) await this.complete(db, row, result);
      else
        await this.inTransaction(db, async () => {
          // Delay is counted after the uncertain response, not before the network call.
          await db.query(
            "UPDATE renewal_jobs SET next_attempt_at=now()+($2::int*interval '1 millisecond') WHERE renewal_id=$1",
            [id, this.delay],
          );
          await history(
            db,
            id,
            null,
            "processing",
            "processing",
            "Подтверждение не получено. Результат неизвестен; проверка запланирована",
          );
        });
    } finally {
      try {
        if (locked)
          await db.query("SELECT pg_advisory_unlock(48123,hashtext($1))", [id]);
      } finally {
        db.release();
      }
    }
  }
  private async inTransaction(db: Client, work: () => Promise<void>) {
    await db.query("BEGIN");
    try {
      await work();
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  }
  private async attention(db: Client, row: Job) {
    await this.inTransaction(db, async () => {
      await db.query(
        "UPDATE renewals SET status='attention' WHERE id=$1 AND status='processing'",
        [row.id],
      );
      await db.query(
        "UPDATE renewal_jobs SET next_attempt_at=NULL WHERE renewal_id=$1",
        [row.id],
      );
      await history(
        db,
        row.id,
        null,
        "processing",
        "attention",
        "После трех попыток результат не подтвержден. Требуется проверка и повтор согласующим",
      );
    });
  }
  private async complete(db: Client, row: Job, result: ProviderResult) {
    await this.inTransaction(db, async () => {
      await db.query("SELECT id FROM resources WHERE id=$1 FOR UPDATE", [
        row.resource_id,
      ]);
      const current = (
        await db.query("SELECT status FROM renewals WHERE id=$1 FOR UPDATE", [
          row.id,
        ])
      ).rows[0];
      if (current.status !== "processing") return;
      // Set the fixed snapshot date, never add 30 to a mutable current date.
      await db.query("UPDATE resources SET expires_on=$2 WHERE id=$1", [
        row.resource_id,
        row.new_expires_on,
      ]);
      await db.query(
        "UPDATE renewals SET status='completed',provider_operation_id=$2 WHERE id=$1",
        [row.id, result.operation_id],
      );
      await db.query(
        "UPDATE renewal_jobs SET done=true,next_attempt_at=NULL WHERE renewal_id=$1",
        [row.id],
      );
      await history(
        db,
        row.id,
        null,
        "processing",
        "completed",
        "Провайдер подтвердил операцию. Срок ресурса обновлен",
      );
    });
  }
}
