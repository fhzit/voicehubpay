import { test } from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import { join } from "node:path";
import { escapeHtml, money, moneySymbol, TEMPLATE_ROOT } from "../src/render.js";

async function render(props: Record<string, unknown>): Promise<string> {
  return ejs.renderFile(
    join(TEMPLATE_ROOT, "checkout/checkout.ejs"),
    {
      e: escapeHtml,
      money,
      moneySymbol,
      order: { order_no: "N1", amount_due_cents: 990, items: [{ product_name_snapshot: "商品", product_price_cents_snapshot: 990, quantity: 1 }] },
      channels: [{ id: "epayv1", label: "页面支付", remark: "", fee_percent: 0, types: ["alipay", "wxpay"], default_type: "alipay" }],
      selected_channel: "epayv1",
      channel_remark: "",
      fee_percent: 0,
      fee_cents: 0,
      payable_cents: 990,
      payment_enabled: true,
      order_ttl: 30,
      csrf: "tok",
      ...props,
    },
    { async: true },
  );
}

test("收银台支付方式使用原生 radio 提交（不依赖脚本，选择必达服务端）", async () => {
  const html = await render({ enabled_types: ["alipay", "wxpay"], default_type: "alipay" });
  assert.match(html, /<input type="radio" name="pay_type" value="alipay"/);
  assert.match(html, /<input type="radio" name="pay_type" value="wxpay"/);
  assert.match(html, /value="alipay" class="pay-method-input" checked/);
  assert.doesNotMatch(html, /type="hidden" name="pay_type"/);
});

test("默认选中通道默认支付方式：wxpay 时对应 radio 被选中", async () => {
  const html = await render({ enabled_types: ["alipay", "wxpay"], default_type: "wxpay" });
  assert.match(html, /value="wxpay" class="pay-method-input" checked/);
  assert.doesNotMatch(html, /value="alipay" class="pay-method-input" checked/);
});
