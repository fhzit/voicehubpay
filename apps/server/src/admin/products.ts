/**
 * `/admin/products` — listing, create/edit form, save, status toggle, delete
 * (port of VoiceHubPay\Controllers\Admin\ProductController).
 */

import { toCents } from "../../../../packages/db/src/legacy/money.js";
import type { AdminContext, AdminRouter } from "./router.js";
import { formInt, formString, formTrimmed, pagination } from "./router.js";
import type { Row } from "./types.js";

const PER_PAGE = 20;
const DELIVERY_MODES = new Set(["card", "voicehub", "card_and_voicehub", "manual"]);
const CODE_SOURCES = new Set(["inventory", "order_no"]);
const STATUSES = new Set(["draft", "active", "disabled"]);

export function registerProductRoutes(router: AdminRouter): void {
  router.get("/admin/products", async (context) => {
    const { query } = context;
    const q = formString(query, "q");
    const status = formString(query, "status");
    const categoryId = formInt(query, "category", 0) || null;
    const requested = Math.max(1, formInt(query, "page", 1));
    const result = await router.deps.products.listAdmin(q, status, categoryId, requested, PER_PAGE);
    const categories = await router.deps.categories.listAll();
    const categoryNames = new Map(categories.map((category) => [Number(category["id"]), String(category["name"] ?? "")]));
    const products = result.items.map((product) => ({
      ...product,
      category_name: categoryNames.get(Number(product["category_id"])) ?? "—",
    }));
    const { page, pages } = pagination(query, result.perPage, result.total);
    return context.render("products/index", {
      pageTitle: "商品管理",
      nav: "products",
      products,
      total: result.total,
      page,
      pages,
      q,
      status,
      category_id: categoryId,
      categories,
    });
  });

  router.get("/admin/products/create", async (context) => {
    const categories = await router.deps.categories.listActive();
    return context.render("products/edit", {
      pageTitle: "新建商品",
      nav: "products",
      product: null,
      categories,
    });
  });

  router.get("/admin/products/edit/:id", async (context) => {
    const product = await router.deps.products.findById(Number(context.params["id"] ?? 0));
    if (product === null) return context.redirect("/admin/products", "商品不存在。", "error");
    const categories = await router.deps.categories.listActive();
    return context.render("products/edit", {
      pageTitle: "编辑商品",
      nav: "products",
      product,
      categories,
    });
  });

  router.post("/admin/products/save", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const body = context.body;
    const id = formInt(body, "id", 0);
    const backUrl = `/admin/products${id > 0 ? `/edit/${id}` : "/create"}`;
    const name = formTrimmed(body, "name");
    if (name === "") return context.redirect(backUrl, "商品名称不能为空。", "error");

    let priceCents: number;
    try {
      priceCents = toCents(formTrimmed(body, "price"));
    } catch {
      return context.redirect(backUrl, "请输入有效的商品价格。", "error");
    }
    if (priceCents <= 0) return context.redirect(backUrl, "商品价格必须大于 0。", "error");

    const rawMode = formString(body, "delivery_mode", "card");
    const deliveryMode = DELIVERY_MODES.has(rawMode) ? rawMode : "card";
    let voicehubSource = formString(body, "voicehub_code_source", "inventory");
    if (!CODE_SOURCES.has(voicehubSource)) voicehubSource = "inventory";
    // voicehub mode always uses order_no as its code source (PHP parity).
    if (deliveryMode === "voicehub") voicehubSource = "order_no";

    const rawStatus = formString(body, "status", "draft");
    const data: Row = {
      category_id: formInt(body, "category_id", 0) || null,
      name,
      slug: formTrimmed(body, "slug") || (await router.deps.products.uniqueSlug(name, id > 0 ? id : null)),
      description: formString(body, "description"),
      cover_image: formString(body, "cover_image"),
      price_cents: priceCents,
      status: STATUSES.has(rawStatus) ? rawStatus : "draft",
      delivery_mode: deliveryMode,
      voicehub_enabled: ["voicehub", "card_and_voicehub"].includes(deliveryMode) && formInt(body, "voicehub_enabled", 0) === 1 ? 1 : 0,
      voicehub_code_source: voicehubSource,
      stock_enabled: deliveryMode === "voicehub" ? 0 : formInt(body, "stock_enabled", 1),
      min_quantity: Math.max(1, formInt(body, "min_quantity", 1)),
      max_quantity: Math.max(1, formInt(body, "max_quantity", 99)),
      quantity_step: Math.max(1, formInt(body, "quantity_step", 1)),
      low_stock_threshold: Math.max(0, formInt(body, "low_stock_threshold", 0)),
      sort_order: formInt(body, "sort_order", 0),
    };

    if (id > 0) {
      const existing = await router.deps.products.findById(id);
      if (existing === null) return context.redirect("/admin/products", "商品不存在。", "error");
      await router.deps.products.update(id, data);
      await context.audit("product.update", "product", String(id), { name });
      return context.redirect("/admin/products", "商品已更新。");
    }

    const created = await router.deps.products.create({ ...data, name, slug: String(data["slug"]) });
    await context.audit("product.create", "product", String(created?.["id"] ?? ""), { name });
    return context.redirect("/admin/products", "商品已创建。");
  });

  router.post("/admin/products/:id/status", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const id = Number(context.params["id"] ?? 0);
    const product = await router.deps.products.findById(id);
    if (product === null) return context.redirect("/admin/products", "商品不存在。", "error");
    const next = String(product["status"] ?? "") === "active" ? "disabled" : "active";
    await router.deps.products.setStatus(id, next);
    await context.audit("product.status", "product", String(id), { to: next });
    return context.redirect("/admin/products", `商品已${next === "active" ? "上架" : "下架"}。`);
  });

  router.post("/admin/products/:id/delete", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const id = Number(context.params["id"] ?? 0);
    const product = await router.deps.products.findById(id);
    if (product === null) return context.redirect("/admin/products", "商品不存在。", "error");
    const mode = await router.deps.products.deleteOrDisable(id);
    await context.audit("product.delete", "product", String(id), { mode, name: product["name"] });
    const message = mode === "disabled" ? "该商品存在历史订单，已改为下架（软删除）。" : "商品已删除。";
    return context.redirect("/admin/products", message);
  });
}

export type { AdminContext };
