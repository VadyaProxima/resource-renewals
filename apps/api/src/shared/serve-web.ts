import send from "@fastify/send";
import type { FastifyInstance } from "fastify";

export function serveWeb(app: FastifyInstance, root: string) {
  app.get("/", async (request, reply) => {
    const result = await send(request.raw, "/index.html", {
      root,
      maxAge: 0,
      dotfiles: "deny",
    });
    return reply
      .code(result.statusCode)
      .headers(result.headers)
      .send(result.stream);
  });
  app.get("/assets/*", async (request, reply) => {
    const result = await send(request.raw, request.url.split("?")[0]!, {
      root,
      maxAge: 31536000000,
      immutable: true,
      dotfiles: "deny",
    });
    return reply
      .code(result.statusCode)
      .headers(result.headers)
      .send(result.stream);
  });
}
