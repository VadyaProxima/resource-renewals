import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { z, ZodError } from "zod";
import type { User } from "@renewals/contracts";
import type { Pool } from "./db/pool.js";
import type { Config } from "./config.js";
import { AuthService } from "./modules/auth/service.js";
import { RenewalService } from "./modules/renewals/service.js";
import { HttpError } from "./shared/errors.js";
declare module "fastify" {
  interface FastifyRequest {
    user: User;
  }
}
const idSchema = z.object({ id: z.uuid() });
export async function createApp(pool: Pool, config: Config, logging = false) {
  const app = Fastify({
    logger: logging
      ? {
          level: "info",
          redact: [
            "req.headers.cookie",
            "req.headers.authorization",
            "res.headers.set-cookie",
          ],
          serializers: {
            req: (req) => ({ method: req.method, url: req.url.split("?")[0] }),
          },
        }
      : false,
    bodyLimit: 16384,
  });
  const auth = new AuthService(pool);
  const renewals = new RenewalService(pool);
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  await app.register(rateLimit, { global: false });
  app.decorateRequest("user");
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({ message: "Некорректные данные запроса" });
    if ((error as { code?: string }).code === "23505")
      return reply.code(409).send({
        message: "Для ресурса уже существует активная заявка или операция",
      });
    if (error instanceof HttpError)
      return reply.code(error.statusCode).send({ message: error.message });
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500)
      return reply.code(status).send({
        message:
          status === 429
            ? "Слишком много попыток. Попробуйте позже"
            : "Некорректный запрос",
      });
    // Log only classification, never bodies, tokens, operation keys or provider responses.
    request.log.error(
      { code: (error as { code?: string }).code ?? "internal" },
      "Request failed",
    );
    return reply
      .code(500)
      .send({ message: "Внутренняя ошибка. Попробуйте позже" });
  });
  app.addHook("onRequest", (req, _reply, done) => {
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== config.origin
    )
      done(new HttpError(403, "Недопустимый источник запроса"));
    else done();
  });
  app.get("/api/health", async () => {
    await pool.query("SELECT 1");
    return { status: "ok" };
  });
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = z
        .object({
          login: z.string().min(1).max(100),
          password: z.string().min(1).max(200),
        })
        .strict()
        .parse(req.body);
      const { token, user } = await auth.login(body.login, body.password);
      reply.header("Cache-Control", "no-store").setCookie("session", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: config.cookieSecure,
        path: "/",
        maxAge: 28800,
      });
      return user;
    },
  );
  await app.register((secured, _options, done) => {
    secured.addHook("onRequest", async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      req.user = await auth.authenticate(req.cookies.session);
    });
    secured.get("/api/auth/me", (req) => req.user);
    secured.post("/api/auth/logout", async (req, reply) => {
      await auth.logout(req.cookies.session!);
      reply.clearCookie("session", { path: "/" });
      return { ok: true };
    });
    secured.get("/api/resources", async (req) => renewals.resources(req.user));
    secured.get("/api/resources/:id", (req) =>
      renewals.resource(
        req.user,
        z.object({ id: z.string().min(1).max(255) }).parse(req.params).id,
      ),
    );
    secured.get("/api/renewals", async (req) =>
      renewals.list(
        req.user,
        z
          .object({ resource_id: z.string().max(255).optional() })
          .strict()
          .parse(req.query).resource_id,
      ),
    );
    secured.get("/api/renewals/:id", async (req) =>
      renewals.get(req.user, idSchema.parse(req.params).id),
    );
    secured.post("/api/renewals", async (req, reply) => {
      const { resource_id } = z
        .object({ resource_id: z.string().min(1).max(255) })
        .strict()
        .parse(req.body);
      const row = await renewals.create(req.user, resource_id);
      reply.code(201);
      return row;
    });
    for (const action of ["approve", "reject", "retry"] as const)
      secured.post(`/api/renewals/:id/${action}`, async (req) => {
        z.object({})
          .strict()
          .parse(req.body ?? {});
        return renewals.action(req.user, idSchema.parse(req.params).id, action);
      });
    done();
  });
  return app;
}
