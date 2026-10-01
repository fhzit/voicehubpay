import { AuthThrottleRepository, SettingsRepository } from './auth-throttle-repository.js';
import { AuditLogRepository } from './audit-log-repository.js';
import { CategoryRepository } from './category-repository.js';
import { InventoryRepository } from './inventory-repository.js';
import { OrderRepository } from './order-repository.js';
import { PaymentTransactionRepository } from './payment-transaction-repository.js';
import { ProductRepository } from './product-repository.js';
import { SocialIdentityRepository } from './social-identity-repository.js';
import { UserRepository } from './user-repository.js';
import { VoiceHubDeliveryRepository } from './voicehub-delivery-repository.js';
import { AfdianOrderRepository } from './afdian-order-repository.js';
import { FulfillmentUnitRepository } from './fulfillment-unit-repository.js';

export {
  AuthThrottleRepository,
  SettingsRepository,
  AuditLogRepository,
  CategoryRepository,
  InventoryRepository,
  OrderRepository,
  PaymentTransactionRepository,
  ProductRepository,
  SocialIdentityRepository,
  UserRepository,
  VoiceHubDeliveryRepository,
  AfdianOrderRepository,
  FulfillmentUnitRepository,
};

export type { Row, Paginated } from './shared.js';
export { nowIso } from './shared.js';
export { CryptoService } from './crypto.js';
export { toCents, format } from './money.js';

import type { Database } from '../index.js';

/** All 13 legacy-schema repositories wired to one database handle. */
export interface LegacyRepositories {
  users: UserRepository;
  socialIdentities: SocialIdentityRepository;
  categories: CategoryRepository;
  products: ProductRepository;
  inventory: InventoryRepository;
  orders: OrderRepository;
  fulfillmentUnits: FulfillmentUnitRepository;
  voicehubDeliveries: VoiceHubDeliveryRepository;
  paymentTransactions: PaymentTransactionRepository;
  afdianOrders: AfdianOrderRepository;
  auditLogs: AuditLogRepository;
  authThrottle: AuthThrottleRepository;
}

export function createLegacyRepositories(db: Database): LegacyRepositories {
  return {
    users: new UserRepository(db),
    socialIdentities: new SocialIdentityRepository(db),
    categories: new CategoryRepository(db),
    products: new ProductRepository(db),
    inventory: new InventoryRepository(db),
    orders: new OrderRepository(db),
    fulfillmentUnits: new FulfillmentUnitRepository(db),
    voicehubDeliveries: new VoiceHubDeliveryRepository(db),
    paymentTransactions: new PaymentTransactionRepository(db),
    afdianOrders: new AfdianOrderRepository(db),
    auditLogs: new AuditLogRepository(db),
    authThrottle: new AuthThrottleRepository(db),
  };
}
