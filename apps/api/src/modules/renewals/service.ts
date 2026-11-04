import { randomUUID } from "node:crypto";
import type { User, Renewal, Resource } from "@renewals/contracts";
import { transaction, type Client, type Pool } from "../../db/pool.js";
import { requireCondition } from "../../shared/errors.js";
const selectRenewals = `SELECT n.*,r.name resource_name,u.name creator_name FROM renewals n JOIN resources r ON r.id=n.resource_id JOIN users u ON u.id=n.created_by`;
export async function history(
  db: Client,
  id: string,
  actor: string | null,
  from: string | null,
  to: string,
  message: string,
) {
  await db.query(
    "INSERT INTO renewal_history(renewal_id,actor_id,from_status,to_status,message) VALUES($1,$2,$3,$4,$5)",
    [id, actor, from, to, message],
  );
}
export class RenewalService {
  constructor(private pool: Pool) {}
  async resource(
    user: User,
    id: string,
    db: Pool | Client = this.pool,
    lock = false,
  ) {
    const row = (
      await db.query<Resource>(
        "SELECT * FROM resources WHERE id=$1" + (lock ? " FOR UPDATE" : ""),
        [id],
      )
    ).rows[0];
    requireCondition(row, 404, "Ресурс не найден");
    requireCondition(
      row.workspace_id === user.workspace_id,
      403,
      "Нет доступа к пространству",
    );
    return row;
  }
  async resources(user: User) {
    return (
      await this.pool.query<Resource>(
        `SELECT r.*,n.id active_request_id,n.status active_status FROM resources r LEFT JOIN renewals n ON n.resource_id=r.id AND n.status IN ('pending','processing','attention') WHERE r.workspace_id=$1 ORDER BY r.id`,
        [user.workspace_id],
      )
    ).rows;
  }
  async list(user: User, resourceId?: string) {
    if (resourceId) await this.resource(user, resourceId);
    return (
      await this.pool.query<Renewal>(
        `${selectRenewals} WHERE n.workspace_id=$1 ${resourceId ? "AND n.resource_id=$2" : ""} ORDER BY n.created_at DESC,n.id`,
        resourceId ? [user.workspace_id, resourceId] : [user.workspace_id],
      )
    ).rows;
  }
  async get(user: User, id: string) {
    const row = (
      await this.pool.query<Renewal>(`${selectRenewals} WHERE n.id=$1`, [id])
    ).rows[0];
    requireCondition(row, 404, "Заявка не найдена");
    requireCondition(
      row.workspace_id === user.workspace_id,
      403,
      "Нет доступа к пространству",
    );
    const entries = (
      await this.pool.query(
        `SELECT h.id::text,h.from_status,h.to_status,h.message,h.created_at,COALESCE(u.name,'Фоновый обработчик') actor_name FROM renewal_history h LEFT JOIN users u ON u.id=h.actor_id WHERE h.renewal_id=$1 ORDER BY h.id`,
        [id],
      )
    ).rows;
    const job = (
      await this.pool.query(
        "SELECT post_attempts,cycle_attempts,next_attempt_at FROM renewal_jobs WHERE renewal_id=$1",
        [id],
      )
    ).rows[0];
    return {
      ...row,
      history: entries,
      post_attempts: job?.post_attempts ?? 0,
      cycle_attempts: job?.cycle_attempts ?? 0,
      next_attempt_at: job?.next_attempt_at ?? null,
    };
  }
  async create(user: User, resourceId: string) {
    requireCondition(user.can_create, 403, "Нет права создавать заявки");
    return transaction(this.pool, async (db) => {
      const resource = await this.resource(user, resourceId, db, true);
      const id = randomUUID();
      const row = (
        await db.query(
          `INSERT INTO renewals(id,resource_id,workspace_id,created_by,old_expires_on,new_expires_on,amount_minor,currency,operation_key) VALUES($1,$2,$3,$4,$5::date,$5::date+30,$6,$7,$8) RETURNING *`,
          [
            id,
            resourceId,
            user.workspace_id,
            user.id,
            resource.expires_on,
            resource.amount_minor,
            resource.currency,
            `renewal:${id}`,
          ],
        )
      ).rows[0];
      await history(
        db,
        id,
        user.id,
        null,
        "pending",
        "Создана заявка на продление на 30 календарных дней",
      );
      return row;
    });
  }
  async action(user: User, id: string, action: "approve" | "reject" | "retry") {
    requireCondition(user.can_approve, 403, "Нет права согласования");
    return transaction(this.pool, async (db) => {
      const initial = (
        await db.query<Renewal>("SELECT * FROM renewals WHERE id=$1", [id])
      ).rows[0];
      requireCondition(initial, 404, "Заявка не найдена");
      requireCondition(
        initial.workspace_id === user.workspace_id,
        403,
        "Нет доступа к пространству",
      );
      // Every workflow acquires resource before renewal to avoid lock inversion.
      const resource = await this.resource(user, initial.resource_id, db, true);
      const row = (
        await db.query<Renewal>(
          "SELECT * FROM renewals WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      requireCondition(row, 404, "Заявка не найдена");
      requireCondition(
        action === "retry" || row.created_by !== user.id,
        403,
        "Нельзя согласовать или отклонить собственную заявку",
      );
      requireCondition(
        row.status === (action === "retry" ? "attention" : "pending"),
        409,
        "Состояние заявки уже изменилось. Обновите данные",
      );
      if (action === "approve") {
        requireCondition(
          resource.expires_on === row.old_expires_on &&
            resource.amount_minor === row.amount_minor &&
            resource.currency === row.currency,
          409,
          "Срок или стоимость ресурса изменились. Отклоните заявку и создайте новую",
        );
        await db.query(
          "INSERT INTO renewal_jobs(renewal_id,next_attempt_at) VALUES($1,now())",
          [id],
        );
      }
      if (action === "retry")
        await db.query(
          "UPDATE renewal_jobs SET cycle_attempts=0,next_attempt_at=now(),done=false WHERE renewal_id=$1",
          [id],
        );
      const status = action === "reject" ? "rejected" : "processing";
      await db.query(
        "UPDATE renewals SET status=$2,approved_by=$3 WHERE id=$1",
        [id, status, user.id],
      );
      await history(
        db,
        id,
        user.id,
        row.status,
        status,
        action === "reject"
          ? "Заявка отклонена"
          : action === "retry"
            ? "Повторная обработка с прежним ключом операции"
            : "Заявка согласована, задача сохранена",
      );
      return { id, status };
    });
  }
}
