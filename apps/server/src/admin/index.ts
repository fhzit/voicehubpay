/**
 * Legacy (PHP-parity) admin panel.
 *
 * `registerAdminRoutes(app, deps)` mounts every /admin route. The caller wires
 * the repositories in `packages/db/src/legacy` (see AdminDependencies).
 */

import type { FastifyInstance } from "fastify";
import { AdminRouter } from "./router.js";
import { registerDashboardRoutes } from "./dashboard.js";
import { registerProductRoutes } from "./products.js";
import { registerCategoryRoutes } from "./categories.js";
import { registerInventoryRoutes } from "./inventory.js";
import { registerOrderRoutes } from "./orders.js";
import { registerPaymentRoutes } from "./payments.js";
import { registerUserRoutes } from "./users.js";
import { registerSettingsRoutes } from "./settings.js";
import { registerAuditRoutes } from "./audit.js";
import { registerVoiceHubRoutes } from "./voicehub.js";
import { registerAfdianRoutes } from "./afdian.js";
import { registerSystemRoutes } from "./system.js";
import type { AdminDependencies } from "./types.js";

export function registerAdminRoutes(app: FastifyInstance, deps: AdminDependencies): FastifyInstance {
  const router = new AdminRouter(app, deps);
  registerDashboardRoutes(router);
  registerProductRoutes(router);
  registerCategoryRoutes(router);
  registerInventoryRoutes(router);
  registerOrderRoutes(router);
  registerPaymentRoutes(router);
  registerUserRoutes(router);
  registerSettingsRoutes(router);
  registerAuditRoutes(router);
  registerVoiceHubRoutes(router);
  registerAfdianRoutes(router);
  registerSystemRoutes(router);
  router.mount();
  return app;
}

export { AdminRouter } from "./router.js";
export { FileAdminConfig } from "./config.js";
export { ensureAdminSchema } from "./schema.js";
export type { AdminContext } from "./router.js";
export type {
  AdminConfigPort,
  AdminDependencies,
  AdminSettingsPort,
  Row,
} from "./types.js";
