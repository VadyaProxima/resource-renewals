import { createHash, randomBytes } from "node:crypto";
import type { User } from "@renewals/contracts";
import type { Pool } from "../../db/pool.js";
import { requireCondition } from "../../shared/errors.js";
import { hashPassword, verifyPassword } from "./password.js";
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const userSelect =
  "SELECT u.id,u.name,u.workspace_id,w.name workspace_name,u.can_create,u.can_approve FROM users u JOIN workspaces w ON w.id=u.workspace_id";
export class AuthService {
  private dummy = hashPassword("not-a-real-password");
  constructor(private pool: Pool) {}
  async login(login: string, password: string) {
    const { rows } = await this.pool.query<{
      id: string;
      password_hash: string;
    }>("SELECT id,password_hash FROM users WHERE login=$1", [login]);
    const valid = await verifyPassword(
      password,
      rows[0]?.password_hash ?? (await this.dummy),
    );
    requireCondition(rows[0] && valid, 401, "Неверный логин или пароль");
    const token = randomBytes(32).toString("hex");
    await this.pool.query(
      "INSERT INTO sessions VALUES($1,$2,now()+interval '8 hours')",
      [digest(token), rows[0].id],
    );
    return {
      token,
      user: (
        await this.pool.query<User>(`${userSelect} WHERE u.id=$1`, [rows[0].id])
      ).rows[0]!,
    };
  }
  async authenticate(token?: string): Promise<User> {
    requireCondition(
      token && /^[a-f0-9]{64}$/.test(token),
      401,
      "Войдите в учетную запись",
    );
    const { rows } = await this.pool.query<User>(
      `${userSelect} JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()`,
      [digest(token)],
    );
    requireCondition(rows[0], 401, "Сессия истекла. Войдите снова");
    return rows[0];
  }
  async logout(token: string) {
    await this.pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      digest(token),
    ]);
  }
}
