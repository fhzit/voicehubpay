/**
 * SMTP delivery built on nodemailer.
 *
 * Settings come from `AdminConfigPort` (env/Secret plus the persisted
 * settings.json), which is the same source the admin settings pages render, so
 * "发送测试邮件" exercises exactly the credentials the shop will use.
 *
 * Values migrated from the PHP panel are stored as `v1:<base64>` ciphertext and
 * must be decrypted with the shared master key before use.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { CryptoService } from "../../../packages/db/src/index.js";
import type { AdminConfigPort, AdminMailerPort } from "./admin/types.js";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface MailResult {
  messageId: string;
  accepted: string[];
}

export class SmtpNotConfiguredError extends Error {
  constructor(message = "SMTP 未配置") {
    super(message);
    this.name = "SmtpNotConfiguredError";
  }
}

export class SmtpMailer implements AdminMailerPort {
  private readonly crypto: CryptoService;
  private cache: { key: string; transporter: Transporter } | undefined;

  constructor(
    private readonly config: AdminConfigPort,
    basePath: string,
  ) {
    this.crypto = new CryptoService(basePath);
  }

  private plain(value: string): string {
    if (value === "") return "";
    try {
      return this.crypto.decrypt(value);
    } catch (error) {
      // A corrupted secret must not take the whole page down; report why instead.
      console.warn(JSON.stringify({ level: "warn", event: "mail.decrypt_failed", error: error instanceof Error ? error.message : String(error) }));
      throw new SmtpNotConfiguredError("SMTP 密码无法解密（主密钥不匹配）");
    }
  }

  private transporter(): Transporter {
    if (!this.config.bool("SMTP_ENABLED", true)) throw new SmtpNotConfiguredError("SMTP 未启用");
    const host = this.config.get("SMTP_HOST", "").trim();
    const port = this.config.int("SMTP_PORT", 465);
    const username = this.config.get("SMTP_USERNAME", "").trim();
    const password = this.plain(this.config.get("SMTP_PASSWORD", ""));
    if (host === "" || port <= 0) throw new SmtpNotConfiguredError("SMTP 服务器未填写");
    if (username === "" || password === "") throw new SmtpNotConfiguredError("SMTP 账号或密码未填写");

    const encryption = this.config.get("SMTP_ENCRYPTION", "ssl").toLowerCase();
    const secure = encryption === "ssl" || port === 465;
    const key = [host, port, username, password, encryption].join("|");
    if (this.cache?.key === key) return this.cache.transporter;

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user: username, pass: password },
      ...(encryption === "tls" && !secure ? { requireTLS: true } : {}),
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    this.cache = { key, transporter };
    return transporter;
  }

  private from(): { name: string; address: string } {
    const address = this.config.get("SMTP_FROM", "").trim() || this.config.get("SMTP_USERNAME", "").trim();
    if (address === "") throw new SmtpNotConfiguredError("发件地址未填写");
    const name = this.config.get("SMTP_FROM_NAME", "").trim();
    return { name, address };
  }

  /** Verifies the SMTP handshake and credentials without sending anything. */
  async verify(): Promise<void> {
    await this.transporter().verify();
  }

  async send(message: MailMessage): Promise<MailResult> {
    const to = message.to.trim();
    if (to === "" || !to.includes("@")) throw new SmtpNotConfiguredError("收件邮箱无效");
    const info = await this.transporter().sendMail({
      from: this.from(),
      to,
      subject: message.subject,
      html: message.html,
      ...(message.text === undefined ? {} : { text: message.text }),
    });
    console.info(JSON.stringify({ level: "info", event: "mail.sent", to, messageId: info.messageId }));
    return { messageId: info.messageId, accepted: (info.accepted ?? []).map(String) };
  }

  async sendTest(to: string, subject: string, html: string): Promise<void> {
    const result = await this.send({ to, subject, html });
    if (result.accepted.length === 0) throw new SmtpNotConfiguredError("SMTP 服务器未接受收件人");
  }
}
