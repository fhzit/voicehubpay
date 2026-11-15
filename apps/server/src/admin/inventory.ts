/**
 * `/admin/inventory` — card listing, manual import and status toggle
 * (port of VoiceHubPay\Controllers\Admin\InventoryController).
 *
 * The 「生成卡密」 form posts to `/admin/inventory/generate`; that route is
 * owned by another module and is intentionally NOT registered here.
 */

import type { AdminRouter } from "./router.js";
import { formInt, formString, formTrimmed, pagination } from "./router.js";
import type { Row } from "./types.js";

const PER_PAGE = 20;
const STOCK_MODES = new Set(["card", "card_and_voicehub"]);

export function registerInventoryRoutes(router: AdminRouter): void {
  router.get("/admin/inventory", async (context) => {
    const deps = router.deps;
    const { query } = context;
    let productId = formInt(query, "product", 0) || null;
    const status = formString(query, "status");
    const q = formTrimmed(query, "q");
    const requested = Math.max(1, formInt(query, "page", 1));

    const products = (await deps.products.listAdmin("", "", null, 1, 500)).items;
    if (productId !== null && (await deps.products.findById(productId)) === null) productId = null;

    const stats = productId !== null ? await deps.inventory.stats(productId) : await deps.inventory.totalStats();
    const result = productId !== null
      ? await deps.inventory.listForProduct(productId, status, q, requested, PER_PAGE)
      : await deps.inventory.listAll(q, requested, PER_PAGE);

    const productNames = new Map(products.map((product) => [Number(product["id"]), String(product["name"] ?? "")]));
    const cards = result.items.map((card) => ({
      ...card,
      product_name: card["product_name"] ?? productNames.get(Number(card["product_id"])) ?? "",
      order_id: card["order_id"] ?? card["reserved_order_id"] ?? null,
      secret_masked: maskSecret(deps, card["secret_ciphertext"]),
    }));
    const { page, pages } = pagination(query, result.perPage, result.total);

    return context.render("inventory/index", {
      pageTitle: "库存卡密",
      nav: "inventory",
      products,
      product_id: productId,
      status,
      q,
      stats,
      cards,
      total: result.total,
      page,
      pages,
    });
  });

  router.get("/admin/inventory/import", async (context) => {
    const products = (await router.deps.products.listAdmin("", "", null, 1, 500)).items
      .filter((product) => STOCK_MODES.has(String(product["delivery_mode"] ?? "")));
    return context.render("inventory/import", {
      pageTitle: "导入卡密",
      nav: "inventory",
      products,
    });
  });

  router.post("/admin/inventory/import", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const deps = router.deps;
    const productId = formInt(context.body, "product_id", 0);
    const product = await deps.products.findById(productId);
    if (product === null) return context.redirect("/admin/inventory/import", "请选择商品。", "error");
    if (!STOCK_MODES.has(String(product["delivery_mode"] ?? ""))) {
      return context.redirect("/admin/inventory/import", "该商品不使用库存，无法导入卡密。", "error");
    }

    const lines = formString(context.body, "cards_text")
      .split(/\r\n|\r|\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "");
    if (lines.length === 0) {
      return context.redirect(`/admin/inventory/import?product=${productId}`, "没有可导入的卡密。", "error");
    }

    const result = await deps.inventory.import(productId, lines, deps.crypto);
    await context.audit("inventory.import", "product", String(productId), {
      total: result.total,
      imported: result.imported,
      duplicates: result.duplicates,
      invalid: result.invalid,
    });
    const message = `导入完成：成功 ${result.imported} 条，重复 ${result.duplicates} 条，无效 ${result.invalid} 条。`;
    return context.redirect(`/admin/inventory?product=${productId}`, message);
  });

  router.post("/admin/inventory/:id/status", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const id = Number(context.params["id"] ?? 0);
    const card = await router.deps.inventory.findById(id);
    if (card === null) return context.redirect("/admin/inventory", "卡密不存在。", "error");
    const disable = formString(context.body, "action") === "disable";
    await router.deps.inventory.setDisabled(id, disable);
    await context.audit("inventory.status", "inventory", String(id), { to: disable ? "disabled" : "available" });
    return context.redirect(`/admin/inventory?product=${String(card["product_id"] ?? "")}`, "状态已更新。");
  });
}

function maskSecret(deps: AdminRouter["deps"], ciphertext: unknown): string {
  if (typeof ciphertext !== "string" || ciphertext === "") return "";
  try {
    return deps.crypto.mask(deps.crypto.decrypt(ciphertext));
  } catch {
    return "";
  }
}

export type { Row };
