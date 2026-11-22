/**
 * 支付通道注册表 + 手续费计算。
 *
 * 通道本身（SG65 / 易支付V2 / 易支付V1）由各自的 *_ENABLED 开关控制；
 * 展示名称、备注、手续费是通道级运营配置，键名统一为：
 *   PAY_CHANNEL_<ID>_NAME          自定义显示名称（留空用默认）
 *   PAY_CHANNEL_<ID>_REMARK        展示给用户的备注/说明
 *   PAY_CHANNEL_<ID>_FEE_PERCENT   手续费百分比（0-100，可带小数）
 *
 * 手续费在商品原价基础上叠加：应付 = 原价 + round(原价 × 费率%)。
 */

export type PayChannelId = "sg65" | "epayv2" | "epayv1";

export interface PayChannelOption {
  id: PayChannelId;
  label: string;
  remark: string;
  fee_percent: number;
  types: string[];
  default_type: string;
}

export interface ChannelConfigPort {
  get(key: string, fallback?: string): string;
  bool(key: string, fallback: boolean): boolean;
}

interface ChannelSpec {
  id: PayChannelId;
  prefix: string;
  defaultLabel: string;
  defaultTypes: string;
}

const SPECS: ChannelSpec[] = [
  { id: "sg65", prefix: "SG65", defaultLabel: "易付通（SG65）", defaultTypes: "alipay,wxpay,qqpay" },
  { id: "epayv2", prefix: "EPAY_V2", defaultLabel: "易支付V2", defaultTypes: "alipay,wxpay" },
  { id: "epayv1", prefix: "EPAY_V1", defaultLabel: "易支付V1（页面支付）", defaultTypes: "alipay,wxpay" },
];

const ALLOWED_TYPES = ["alipay", "wxpay", "qqpay"];

/** 通道配置键前缀，例如 sg65 → PAY_CHANNEL_SG65。 */
export function channelConfigPrefix(id: PayChannelId): string {
  return `PAY_CHANNEL_${id.toUpperCase()}`;
}

function parseTypes(raw: string): string[] {
  const listed = raw.split(",").map((part) => part.trim()).filter((part) => part !== "");
  return ALLOWED_TYPES.filter((type) => listed.includes(type));
}

/** 解析手续费百分比：非法值归 0，范围限制 0-100。 */
export function parseFeePercent(raw: string | number | undefined): number {
  const value = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(100, Math.round(value * 100) / 100);
}

/** 手续费金额（分）：四舍五入到整分，永不返回负数。 */
export function channelFeeCents(amountCents: number, feePercent: number): number {
  const amount = Number.isFinite(amountCents) ? Math.max(0, Math.round(amountCents)) : 0;
  const percent = parseFeePercent(feePercent);
  if (amount === 0 || percent === 0) return 0;
  return Math.max(0, Math.round((amount * percent) / 100));
}

/** 叠加手续费后的应付金额（分）。 */
export function payableCents(amountCents: number, feePercent: number): number {
  const amount = Number.isFinite(amountCents) ? Math.max(0, Math.round(amountCents)) : 0;
  return amount + channelFeeCents(amount, feePercent);
}

/** 当前已启用的通道（至少一种支付方式），按固定顺序返回。 */
export function payChannels(config: ChannelConfigPort): PayChannelOption[] {
  const out: PayChannelOption[] = [];
  for (const spec of SPECS) {
    if (!config.bool(`${spec.prefix}_ENABLED`, false)) continue;
    const types = parseTypes(config.get(`${spec.prefix}_ENABLED_TYPES`, spec.defaultTypes));
    if (types.length === 0) continue;
    const defaultTypeKey = spec.id === "sg65" ? "SG65_DEFAULT_PAYMENT_TYPE" : `${spec.prefix}_DEFAULT_TYPE`;
    const preferred = config.get(defaultTypeKey, "alipay");
    const prefix = channelConfigPrefix(spec.id);
    const customLabel = config.get(`${prefix}_NAME`, "").trim();
    out.push({
      id: spec.id,
      label: customLabel !== "" ? customLabel : spec.defaultLabel,
      remark: config.get(`${prefix}_REMARK`, "").trim(),
      fee_percent: parseFeePercent(config.get(`${prefix}_FEE_PERCENT`, "0")),
      types,
      default_type: types.includes(preferred) ? preferred : types[0]!,
    });
  }
  return out;
}

/** 在通道列表里查找某个 id（未启用则 undefined）。 */
export function findChannel(channels: readonly PayChannelOption[], id: string): PayChannelOption | undefined {
  return channels.find((channel) => channel.id === id);
}
