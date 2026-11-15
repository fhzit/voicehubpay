/**
 * `/admin/categories` — list + create/update/delete
 * (port of VoiceHubPay\Controllers\Admin\CategoryController).
 */

import type { AdminRouter } from "./router.js";
import { formInt, formString, formTrimmed } from "./router.js";

export function registerCategoryRoutes(router: AdminRouter): void {
  router.get("/admin/categories", async (context) => {
    const categories = await router.deps.categories.listAll();
    return context.render("categories", {
      pageTitle: "商品分类",
      nav: "categories",
      categories,
    });
  });

  router.post("/admin/categories/save", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const body = context.body;
    const id = formInt(body, "id", 0);
    const name = formTrimmed(body, "name");
    if (name === "") return context.redirect("/admin/categories", "分类名称不能为空。", "error");

    const categories = router.deps.categories;
    if (id > 0) {
      await categories.update(id, {
        name,
        slug: formTrimmed(body, "slug") || (await categories.uniqueSlug(name, id)),
        status: formString(body, "status", "active"),
        sort_order: formInt(body, "sort_order", 0),
      });
      await context.audit("category.update", "category", String(id), { name });
      return context.redirect("/admin/categories", "分类已更新。");
    }

    const created = await categories.create(name, await categories.uniqueSlug(name), formInt(body, "sort_order", 0), formString(body, "status", "active"));
    await context.audit("category.create", "category", String(created?.["id"] ?? ""), { name });
    return context.redirect("/admin/categories", "分类已创建。");
  });

  router.post("/admin/categories/delete", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const id = formInt(context.body, "id", 0);
    const removed = await router.deps.categories.delete(id);
    await context.audit("category.delete", "category", String(id));
    return removed
      ? context.redirect("/admin/categories", "分类已删除。")
      : context.redirect("/admin/categories", "该分类下仍有商品，请先移除商品。", "error");
  });
}
