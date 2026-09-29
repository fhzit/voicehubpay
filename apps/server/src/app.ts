import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { healthResponseSchema } from "../../../packages/contracts/src/index.js";
import { configureAuth, type AuthDependencies } from "./auth.js";

const requestIdPattern = /^[A-Za-z0-9_-]{1,64}$/;

export function buildApp(options: { auth?: AuthDependencies; secureCookies?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: false, genReqId: (request) => {
    const supplied = request.headers["x-request-id"];
    return typeof supplied === "string" && requestIdPattern.test(supplied) ? supplied : randomUUID();
  } });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    if (typeof error === "object" && error !== null && "validation" in error) {
      return reply.code(400).send({ error: "BAD_REQUEST", message: "Request validation failed", requestId: request.id });
    }
    request.log.error({ err: error }, "request failed");
    return reply.code(500).send({ error: "INTERNAL_ERROR", message: "An unexpected error occurred", requestId: request.id });
  });

  app.get("/health", async (_request, reply) => reply.code(200).send(healthResponseSchema.parse({ status: "ok" })));

  if (options.auth) configureAuth(app, options.auth, options.secureCookies ?? false);
  else {
    app.post("/api/auth/login", async (_request, reply) => reply.code(501).send({ error: "AUTH_NOT_CONFIGURED", message: "Authentication is not configured" }));
    app.get("/api/auth/me", async (_request, reply) => reply.code(501).send({ error: "AUTH_NOT_CONFIGURED", message: "Authentication is not configured" }));
    app.post("/api/auth/rotate", async (_request, reply) => reply.code(501).send({ error: "AUTH_NOT_CONFIGURED", message: "Authentication is not configured" }));
    app.post("/api/auth/logout", async (_request, reply) => reply.code(501).send({ error: "AUTH_NOT_CONFIGURED", message: "Authentication is not configured" }));
  }

  return app;
}
