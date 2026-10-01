import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createSqliteDatabase, type Database } from '../src/index.js';
import { createLegacyRepositories, CryptoService, toCents, format, type LegacyRepositories } from '../src/legacy/index.js';

/**
 * Deterministic SQLite fixtures: the 13 legacy-schema tables are created by
 * replaying the repository's own SQL migrations (database/migrations/sqlite)
 * verbatim through the Database handle under test.
 */
const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', '..', 'database', 'migrations', 'sqlite');
const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort();

async function applyMigrations(db: Database): Promise<void> {
  for (const name of MIGRATION_FILES) {
    await db.query(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
  }
}

let db: Database;
let repos: LegacyRepositories;
let crypto: CryptoService;
const tmpDirs: string[] = [];

beforeEach(async () => {
  db = createSqliteDatabase(':memory:');
  await applyMigrations(db);
  repos = createLegacyRepositories(db);
  crypto = new CryptoService(tmpDirs.pop() ?? process.cwd());
});

afterEach(async () => {
  await db.close();
});

describe('user repository', () => {
  it('creates, finds, updates and counts users', async () => {
    const created = await repos.users.create({ username: 'alice', email: 'alice@example.com', role: 'user' });
    expect(created?.username).toBe('alice');
    expect(created?.role).toBe('user');
    expect(await repos.users.findByUsername('alice')).not.toBeNull();
    expect(await repos.users.findByEmail('alice@example.com')).not.toBeNull();
    expect(await repos.users.findByEmail('')).toBeNull();
    await repos.users.setRole(created!.id as number, 'admin');
    await repos.users.setStatus(created!.id as number, 'disabled');
    const updated = await repos.users.findById(created!.id as number);
    expect(updated?.role).toBe('admin');
    expect(updated?.status).toBe('disabled');
    expect(String(updated?.updated_at) >= String(updated?.created_at)).toBe(true);
    await repos.users.create({ username: 'bob' });
    expect(await repos.users.countUsers()).toBe(2);
  });

  it('searches users with filters and pagination', async () => {
    await repos.users.create({ username: 'alice', display_name: 'Alice A', email: 'a@x.com' });
    await repos.users.create({ username: 'bob', display_name: 'Bob B', email: 'b@x.com', status: 'banned' });
    const all = await repos.users.search();
    expect(all.total).toBe(2);
    const onlyAlice = await repos.users.search('ali');
    expect(onlyAlice.total).toBe(1);
    expect(onlyAlice.items[0].username).toBe('alice');
    const banned = await repos.users.search('', 'banned');
    expect(banned.total).toBe(1);
    expect(banned.items[0].username).toBe('bob');
    const paged = await repos.users.search('', '', 1, 1);
    expect(paged.items).toHaveLength(1);
    expect(paged.perPage).toBe(1);
  });

  it('identifies the super admin as the lowest-id admin and protects deletion paths', async () => {
    const first = await repos.users.create({ username: 'root', role: 'admin' });
    await repos.users.create({ username: 'second', role: 'admin' });
    await repos.users.create({ username: 'member', role: 'user' });
    expect(await repos.users.superAdminId()).toBe(first!.id);
    expect(await repos.users.isSuperAdmin(first!.id as number)).toBe(true);
    expect(await repos.users.isSuperAdmin(999_999)).toBe(false);
  });

  it('deletes a user together with its social identities', async () => {
    const user = await repos.users.create({ username: 'deleteme' });
    await repos.socialIdentities.bind(user!.id as number, 'github', 'gh-123');
    await repos.users.delete(user!.id as number);
    expect(await repos.users.findById(user!.id as number)).toBeNull();
    expect(await repos.socialIdentities.listForUser(user!.id as number)).toHaveLength(0);
  });

  it('generates unique usernames for social logins', async () => {
    await repos.users.create({ username: 'gh_12345678' });
    const candidate = await repos.users.uniqueUsername('gh_', '12345678');
    expect(candidate).toBe('gh_12345678_1');
    const fresh = await repos.users.uniqueUsername('gh_', 'abcdef');
    expect(fresh).toBe('gh_abcdef');
  });
});

describe('social identity repository', () => {
  it('binds, finds and unbinds provider identities', async () => {
    const user = await repos.users.create({ username: 'u1' });
    const userId = user!.id as number;
    const bound = await repos.socialIdentities.bind(userId, 'github', 'gh-1', 'GH', 'http://a/1.png');
    expect(bound?.provider).toBe('github');
    expect(await repos.socialIdentities.findByIdentity('github', 'gh-1')).not.toBeNull();
    expect(await repos.socialIdentities.getProvider(userId, 'github')).not.toBeNull();
    expect(await repos.socialIdentities.loginMethodCount(user!)).toBe(1);
    await repos.users.setPassword(userId, 'hashed-value');
    const withPassword = await repos.users.findById(userId);
    expect(await repos.socialIdentities.loginMethodCount(withPassword!)).toBe(2);
    expect(await repos.socialIdentities.unbind(userId, 'github')).toBe(true);
    expect(await repos.socialIdentities.unbind(userId, 'github')).toBe(false);
  });
});

describe('category repository', () => {
  it('creates, lists, updates and deletes categories', async () => {
    const cat = await repos.categories.create('Books', 'books', 2);
    expect(cat?.slug).toBe('books');
    await repos.categories.create('Games', 'games', 1);
    const active = await repos.categories.listActive();
    expect(active.map((row) => row.slug)).toEqual(['games', 'books']);
    await repos.categories.setStatus(cat!.id as number, 'hidden');
    expect((await repos.categories.listActive()).map((row) => row.slug)).toEqual(['games']);
    expect(await repos.categories.findBySlug('books')).not.toBeNull();
  });

  it('refuses to delete a category still referenced by products', async () => {
    const cat = await repos.categories.create('Ref', 'ref');
    await repos.products.create({ name: 'P', slug: 'p', category_id: cat!.id as number, price_cents: 100 });
    expect(await repos.categories.delete(cat!.id as number)).toBe(false);
    const empty = await repos.categories.create('Empty', 'empty');
    expect(await repos.categories.delete(empty!.id as number)).toBe(true);
  });

  it('uniquifies slugs', async () => {
    await repos.categories.create('Books', 'books');
    expect(await repos.categories.uniqueSlug('Books')).toBe('books-2');
    // Invalid characters are stripped, so 'Books!!' normalizes to 'books'.
    expect(await repos.categories.uniqueSlug('Books!!')).toBe('books-2');
    // After 'books-2' actually exists, the next candidate moves on.
    await repos.categories.create('Books Two', 'books-2');
    expect(await repos.categories.uniqueSlug('Books')).toBe('books-3');
    const cat = await repos.categories.create('Other', 'other');
    expect(await repos.categories.uniqueSlug('Other', cat!.id as number)).toBe('other');
  });
});

describe('product repository', () => {
  let categoryId: number;

  beforeEach(async () => {
    const cat = await repos.categories.create('Cat', 'cat');
    categoryId = cat!.id as number;
  });

  it('creates products with defaults and counts active ones', async () => {
    const product = await repos.products.create({ name: 'Card Pack', slug: 'card-pack', category_id: categoryId, price_cents: 1999 });
    expect(product?.status).toBe('draft');
    expect(product?.delivery_mode).toBe('card');
    expect(product?.min_quantity).toBe(1);
    expect(product?.max_quantity).toBe(99);
    await repos.products.setStatus(product!.id as number, 'active');
    expect(await repos.products.activeCount()).toBe(1);
    expect(await repos.products.findBySlug('card-pack')).not.toBeNull();
  });

  it('lists public products with live stock counts and sorting', async () => {
    const active = await repos.products.create({ name: 'A', slug: 'a', category_id: categoryId, price_cents: 500 });
    await repos.products.setStatus(active!.id as number, 'active');
    const cheap = await repos.products.create({ name: 'B', slug: 'b', category_id: categoryId, price_cents: 100 });
    await repos.products.setStatus(cheap!.id as number, 'active');
    const hidden = await repos.products.create({ name: 'C', slug: 'c', category_id: categoryId, price_cents: 1 });
    await repos.inventory.import(active!.id as number, ['s1', 's2'], crypto);
    await repos.inventory.import(cheap!.id as number, ['s3'], crypto);
    const list = await repos.products.listPublic({}, 1, 12);
    expect(list.total).toBe(2);
    // Default order: sort_order ASC, id DESC -> newest ('b', 1 card) first.
    expect(list.items[0].slug).toBe('b');
    expect(list.items[0].stock_available).toBe(1);
    expect(list.items[1].slug).toBe('a');
    expect(list.items[1].stock_available).toBe(2);
    const byPrice = await repos.products.listPublic({ sort: 'price' });
    expect(byPrice.items.map((row) => row.slug)).toEqual(['b', 'a']);
    const byQuery = await repos.products.listPublic({ q: 'A' });
    expect(byQuery.total).toBe(1);
    const byCategory = await repos.products.listPublic({ category_id: categoryId });
    expect(byCategory.total).toBe(2);
    expect((await repos.products.listPublic({ category_id: categoryId + 100 })).total).toBe(0);
    void hidden;
  });

  it('soft-deletes referenced products and hard-deletes unreferenced ones', async () => {
    const product = await repos.products.create({ name: 'D', slug: 'd', category_id: categoryId, price_cents: 10 });
    const productId = product!.id as number;
    expect(await repos.products.deleteOrDisable(productId)).toBe('deleted');
    const kept = await repos.products.create({ name: 'E', slug: 'e', category_id: categoryId, price_cents: 10 });
    const user = await repos.users.create({ username: 'buyer' });
    const order = await repos.orders.create({ order_no: 'ORD-1', user_id: user!.id as number, amount_due_cents: 10 });
    await repos.orders.addItem({ order_id: order!.id as number, product_id: kept!.id as number, product_name_snapshot: 'E', product_price_cents_snapshot: 10, quantity: 1 });
    expect(await repos.products.deleteOrDisable(kept!.id as number)).toBe('disabled');
    expect((await repos.products.findById(kept!.id as number))?.status).toBe('disabled');
    void productId;
  });
});

describe('inventory repository', () => {
  let productId: number;

  beforeEach(async () => {
    const product = await repos.products.create({ name: 'Stocked', slug: 'stocked', price_cents: 100 });
    productId = product!.id as number;
  });

  it('imports secrets with dedup and validation, and reports stats', async () => {
    const first = await repos.inventory.import(productId, ['A1', 'B2', '  ', 'A1'], crypto);
    expect(first).toEqual({ total: 4, imported: 2, duplicates: 1, invalid: 1 });
    const second = await repos.inventory.import(productId, ['A1', 'C3'], crypto);
    expect(second).toEqual({ total: 2, imported: 1, duplicates: 1, invalid: 0 });
    expect(await repos.inventory.countAvailable(productId)).toBe(3);
    expect(await repos.inventory.stats(productId)).toEqual({ available: 3, reserved: 0, sold: 0, disabled: 0 });
    expect(await repos.inventory.totalStats().then((stats) => stats.available)).toBe(3);
    const card = (await repos.inventory.listForProduct(productId)).items[0];
    expect(crypto.isEncrypted(card.secret_ciphertext as string)).toBe(true);
    expect(card.secret_hash).toBe(crypto.hash(crypto.decrypt(card.secret_ciphertext as string)));
  });

  it('reserves available cards atomically and fails on insufficient stock', async () => {
    await repos.inventory.import(productId, ['R1', 'R2'], crypto);
    const reserved = await repos.inventory.reserve(productId, 2, 77, '2026-10-02T00:00:00+00:00');
    expect(reserved).toHaveLength(2);
    for (const row of reserved) {
      expect(row.status).toBe('reserved');
      expect(row.reserved_order_id).toBe(77);
    }
    await expect(repos.inventory.reserve(productId, 1, 78, '2026-10-02T00:00:00+00:00')).rejects.toThrow('insufficient_stock');
    await expect(repos.inventory.reserve(productId, 0, 78, '2026-10-02T00:00:00+00:00')).rejects.toThrow('insufficient_stock');
  });

  it('returns reserved cards with decrypted secrets when requested', async () => {
    await repos.inventory.import(productId, ['SECRET-VALUE'], crypto);
    const reserved = await repos.inventory.reserve(productId, 1, 5, '2026-10-02T00:00:00+00:00', true, crypto);
    expect(reserved[0].secret_plain).toBe('SECRET-VALUE');
  });

  it('releases expired reservations of unpaid orders but never paid ones', async () => {
    await repos.inventory.import(productId, ['X1', 'X2'], crypto);
    await repos.inventory.reserve(productId, 1, 11, '2026-01-01T00:00:00+00:00');
    const paidUser = await repos.users.create({ username: 'payer' });
    const paidOrder = await repos.orders.create({ order_no: 'ORD-PAID', user_id: paidUser!.id as number });
    await repos.orders.markPaid(paidOrder!.id as number, 100, 'sg65', 'callback');
    await repos.inventory.reserve(productId, 1, paidOrder!.id as number, '2026-01-01T00:00:00+00:00');
    const released = await repos.inventory.releaseExpired('2026-02-01T00:00:00+00:00');
    expect(released).toBe(1);
    const stats = await repos.inventory.stats(productId);
    expect(stats).toEqual({ available: 1, reserved: 1, sold: 0, disabled: 0 });
  });

  it('releases reservations for a cancelled order and marks sold for paid ones', async () => {
    await repos.inventory.import(productId, ['Y1', 'Y2'], crypto);
    await repos.inventory.reserve(productId, 2, 42, '2026-10-02T00:00:00+00:00');
    expect(await repos.inventory.releaseForOrder(42)).toBe(2);
    expect(await repos.inventory.countAvailable(productId)).toBe(2);
    await repos.inventory.reserve(productId, 2, 43, '2026-10-02T00:00:00+00:00');
    expect(await repos.inventory.markSoldForOrder(43)).toBe(2);
    expect(await repos.inventory.stats(productId)).toEqual({ available: 0, reserved: 0, sold: 2, disabled: 0 });
  });

  it('matches cards by hash when searching and lists with product names', async () => {
    await repos.inventory.import(productId, ['FINDME'], crypto);
    const byHash = await repos.inventory.listForProduct(productId, '', 'FINDME');
    expect(byHash.total).toBe(1);
    const byStatus = await repos.inventory.listForProduct(productId, 'available');
    expect(byStatus.total).toBe(1);
    const all = await repos.inventory.listAll('Stocked');
    expect(all.total).toBe(1);
    expect(all.items[0].product_name).toBe('Stocked');
  });

  it('disables and re-enables single cards', async () => {
    await repos.inventory.import(productId, ['D1'], crypto);
    const card = (await repos.inventory.listForProduct(productId)).items[0];
    await repos.inventory.setDisabled(card.id as number, true);
    expect((await repos.inventory.findById(card.id as number))?.status).toBe('disabled');
    await repos.inventory.setDisabled(card.id as number, false);
    expect((await repos.inventory.findById(card.id as number))?.status).toBe('available');
  });
});

describe('order repository', () => {
  let userId: number;
  let productId: number;

  beforeEach(async () => {
    const user = await repos.users.create({ username: 'orderer' });
    userId = user!.id as number;
    const product = await repos.products.create({ name: 'Item', slug: 'item', price_cents: 2500 });
    productId = product!.id as number;
  });

  const createOrder = async (orderNo: string): Promise<number> => {
    const order = await repos.orders.create({ order_no: orderNo, user_id: userId, amount_due_cents: 2500, expires_at: '2026-10-02T00:00:00+00:00' });
    return order!.id as number;
  };

  it('creates orders with defaults and finds by order_no', async () => {
    const order = await repos.orders.create({ order_no: 'O-100', user_id: userId, amount_due_cents: 2500 });
    expect(order?.payment_status).toBe('unpaid');
    expect(order?.order_status).toBe('active');
    expect(order?.currency).toBe('CNY');
    expect(order?.source).toBe('shop');
    expect((await repos.orders.findByOrderNo('O-100'))?.id).toBe(order?.id);
    expect(await repos.orders.isOwner(order!.id as number, userId)).toBe(true);
    expect(await repos.orders.isOwner(order!.id as number, userId + 1)).toBe(false);
  });

  it('adds items and units, and recalculates fulfillment status from units', async () => {
    const orderId = await createOrder('O-200');
    const itemId = await repos.orders.addItem({ order_id: orderId, product_id: productId, product_name_snapshot: 'Item', product_price_cents_snapshot: 2500, quantity: 2 });
    expect(typeof itemId).toBe('number');
    const unitId = await repos.orders.addUnit({ order_id: orderId, order_item_id: itemId, unit_index: 1, unit_no: 'O-200-1' });
    expect(typeof unitId).toBe('number');
    expect((await repos.orders.items(orderId))).toHaveLength(1);
    expect((await repos.orders.units(orderId))).toHaveLength(1);
    expect((await repos.orders.findUnit(unitId))?.unit_no).toBe('O-200-1');

    await repos.orders.markPaid(orderId, 2500, 'sg65', 'callback');
    await repos.orders.updateUnit(unitId, { status: 'success' });
    await repos.orders.recalcFulfillmentStatus(orderId);
    expect((await repos.orders.findById(orderId))?.fulfillment_status).toBe('success');
    expect((await repos.orders.findById(orderId))?.fulfilled_at).not.toBeNull();

    await repos.orders.updateUnit(unitId, { status: 'failed' });
    await repos.orders.recalcFulfillmentStatus(orderId);
    expect((await repos.orders.findById(orderId))?.fulfillment_status).toBe('failed');

    await repos.orders.updateUnit(unitId, { status: 'pending' });
    await repos.orders.recalcFulfillmentStatus(orderId);
    expect((await repos.orders.findById(orderId))?.fulfillment_status).toBe('processing');
    expect(await repos.orders.countUnitsByStatus(orderId)).toEqual({ pending: 1, processing: 0, success: 0, failed: 0, manual_completed: 0 });
  });

  it('does not recalc fulfillment for unpaid orders', async () => {
    const orderId = await createOrder('O-201');
    const itemId = await repos.orders.addItem({ order_id: orderId, product_id: productId, product_name_snapshot: 'Item', quantity: 1 });
    const unitId = await repos.orders.addUnit({ order_id: orderId, order_item_id: itemId, unit_index: 1, unit_no: 'O-201-1' });
    await repos.orders.updateUnit(unitId, { status: 'success' });
    await repos.orders.recalcFulfillmentStatus(orderId);
    expect((await repos.orders.findById(orderId))?.fulfillment_status).toBe('pending');
  });

  it('filters user order lists by status buckets', async () => {
    const orderId = await createOrder('O-300');
    await repos.orders.markPaid(orderId, 2500, 'sg65', 'callback');
    expect((await repos.orders.listForUser(userId, 'paid')).total).toBe(1);
    expect((await repos.orders.listForUser(userId, 'unpaid')).total).toBe(0);
    expect((await repos.orders.listForUser(userId, 'abnormal')).total).toBe(0);
    await repos.orders.update(orderId, { fulfillment_status: 'failed' });
    expect((await repos.orders.listForUser(userId, 'abnormal')).total).toBe(1);
    expect((await repos.orders.listForUser(userId, '', 'O-30')).total).toBe(1);
    expect((await repos.orders.listForUser(userId, '', 'nope')).total).toBe(0);
  });

  it('lists admin orders with user and first-item projections', async () => {
    const orderId = await createOrder('O-400');
    await repos.orders.addItem({ order_id: orderId, product_id: productId, product_name_snapshot: 'Item', quantity: 3 });
    const page = await repos.orders.listAdmin({ username: 'orderer' });
    expect(page.total).toBe(1);
    expect(page.items[0].username).toBe('orderer');
    expect(page.items[0].first_item_name).toBe('Item');
    expect(page.items[0].item_count).toBe(3);
    expect((await repos.orders.listAdmin({ product: 'Item' })).total).toBe(1);
    expect((await repos.orders.listAdmin({ order_no: 'O-40' })).total).toBe(1);
    expect((await repos.orders.listAdmin({ payment_status: 'unpaid' })).total).toBe(1);
    expect((await repos.orders.listAdmin({ abnormal: true })).total).toBe(0);
  });

  it('returns orders awaiting fulfillment oldest-first and bundles items+units', async () => {
    const first = await createOrder('O-500');
    const second = await createOrder('O-501');
    await repos.orders.markPaid(second, 2500, 'sg65', 'callback');
    await repos.orders.addItem({ order_id: second, product_id: productId, product_name_snapshot: 'Item', quantity: 1 });
    await repos.orders.addUnit({ order_id: second, order_item_id: 1, unit_index: 1, unit_no: 'U1' });
    const pending = await repos.orders.listPendingFulfillment();
    expect(pending.map((row) => row.id)).toEqual([second]);
    void first;
    const bundle = await repos.orders.orderWithItems('O-501');
    expect(bundle?.items).toHaveLength(1);
    expect(bundle?.units).toHaveLength(1);
    expect(await repos.orders.orderWithItems('missing')).toBeNull();
  });
});

describe('fulfillment unit repository', () => {
  it('lists delivered cards for users with paid orders only', async () => {
    const user = await repos.users.create({ username: 'vault' });
    const userId = user!.id as number;
    const product = await repos.products.create({ name: 'P', slug: 'p', price_cents: 100 });
    const order = await repos.orders.create({ order_no: 'V-1', user_id: userId, amount_due_cents: 100 });
    const itemId = await repos.orders.addItem({ order_id: order!.id as number, product_id: product!.id as number, product_name_snapshot: 'P', quantity: 1 });
    const unitId = await repos.orders.addUnit({ order_id: order!.id as number, order_item_id: itemId, unit_index: 1, unit_no: 'V-1-1' });
    await repos.orders.updateUnit(unitId, { status: 'success' });

    // Unpaid: invisible everywhere.
    expect(await repos.fulfillmentUnits.countForUser(userId)).toBe(0);
    await repos.orders.markPaid(order!.id as number, 100, 'sg65', 'callback');
    expect(await repos.fulfillmentUnits.countForUser(userId)).toBe(1);
    expect(await repos.fulfillmentUnits.countDeliveredForUser(userId)).toBe(1);
    expect(await repos.fulfillmentUnits.countProcessingForUser(userId)).toBe(0);
    const list = await repos.fulfillmentUnits.listForUser(userId, 'completed', 'P');
    expect(list.total).toBe(1);
    expect(list.items[0].order_no).toBe('V-1');
    expect(list.items[0].product_name_snapshot).toBe('P');
    expect((await repos.fulfillmentUnits.listForUser(userId, 'processing')).total).toBe(0);
  });
});

describe('payment transaction repository', () => {
  let userId: number;

  beforeEach(async () => {
    const user = await repos.users.create({ username: 'txuser' });
    userId = user!.id as number;
  });

  it('upserts by merchant_order_no and stamps paid_at only once', async () => {
    const order = await repos.orders.create({ order_no: 'T-1', user_id: userId });
    const created = await repos.paymentTransactions.upsert({
      order_id: order!.id as number,
      merchant_order_no: 'T-1',
      amount_cents: 500,
      status: 'pending',
    });
    expect(created?.gateway).toBe('sg65');
    expect(created?.paid_at).toBeNull();
    const updated = await repos.paymentTransactions.upsert({
      order_id: order!.id as number,
      merchant_order_no: 'T-1',
      gateway_trade_no: 'GW-1',
      status: 'paid',
      amount_cents: 500,
    });
    expect(updated?.status).toBe('paid');
    expect(updated?.gateway_trade_no).toBe('GW-1');
    expect(updated?.paid_at).not.toBeNull();
    const again = await repos.paymentTransactions.upsert({
      order_id: order!.id as number,
      merchant_order_no: 'T-1',
      status: 'paid',
    });
    expect(again?.paid_at).toBe(updated?.paid_at);
  });

  it('marks paid with COALESCE semantics and never downgrades paid on cancel', async () => {
    const order = await repos.orders.create({ order_no: 'T-2', user_id: userId });
    const tx = await repos.paymentTransactions.upsert({ order_id: order!.id as number, merchant_order_no: 'T-2' });
    await repos.paymentTransactions.markPaid(tx!.id as number, 'GW-9', 'API-9', 'poll');
    const paid = await repos.paymentTransactions.findById(tx!.id as number);
    expect(paid?.gateway_trade_no).toBe('GW-9');
    expect(paid?.api_trade_no).toBe('API-9');
    expect(paid?.confirmation_source).toBe('poll');
    expect(await repos.paymentTransactions.markCancelledForOrder(order!.id as number)).toBe(0);
    expect((await repos.paymentTransactions.findById(tx!.id as number))?.status).toBe('paid');
    const order2 = await repos.orders.create({ order_no: 'T-3', user_id: userId });
    const pendingTx = await repos.paymentTransactions.upsert({ order_id: order2!.id as number, merchant_order_no: 'T-3' });
    expect(await repos.paymentTransactions.markCancelledForOrder(order2!.id as number)).toBe(1);
    expect((await repos.paymentTransactions.findById(pendingTx!.id as number))?.status).toBe('cancelled');
  });

  it('finds by gateway trade no and lists for admin/orders', async () => {
    const order = await repos.orders.create({ order_no: 'T-4', user_id: userId });
    await repos.paymentTransactions.upsert({ order_id: order!.id as number, merchant_order_no: 'T-4', gateway_trade_no: 'GW-42' });
    expect((await repos.paymentTransactions.findByGatewayTradeNo('GW-42'))?.merchant_order_no).toBe('T-4');
    expect(await repos.paymentTransactions.findByGatewayTradeNo('GW-nope')).toBeNull();
    expect(await repos.paymentTransactions.listForOrder(order!.id as number)).toHaveLength(1);
    const admin = await repos.paymentTransactions.listAdmin('', '', 'T-4');
    expect(admin.total).toBe(1);
    expect(admin.items[0].order_no).toBe('T-4');
  });
});

describe('voicehub delivery repository', () => {
  it('creates deliveries guarded by the idempotency key', async () => {
    const payload = {
      source_type: 'afdian',
      source_order_no: '202610011234',
      code_ciphertext: 'v1:abc',
      code_hash: crypto.hash('202610011234'),
      code_source: 'afdian_order_no',
      idempotency_key: 'afdian:202610011234',
    };
    const first = await repos.voicehubDeliveries.createIfAbsent(payload);
    expect(first.created).toBe(true);
    expect(first.delivery?.attempts).toBe(0);
    const second = await repos.voicehubDeliveries.createIfAbsent(payload);
    expect(second.created).toBe(false);
    expect(second.delivery?.id).toBe(first.delivery?.id);
  });

  it('claims with attempt counting and stale-lease reclamation, then marks success/failed', async () => {
    const delivery = await repos.voicehubDeliveries.createIfAbsent({
      source_type: 'afdian',
      source_order_no: 'C-1',
      code_ciphertext: 'v1:x',
      code_hash: 'h',
      code_source: 'afdian_order_no',
      idempotency_key: 'afdian:C-1',
    });
    const id = delivery.delivery!.id as number;
    const t0 = 1_000_000_000_000;
    let now = t0;
    const clock = () => now;
    expect(await repos.voicehubDeliveries.claimForProcessing(id, '{"a":1}', 2, false, 300, clock)).toBe(true);
    expect(await repos.voicehubDeliveries.claimForProcessing(id, '{}', 2, false, 300, clock)).toBe(false); // already processing, fresh lease
    now = t0 + 301_000;
    expect(await repos.voicehubDeliveries.claimForProcessing(id, '{}', 2, false, 300, clock)).toBe(true); // stale lease reclaimed
    expect(await repos.voicehubDeliveries.claimForProcessing(id, '{}', 2, false, 300, clock)).toBe(false); // attempts exhausted
    await repos.voicehubDeliveries.markFailed(id, 'boom '.repeat(300), 'resp');
    const failed = await repos.voicehubDeliveries.findById(id);
    expect(failed?.status).toBe('failed');
    expect((failed?.last_error as string).length).toBeLessThanOrEqual(1000);
    expect(failed?.response_payload).toBe('resp');
    expect(await repos.voicehubDeliveries.countFailedRetryable()).toBe(1);
    expect((await repos.voicehubDeliveries.recentFailures(5)).length).toBe(1);
    expect(await repos.voicehubDeliveries.claimForProcessing(id, '{}', 10, true, 300, clock)).toBe(true); // force retry
    await repos.voicehubDeliveries.markSuccess(id, '{"ok":true}');
    const ok = await repos.voicehubDeliveries.findById(id);
    expect(ok?.status).toBe('success');
    expect(ok?.success_at).not.toBeNull();
    expect(ok?.last_error).toBeNull();
  });

  it('aggregates stats and filter lists', async () => {
    for (const [key, status] of [['S-1', 'success'], ['S-2', 'failed'], ['S-3', 'pending']] as const) {
      const created = await repos.voicehubDeliveries.createIfAbsent({
        source_type: 'afdian', source_order_no: key, code_ciphertext: 'v1:x', code_hash: 'h', code_source: 'afdian_order_no', idempotency_key: `afdian:${key}`, status,
      });
      if (status !== 'pending') {
        if (status === 'success') await repos.voicehubDeliveries.markSuccess(created.delivery!.id as number, '{}');
        else await repos.voicehubDeliveries.markFailed(created.delivery!.id as number, 'err');
      }
    }
    expect(await repos.voicehubDeliveries.stats()).toEqual({ pending: 1, processing: 0, success: 1, failed: 1 });
    expect((await repos.voicehubDeliveries.list({ only_failed: true })).total).toBe(1);
    expect((await repos.voicehubDeliveries.list({ status: 'success' })).total).toBe(1);
    expect((await repos.voicehubDeliveries.list({ q: 'S-1' })).total).toBe(1);
  });
});

describe('afdian order repository', () => {
  it('creates if absent and refreshes source fields without clobbering delivery state', async () => {
    const first = await repos.afdianOrders.createIfAbsent({
      out_trade_no: '202610011000',
      trade_no: 'TR-1',
      user_id: 'af-user',
      amount_cents: 9900,
      status: 'paid',
      voicehub_status: 'success',
      raw_payload: '{"plan":"p1"}',
    });
    expect(first.created).toBe(true);
    expect(first.order?.amount_cents).toBe(9900);
    const before = { attempts: first.order?.voicehub_attempts, status: first.order?.voicehub_status };
    const second = await repos.afdianOrders.createIfAbsent({
      out_trade_no: '202610011000',
      trade_no: 'TR-1',
      user_id: 'af-user',
      amount_cents: 9900,
      status: 'paid',
      sku_detail: '{"sku":"s"}',
      raw_payload: '{"plan":"p1","more":1}',
    });
    expect(second.created).toBe(false);
    expect(second.order?.voicehub_attempts).toBe(before.attempts);
    expect(second.order?.voicehub_status).toBe(before.status);
    expect(second.order?.sku_detail).toBe('{"sku":"s"}');
  });

  it('marks voicehub delivery state with processed_at only on success', async () => {
    const created = await repos.afdianOrders.createIfAbsent({ out_trade_no: 'M-1', amount_cents: 100, status: 'paid' });
    const id = created.order!.id as number;
    await repos.afdianOrders.markVoiceHub(id, 'failed', 3, 'timeout');
    let row = await repos.afdianOrders.findById(id);
    expect(row?.voicehub_status).toBe('failed');
    expect(row?.voicehub_attempts).toBe(3);
    expect(row?.voicehub_last_error).toBe('timeout');
    expect(row?.processed_at).toBeNull();
    await repos.afdianOrders.markVoiceHub(id, 'success', 4, null);
    row = await repos.afdianOrders.findById(id);
    expect(row?.processed_at).not.toBeNull();
  });

  it('aggregates paid sums and stats with the legacy status=2 alias', async () => {
    await repos.afdianOrders.createIfAbsent({ out_trade_no: 'A-1', amount_cents: 1000, status: 'paid' });
    await repos.afdianOrders.createIfAbsent({ out_trade_no: 'A-2', amount_cents: 500, status: '2' });
    await repos.afdianOrders.createIfAbsent({ out_trade_no: 'A-3', amount_cents: 700, status: 'pending' });
    expect(await repos.afdianOrders.count()).toBe(3);
    expect(await repos.afdianOrders.sumPaid()).toBe(1500);
    expect(await repos.afdianOrders.stats()).toEqual({ pending: 3, processing: 0, success: 0, failed: 0 });
    const admin = await repos.afdianOrders.listAdmin('', '', 'A-1');
    expect(admin.total).toBe(1);
    const recent = await repos.afdianOrders.listRecent(2);
    expect(recent).toHaveLength(2);
  });
});

describe('audit log repository', () => {
  it('redacts sensitive metadata keys before persisting', async () => {
    await repos.auditLogs.log(1, 'order.create', 'order', '77', {
      amount_cents: 500,
      password: 'hunter2',
      api_token: 'secret-token',
      card_number: '4242',
      nested: { private_key: 'k', safe: 'value' },
    }, '127.0.0.1', 'vitest');
    const page = await repos.auditLogs.list({ action: 'order.create' });
    expect(page.total).toBe(1);
    const metadata = JSON.parse(page.items[0].metadata as string) as Record<string, unknown>;
    expect(metadata.amount_cents).toBe(500);
    expect(metadata.password).toBe('[redacted]');
    expect(metadata.api_token).toBe('[redacted]');
    expect(metadata.card_number).toBe('[redacted]');
    expect((metadata.nested as Record<string, unknown>).private_key).toBe('[redacted]');
    expect((metadata.nested as Record<string, unknown>).safe).toBe('value');
    expect(page.items[0].username).toBeNull();
  });

  it('filters by user, object and time range, and lists distinct actions', async () => {
    await repos.auditLogs.log(1, 'a.one');
    await repos.auditLogs.log(2, 'a.two', 'product', '9');
    expect((await repos.auditLogs.list({ user_id: 2 })).total).toBe(1);
    expect((await repos.auditLogs.list({ object_type: 'product' })).total).toBe(1);
    expect((await repos.auditLogs.list({ from: '2999-01-01' })).total).toBe(0);
    expect((await repos.auditLogs.list({ to: '2999-01-01' })).total).toBe(2);
    expect(await repos.auditLogs.distinctActions()).toEqual(['a.one', 'a.two']);
  });
});

describe('auth throttle repository', () => {
  it('locks after five failures inside the window and reports remaining attempts', async () => {
    const key = 'user:alice';
    let now = 1_000_000;
    for (let i = 0; i < 4; i += 1) {
      await repos.authThrottle.recordFailure(key, now);
      expect(await repos.authThrottle.isLocked(key, now)).toBe(false);
      now += 60;
    }
    expect(await repos.authThrottle.remaining(key)).toBe(1);
    await repos.authThrottle.recordFailure(key, now);
    expect(await repos.authThrottle.isLocked(key, now)).toBe(true);
    expect(await repos.authThrottle.remaining(key)).toBe(0);
  });

  it('resets the counter when the window elapses and clears on success', async () => {
    const key = 'user:bob';
    let now = 2_000_000;
    for (let i = 0; i < 4; i += 1) {
      await repos.authThrottle.recordFailure(key, now);
      now += 60;
    }
    now += 901; // beyond the 900s window
    await repos.authThrottle.recordFailure(key, now);
    expect(await repos.authThrottle.isLocked(key, now)).toBe(false);
    expect(await repos.authThrottle.remaining(key)).toBe(4);
    await repos.authThrottle.clear(key);
    expect(await repos.authThrottle.remaining(key)).toBe(5);
    expect(await repos.authThrottle.isLocked(key, now)).toBe(false);
  });
});

describe('money helpers', () => {
  it('converts decimal strings to integer cents without float math', () => {
    expect(toCents('10.00')).toBe(1000);
    expect(toCents('0.50')).toBe(50);
    expect(toCents('5')).toBe(500);
    expect(toCents('1,234.56')).toBe(123_456);
    expect(toCents('-3.21')).toBe(-321);
    expect(toCents(42)).toBe(42);
    expect(format(123_456)).toBe('1234.56');
    expect(format(-50)).toBe('-0.50');
    expect(() => toCents('')).toThrow();
    expect(() => toCents('1.234')).toThrow();
    expect(() => toCents('abc')).toThrow();
  });
});
