/**
 * Wiring layer for the PHP-parity admin panel.
 *
 * Bridges the generic legacy repositories (`packages/db/src/legacy`) plus the
 * auth-legacy session store to the narrower ports declared in
 * `admin/types.ts`, so `index.ts` only has to call one function.
 */

import {
  AuditLogRepository,
  CategoryRepository,
  CryptoService,
  FulfillmentUnitRepository,
  InventoryRepository,
  OrderRepository,
  PaymentTransactionRepository,
  ProductRepository,
  SocialIdentityRepository,
  UserRepository,
  VoiceHubDeliveryRepository,
  AfdianOrderRepository,
} from "../../../packages/db/src/legacy/index.js";
import type { Database } from "../../../packages/db/src/index.js";
import type { Clock, SessionStore } from "./auth-legacy/types.js";
import type { AdminAfdianProcessorPort, AdminConfigPort, AdminMailerPort, AdminSg65ProbePort, AdminVoiceHubProbe } from "./admin/types.js";
import type { AdminDependencies } from "./admin/types.js";
import {
  type InventoryGenerateDependencies,
} from "./admin-inventory-generate.js";

export interface AdminWiringOptions {
  config: AdminConfigPort;
  // AdminMailerPort / AdminVoiceHubProbe come from the admin barrel.
  sessions: SessionStore;
  crypto: CryptoService;
  clock?: Clock;
  secureCookies?: boolean;
  loginPath?: string;
  mailer?: AdminMailerPort;
  sg65Probe?: AdminSg65ProbePort;
  afdianProcessor?: AdminAfdianProcessorPort;
  voicehubProbe?: AdminVoiceHubProbe;
}

export interface AdminWiring {
  admin: AdminDependencies;
  inventoryGenerate: InventoryGenerateDependencies;
}

export function createAdminWiring(db: Database, options: AdminWiringOptions): AdminWiring {
  const products = new ProductRepository(db);
  const categories = new CategoryRepository(db);
  const inventory = new InventoryRepository(db);
  const orders = new OrderRepository(db);
  const payments = new PaymentTransactionRepository(db);
  const users = new UserRepository(db);
  const audit = new AuditLogRepository(db);
  const voicehubDeliveries = new VoiceHubDeliveryRepository(db);
  const afdianOrders = new AfdianOrderRepository(db);
  const units = new FulfillmentUnitRepository(db);
  const socialIdentity = new SocialIdentityRepository(db);

  const admin: AdminDependencies = {
    products,
    categories,
    inventory,
    orders,
    payments,
    users,
    audit,
    voicehubDeliveries,
    afdianOrders,
    units,
    social: socialIdentity,
    // The dashboard KPI/health queries run through this handle; without it every
    // card silently reports zero (dashboard.ts falls back to an empty result).
    db,
    config: options.config,
    ...(options.mailer === undefined ? {} : { mailer: options.mailer }),
    ...(options.voicehubProbe === undefined ? {} : { voicehubProbe: options.voicehubProbe }),
    ...(options.sg65Probe === undefined ? {} : { sg65Probe: options.sg65Probe }),
    ...(options.afdianProcessor === undefined ? {} : { afdianProcessor: options.afdianProcessor }),
    sessions: options.sessions,
    crypto: options.crypto,
    clock: options.clock,
    secureCookies: options.secureCookies,
  };

  const inventoryGenerate: InventoryGenerateDependencies = {
    db,
    products,
    users,
    sessions: options.sessions,
    audit,
    crypto: options.crypto,
    clock: options.clock,
    secureCookies: options.secureCookies,
    loginPath: options.loginPath,
  };

  return { admin, inventoryGenerate };
}
