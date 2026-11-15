/**
 * `/admin/users` — listing, detail, profile edit, status toggle, delete and
 * role promotion/demotion (port of Admin\UserController).
 */

import { validateUsername } from "../auth-legacy/auth-service.js";
import type { AdminContext, AdminRouter } from "./router.js";
import { codePointLength, formInt, formString, formTrimmed, pagination } from "./router.js";
import type { Row } from "./types.js";

const PER_PAGE = 20;

export function registerUserRoutes(router: AdminRouter): void {
  const deps = router.deps;

  router.get("/admin/users", async (context) => {
    const { query } = context;
    const q = formString(query, "q");
    const status = formString(query, "status");
    const requested = Math.max(1, formInt(query, "page", 1));
    const result = await deps.users.search(q, status, requested, PER_PAGE);

    const users: Row[] = [];
    for (const user of result.items) {
      const orders = await deps.orders.listForUser(Number(user["id"]), "", "", 1, 1);
      const social = deps.social !== undefined ? await deps.social.listForUser(Number(user["id"])) : [];
      users.push({ ...user, order_count: orders.total, social });
    }
    const { page, pages } = pagination(query, result.perPage, result.total);

    return context.render("users/index", {
      pageTitle: "用户管理",
      nav: "users",
      users,
      total: result.total,
      page,
      pages,
      q,
      status,
      super_id: await deps.users.superAdminId(),
      is_super: await deps.users.isSuperAdmin(Number(context.user["id"])),
    });
  });

  router.get("/admin/users/:id", async (context) => {
    const id = Number(context.params["id"] ?? 0);
    const user = await deps.users.findById(id);
    if (user === null) return context.redirect("/admin/users", "用户不存在。", "error");

    const orders = await deps.orders.listForUserLatest(id, 20);
    const consumption = orders.reduce((sum, order) => sum + Number(order["amount_paid_cents"] ?? 0), 0);
    const cardCount = deps.units !== undefined ? await deps.units.countDeliveredForUser(id) : 0;
    const connections = deps.social !== undefined ? await deps.social.listForUser(id) : [];

    return context.render("users/detail", {
      pageTitle: `用户 ${String(user["username"] ?? "")}`,
      nav: "users",
      user,
      connections,
      orders,
      consumption,
      card_count: cardCount,
      super_id: await deps.users.superAdminId(),
      is_super: await deps.users.isSuperAdmin(Number(context.user["id"])),
    });
  });

  router.post("/admin/users/:id/update", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const id = Number(context.params["id"] ?? 0);
    const back = `/admin/users/${id}`;
    const target = await deps.users.findById(id);
    if (target === null) return context.redirect("/admin/users", "用户不存在。", "error");

    const username = formTrimmed(context.body, "username");
    const displayName = formTrimmed(context.body, "display_name");
    const usernameError = validateUsername(username);
    if (usernameError !== "") return context.redirect(back, usernameError, "error");
    const existing = await deps.users.findByUsername(username);
    if (existing !== null && Number(existing["id"]) !== id) return context.redirect(back, "该用户名已被占用。", "error");
    if (codePointLength(displayName) > 50) return context.redirect(back, "昵称长度不能超过 50 个字符。", "error");

    await deps.users.update(id, { username, display_name: displayName });
    const changed: string[] = [];
    if (String(target["username"] ?? "") !== username) changed.push("username");
    if (String(target["display_name"] ?? "") !== displayName) changed.push("display_name");
    await context.audit("user.update", "user", String(id), { username, changed });
    return context.redirect(back, "用户名与昵称已更新。");
  });

  router.post("/admin/users/:id/status", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const id = Number(context.params["id"] ?? 0);
    const user = await deps.users.findById(id);
    if (user === null) return context.redirect("/admin/users", "用户不存在。", "error");
    const next = String(user["status"] ?? "") === "disabled" ? "active" : "disabled";
    await deps.users.setStatus(id, next);
    await context.audit("user.status", "user", String(id), { to: next, username: user["username"] });
    return context.redirect("/admin/users", "用户状态已更新。");
  });

  router.post("/admin/users/:id/delete", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const id = Number(context.params["id"] ?? 0);
    const target = await deps.users.findById(id);
    if (target === null) return context.redirect("/admin/users", "用户不存在。", "error");
    if (id === Number(context.user["id"])) return context.redirect("/admin/users", "不能删除当前登录的账号。", "error");
    if (await deps.users.isSuperAdmin(id)) return context.redirect("/admin/users", "超级管理员不可被删除。", "error");
    // Only disabled accounts may be deleted (deliberate two-step removal).
    if (String(target["status"] ?? "") !== "disabled") return context.redirect("/admin/users", "请先禁用该用户后再删除。", "error");
    await deps.users.delete(id);
    await context.audit("user.delete", "user", String(id), { username: target["username"] });
    return context.redirect("/admin/users", `用户「${String(target["username"] ?? "")}」已删除。`);
  });

  router.post("/admin/users/:id/role", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const id = Number(context.params["id"] ?? 0);
    const target = await deps.users.findById(id);
    if (target === null) return context.redirect("/admin/users", "用户不存在。", "error");

    const actorId = Number(context.user["id"]);
    const isSuper = await deps.users.isSuperAdmin(actorId);
    const newRole = formString(context.body, "role") === "admin" ? "admin" : "user";
    const targetRole = String(target["role"] ?? "user");
    const wasAdmin = targetRole === "admin" || targetRole === "superadmin";
    const targetIsSuper = await deps.users.isSuperAdmin(id);

    if (wasAdmin && !isSuper) return context.redirect("/admin/users", "只有超级管理员可以调整管理员的角色。", "error");
    if (targetIsSuper) return context.redirect("/admin/users", "超级管理员不可被降级。", "error");
    if (wasAdmin && newRole !== "admin") {
      await deps.users.setRole(id, "user");
      await context.audit("user.demote", "user", String(id), { username: target["username"] });
      return context.redirect("/admin/users", `已将「${String(target["username"] ?? "")}」降级为普通用户。`);
    }
    if (!wasAdmin && newRole === "admin") {
      await deps.users.setRole(id, "admin");
      await context.audit("user.promote", "user", String(id), { username: target["username"] });
      return context.redirect("/admin/users", `已将「${String(target["username"] ?? "")}」设为管理员。`);
    }
    return context.redirect("/admin/users", "角色未变化。");
  });
}

export type { AdminContext };
