/**
 * HTML error pages for the storefront (PHP `ErrorController` parity).
 *
 * `app.setNotFoundHandler` renders `errors/404` for page URLs while keeping
 * machine-readable JSON for the API surface (`/api/*`) and health probe
 * (`/health`) — those clients must never receive an HTML body.
 *
 * The 500 handler mirrors the PHP `ErrorController::serverError()` page and
 * carries the Fastify request id as the "请求编号" so support can correlate logs.
 */

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { renderError } from "./render.js";
import { buildSite, type Site, type SiteConfigPort } from "./site.js";

export interface ErrorPageDependencies {
  config: SiteConfigPort;
}

/** JSON prefixes that must keep their machine-readable responses. */
const JSON_PREFIXES = ["/api", "/health"] as const;

export function wantsJson(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return JSON_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function hasValidation(error: unknown): error is { validation: unknown } {
  return typeof error === "object" && error !== null && "validation" in error;
}

export function configureErrorPages(app: FastifyInstance, deps: ErrorPageDependencies): void {
  const site: Site = buildSite(deps.config);

  app.setNotFoundHandler(async (request, reply) => {
    if (wantsJson(request.url)) {
      return reply.code(404).send({ error: "NOT_FOUND", message: "Route not found", requestId: request.id });
    }
    return renderError(reply, 404, { site, nav: "", user: null });
  });

  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    if (hasValidation(error)) {
      // Same contract as app.ts: validation failures are client errors.
      return reply.code(400).send({ error: "BAD_REQUEST", message: "Request validation failed", requestId: request.id });
    }
    if (wantsJson(request.url)) {
      request.log.error({ err: error }, "request failed");
      return reply.code(500).send({ error: "INTERNAL_ERROR", message: "An unexpected error occurred", requestId: request.id });
    }
    request.log.error({ err: error }, "request failed");
    return renderError(reply, 500, { site, nav: "", user: null, request_id: request.id });
  });
}

/** Render the maintenance page (503) — used by future maintenance toggles. */
export async function renderMaintenance(request: FastifyRequest, reply: FastifyReply, config: SiteConfigPort) {
  void request;
  return renderError(reply, 503, { site: buildSite(config), nav: "", user: null });
}
